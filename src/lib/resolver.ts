import { satisfies } from '@renovatebot/pep440'
import type {
  GraphEdge,
  GraphNode,
  MarkerContext,
  ParsedRequirement,
  PypiFile,
  PypiProjectResponse,
  PypiVersionResponse,
  PlatformOption,
  ResolutionInputs,
  ResolutionLimits,
  ResolutionResult,
  RootOptions,
} from '../types.ts'
import {
  collectMarkerInsights,
  createMutableInsights,
  evaluateMarker,
  finalizeInsights,
} from './marker.ts'
import type { PypiClient } from './pypi.ts'
import { parseRequirement } from './requirements.ts'
import { COMMON_PYTHON_VERSIONS, normalizePackageName, normalizePythonVersion, selectVersion, uniqueSorted } from './versions.ts'

interface ResolveRequest {
  name: string
  normalizedName: string
  specifiers: string[]
  requirementTexts: string[]
  selectedExtras: string[]
  depth: number
}

interface ProjectSnapshot {
  releases: string[]
  yankedVersions: Set<string>
}

interface ResolverState {
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge>
  projectSnapshots: Map<string, ProjectSnapshot>
  limits: ResolutionLimits
  insights: ReturnType<typeof createMutableInsights>
}

const ALL_PLATFORMS: PlatformOption[] = ['linux', 'windows', 'macos']

export async function resolveDependencyGraph(
  inputs: ResolutionInputs,
  client: PypiClient,
): Promise<ResolutionResult> {
  const normalizedRoot = normalizePackageName(inputs.packageName)
  if (!normalizedRoot) {
    return {
      rootId: null,
      nodes: [],
      edges: [],
      insights: finalizeInsights([], createMutableInsights([])),
      limits: emptyLimits(),
      rootOptions: {
        extras: [],
        supportedPythonVersions: buildPythonCandidatePool(inputs.pythonVersion),
        supportedPlatforms: ALL_PLATFORMS,
        showPythonSelector: false,
        showPlatformSelector: false,
      },
      effectiveInputs: inputs,
    }
  }

  const rootProject = await client.getProject(normalizedRoot)
  const rootExtras = uniqueSorted([
    ...(rootProject.data.info.provides_extra ?? []),
    ...extractRootExtras(rootProject.data.info.requires_dist ?? []),
  ])
  const rootOptions = deriveRootOptions(rootProject.data, inputs, rootExtras)
  const effectiveInputs = sanitizeInputs(inputs, rootOptions)
  const state: ResolverState = {
    nodes: new Map<string, GraphNode>(),
    edges: new Map<string, GraphEdge>(),
    projectSnapshots: new Map<string, ProjectSnapshot>(),
    limits: emptyLimits(),
    insights: createMutableInsights(rootExtras),
  }

  recordFetchSource(state.limits, rootProject.source)
  state.projectSnapshots.set(normalizedRoot, projectSnapshotFromReleases(rootProject.data.releases))

  const rootId = await resolveNode(
    {
      name: rootProject.data.info.name,
      normalizedName: normalizedRoot,
      specifiers: [],
      requirementTexts: [],
      selectedExtras: effectiveInputs.extras,
      depth: 0,
    },
    effectiveInputs,
    client,
    state,
    new Set<string>(),
    rootProject.data.info.name,
    rootProject.data,
  )

  return {
    rootId,
    nodes: [...state.nodes.values()].sort((left, right) => left.depth - right.depth || left.packageName.localeCompare(right.packageName)),
    edges: [...state.edges.values()],
    insights: finalizeInsights(rootExtras, state.insights),
    limits: state.limits,
    rootOptions,
    effectiveInputs,
  }
}

async function resolveNode(
  request: ResolveRequest,
  inputs: ResolutionInputs,
  client: PypiClient,
  state: ResolverState,
  path: Set<string>,
  displayName?: string,
  preloadedProject?: PypiProjectResponse,
): Promise<string> {
  const summary: PypiProjectResponse =
    preloadedProject ??
    (await client.getProject(request.normalizedName).then((result) => {
      recordFetchSource(state.limits, result.source)
      return result.data
    }))

  if (!state.projectSnapshots.has(request.normalizedName)) {
    state.projectSnapshots.set(request.normalizedName, projectSnapshotFromReleases(summary.releases))
  }

  const snapshot = state.projectSnapshots.get(request.normalizedName)!
  const availableVersions = snapshot.releases.filter((version) => !snapshot.yankedVersions.has(version))
  const manualOverride = inputs.manualVersions[request.normalizedName] ?? null
  const versionChoice = selectVersion(availableVersions, request.specifiers, manualOverride)

  if (!versionChoice.selectedVersion) {
    state.limits.unresolvedNodes += 1
    return ensureUnresolvedNode(
      state,
      request,
      versionChoice.legalVersions,
      manualOverride,
      versionChoice.rejectionReason ?? 'The package could not be resolved.',
      displayName ?? request.name,
    )
  }

  const nodeId = makeNodeId(request.normalizedName, versionChoice.selectedVersion, request.selectedExtras)
  if (path.has(nodeId)) {
    state.limits.cycleEdges += 1
    return nodeId
  }

  const existing = state.nodes.get(nodeId)
  if (existing) {
    mergeNode(existing, request.requirementTexts, request.specifiers, versionChoice.legalVersions, manualOverride)
    return nodeId
  }

  const versionResponse: { data: PypiProjectResponse | PypiVersionResponse; source: 'cache' | 'network' } =
    versionChoice.selectedVersion === summary.info.version
      ? { data: summary, source: 'cache' as const }
      : await client.getVersion(request.normalizedName, versionChoice.selectedVersion)

  if (versionChoice.selectedVersion !== summary.info.version) {
    recordFetchSource(state.limits, versionResponse.source)
  }

  const node: GraphNode = {
    id: nodeId,
    kind: 'package',
    packageName: versionResponse.data.info.name,
    normalizedName: request.normalizedName,
    version: versionChoice.selectedVersion,
    displayVersion: versionChoice.selectedVersion,
    summary: versionResponse.data.info.summary ?? 'No summary published.',
    depth: request.depth,
    selectedExtras: [...request.selectedExtras].sort((left, right) => left.localeCompare(right)),
    incomingRequirements: [...new Set(request.requirementTexts)],
    inactiveRequirements: [],
    availableVersions: versionChoice.legalVersions,
    combinedSpecifiers: [...request.specifiers],
    manualOverride,
    requiresPython: versionResponse.data.info.requires_python ?? null,
    projectUrl: versionResponse.data.info.package_url,
    cacheSource: versionResponse.source,
    notes: [],
  }
  state.nodes.set(nodeId, node)

  const markerContext = buildMarkerContext(inputs, request.selectedExtras)
  const nextPath = new Set(path)
  nextPath.add(nodeId)
  const requirements = versionResponse.data.info.requires_dist ?? []

  await Promise.all(
    requirements.map(async (rawRequirement) => {
      let parsed: ParsedRequirement
      try {
        parsed = parseRequirement(rawRequirement)
      } catch (error) {
        state.limits.parseFailures += 1
        node.inactiveRequirements.push({
          raw: rawRequirement,
          markerText: null,
          reason: error instanceof Error ? error.message : 'Could not parse requirement.',
        })
        return
      }

      if (parsed.markerAst && parsed.markerText) {
        collectMarkerInsights(parsed.markerAst, state.insights, parsed.markerText)
        const evaluation = evaluateMarker(parsed.markerAst, markerContext, parsed.markerText)
        if (!evaluation.active) {
          state.limits.inactiveRequirements += 1
          node.inactiveRequirements.push({
            raw: parsed.raw,
            markerText: parsed.markerText,
            reason: evaluation.reason,
          })
          return
        }
      }

      if (parsed.directReference) {
        state.limits.skippedDirectReferences += 1
        const directRefId = ensureUnresolvedNode(
          state,
          {
            ...request,
            name: parsed.name,
            normalizedName: parsed.normalizedName,
            specifiers: parsed.specifier ? [parsed.specifier] : [],
            selectedExtras: parsed.extras,
            requirementTexts: [parsed.raw],
          },
          [],
          null,
          `Direct reference dependencies are shown but not recursively resolved: ${parsed.directReference}`,
          parsed.name,
        )
        state.edges.set(
          makeEdgeId(nodeId, directRefId, parsed.raw),
          buildEdge(nodeId, directRefId, parsed.raw, parsed.markerText),
        )
        return
      }

      const childId = await resolveNode(
        {
          name: parsed.name,
          normalizedName: parsed.normalizedName,
          specifiers: parsed.specifier ? [parsed.specifier] : [],
          requirementTexts: [parsed.raw],
          selectedExtras: parsed.extras,
          depth: request.depth + 1,
        },
        inputs,
        client,
        state,
        nextPath,
      )

      state.edges.set(
        makeEdgeId(nodeId, childId, parsed.raw),
        buildEdge(nodeId, childId, parsed.raw, parsed.markerText),
      )
    }),
  )

  return nodeId
}

function buildMarkerContext(inputs: ResolutionInputs, selectedExtras: string[]): MarkerContext {
  return {
    pythonVersion: inputs.pythonVersion,
    pythonFullVersion: normalizePythonVersion(inputs.pythonVersion),
    sysPlatform: platformToSysPlatform(inputs.platform),
    platformSystem: platformToPlatformSystem(inputs.platform),
    osName: inputs.platform === 'windows' ? 'nt' : 'posix',
    platformMachine: 'x86_64',
    implementationName: 'cpython',
    implementationVersion: normalizePythonVersion(inputs.pythonVersion),
    platformPythonImplementation: 'CPython',
    extras: selectedExtras,
  }
}

function platformToSysPlatform(platform: PlatformOption): string {
  if (platform === 'windows') {
    return 'win32'
  }
  if (platform === 'macos') {
    return 'darwin'
  }
  return 'linux'
}

function platformToPlatformSystem(platform: PlatformOption): string {
  if (platform === 'windows') {
    return 'Windows'
  }
  if (platform === 'macos') {
    return 'Darwin'
  }
  return 'Linux'
}

function deriveRootOptions(
  rootProject: PypiProjectResponse,
  inputs: ResolutionInputs,
  rootExtras: string[],
): RootOptions {
  const sanitizedExtras = inputs.extras.filter((extra) => rootExtras.includes(extra))
  const parsedRequirements = parseRequirementList(rootProject.info.requires_dist ?? [])
  const pythonPool = buildPythonCandidatePool(inputs.pythonVersion)
  const supportedPythonVersions = deriveSupportedPythonVersions(rootProject, pythonPool)
  const supportedPlatforms = inferSupportedPlatforms(rootProject.releases[rootProject.info.version] ?? [])
  const effectivePythonVersion = pickSupportedPythonVersion(inputs.pythonVersion, supportedPythonVersions)
  const effectivePlatform = pickSupportedPlatform(inputs.platform, supportedPlatforms)

  const pythonSensitive = hasRequirementVariation(
    parsedRequirements,
    supportedPythonVersions,
    (pythonVersion) =>
      buildMarkerContext(
        {
          ...inputs,
          pythonVersion,
          platform: effectivePlatform,
          extras: sanitizedExtras,
        },
        sanitizedExtras,
      ),
  )
  const platformSensitive = hasRequirementVariation(
    parsedRequirements,
    supportedPlatforms,
    (platform) =>
      buildMarkerContext(
        {
          ...inputs,
          pythonVersion: effectivePythonVersion,
          platform,
          extras: sanitizedExtras,
        },
        sanitizedExtras,
      ),
  )

  return {
    extras: rootExtras,
    supportedPythonVersions,
    supportedPlatforms,
    showPythonSelector:
      supportedPythonVersions.length < pythonPool.length || pythonSensitive,
    showPlatformSelector:
      supportedPlatforms.length < ALL_PLATFORMS.length || platformSensitive,
  }
}

function sanitizeInputs(inputs: ResolutionInputs, rootOptions: RootOptions): ResolutionInputs {
  return {
    ...inputs,
    pythonVersion: pickSupportedPythonVersion(inputs.pythonVersion, rootOptions.supportedPythonVersions),
    platform: pickSupportedPlatform(inputs.platform, rootOptions.supportedPlatforms),
    extras: inputs.extras.filter((extra) => rootOptions.extras.includes(extra)),
  }
}

function buildPythonCandidatePool(selectedVersion: string): string[] {
  const pool = [...COMMON_PYTHON_VERSIONS]
  if (selectedVersion && !pool.includes(selectedVersion)) {
    pool.unshift(selectedVersion)
  }

  return pool
}

function deriveSupportedPythonVersions(
  rootProject: PypiProjectResponse,
  pool: string[],
): string[] {
  const supported = pool.filter((version) =>
    supportsPythonSpecifier(rootProject.info.requires_python, version),
  )

  return supported.length > 0 ? supported : pool
}

function supportsPythonSpecifier(specifier: string | null, version: string): boolean {
  if (!specifier) {
    return true
  }

  try {
    return satisfies(normalizePythonVersion(version), specifier, { prereleases: true })
  } catch {
    return true
  }
}

function inferSupportedPlatforms(files: PypiFile[]): PlatformOption[] {
  if (files.length === 0) {
    return ALL_PLATFORMS
  }

  const supported = new Set<PlatformOption>()

  for (const file of files) {
    const normalized = file.filename.toLowerCase()

    if (file.packagetype === 'sdist' || normalized.endsWith('-any.whl')) {
      return ALL_PLATFORMS
    }

    if (normalized.includes('manylinux') || normalized.includes('musllinux') || normalized.includes('linux')) {
      supported.add('linux')
    }
    if (normalized.includes('win32') || normalized.includes('win_amd64') || normalized.includes('win_arm64')) {
      supported.add('windows')
    }
    if (normalized.includes('macosx') || normalized.includes('darwin')) {
      supported.add('macos')
    }
  }

  return supported.size > 0 ? ALL_PLATFORMS.filter((platform) => supported.has(platform)) : ALL_PLATFORMS
}

function parseRequirementList(requiresDist: string[]): ParsedRequirement[] {
  const parsed: ParsedRequirement[] = []

  for (const rawRequirement of requiresDist) {
    try {
      parsed.push(parseRequirement(rawRequirement))
    } catch {
      continue
    }
  }

  return parsed
}

function hasRequirementVariation<T>(
  requirements: ParsedRequirement[],
  values: T[],
  toContext: (value: T) => MarkerContext,
): boolean {
  if (requirements.length === 0 || values.length === 0) {
    return false
  }

  const signatures = new Set(
    values.map((value) => getActiveRequirementSignature(requirements, toContext(value))),
  )

  return signatures.size > 1
}

function getActiveRequirementSignature(
  requirements: ParsedRequirement[],
  context: MarkerContext,
): string {
  return requirements
    .filter((requirement) => isRequirementActive(requirement, context))
    .map((requirement) => requirement.raw)
    .sort((left, right) => left.localeCompare(right))
    .join('|')
}

function isRequirementActive(requirement: ParsedRequirement, context: MarkerContext): boolean {
  if (!requirement.markerAst || !requirement.markerText) {
    return true
  }

  return evaluateMarker(requirement.markerAst, context, requirement.markerText).active
}

function pickSupportedPythonVersion(selected: string, supported: string[]): string {
  if (supported.includes(selected)) {
    return selected
  }

  return supported[supported.length - 1] ?? selected
}

function pickSupportedPlatform(selected: PlatformOption, supported: PlatformOption[]): PlatformOption {
  if (supported.includes(selected)) {
    return selected
  }

  return supported[0] ?? selected
}

function projectSnapshotFromReleases(releases: Record<string, { yanked: boolean }[]>): ProjectSnapshot {
  const yankedVersions = new Set<string>()
  const releaseVersions = Object.entries(releases)
    .filter(([, files]) => files.length > 0)
    .map(([version, files]) => {
      const allYanked = files.every((file) => file.yanked)
      if (allYanked) {
        yankedVersions.add(version)
      }
      return version
    })

  return {
    releases: releaseVersions,
    yankedVersions,
  }
}

function mergeNode(
  node: GraphNode,
  incomingRequirements: string[],
  specifiers: string[],
  legalVersions: string[],
  manualOverride: string | null,
): void {
  node.incomingRequirements = uniqueSorted([...node.incomingRequirements, ...incomingRequirements])
  node.combinedSpecifiers = uniqueSorted([...node.combinedSpecifiers, ...specifiers])
  node.availableVersions = legalVersions
  node.manualOverride = manualOverride
}

function ensureUnresolvedNode(
  state: ResolverState,
  request: ResolveRequest,
  legalVersions: string[],
  manualOverride: string | null,
  reason: string,
  displayName: string,
): string {
  const nodeId = `unresolved:${request.normalizedName}:${hashValue(`${request.specifiers.join(',')}|${request.selectedExtras.join(',')}|${reason}`)}`
  if (state.nodes.has(nodeId)) {
    return nodeId
  }

  state.nodes.set(nodeId, {
    id: nodeId,
    kind: 'unresolved',
    packageName: displayName,
    normalizedName: request.normalizedName,
    version: null,
    displayVersion: 'unresolved',
    summary: reason,
    depth: request.depth,
    selectedExtras: request.selectedExtras,
    incomingRequirements: request.requirementTexts,
    inactiveRequirements: [],
    availableVersions: legalVersions,
    combinedSpecifiers: request.specifiers,
    manualOverride,
    requiresPython: null,
    projectUrl: null,
    cacheSource: 'network',
    notes: [reason],
  })
  return nodeId
}

function buildEdge(source: string, target: string, requirement: string, markerText: string | null): GraphEdge {
  return {
    id: makeEdgeId(source, target, requirement),
    source,
    target,
    requirement,
    markerText,
  }
}

function makeEdgeId(source: string, target: string, requirement: string): string {
  return `${source}->${target}:${hashValue(requirement)}`
}

function makeNodeId(normalizedName: string, version: string, selectedExtras: string[]): string {
  const extrasSuffix =
    selectedExtras.length > 0
      ? `[${[...new Set(selectedExtras)].sort((left, right) => left.localeCompare(right)).join(',')}]`
      : ''
  return `${normalizedName}@${version}${extrasSuffix}`
}

function hashValue(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function extractRootExtras(requiresDist: string[]): string[] {
  const extras = new Set<string>()

  for (const rawRequirement of requiresDist) {
    try {
      const parsed = parseRequirement(rawRequirement)
      if (parsed.markerAst && parsed.markerText) {
        collectMarkerInsights(parsed.markerAst, {
          extras,
          platforms: new Set<string>(),
          pythonMarkers: new Set<string>(),
          markerFields: new Set<string>(),
        }, parsed.markerText)
      }
    } catch {
      continue
    }
  }

  return [...extras]
}

function emptyLimits(): ResolutionLimits {
  return {
    cycleEdges: 0,
    unresolvedNodes: 0,
    skippedDirectReferences: 0,
    parseFailures: 0,
    inactiveRequirements: 0,
    cacheHits: 0,
    networkRequests: 0,
  }
}

function recordFetchSource(limits: ResolutionLimits, source: 'cache' | 'network'): void {
  if (source === 'cache') {
    limits.cacheHits += 1
  } else {
    limits.networkRequests += 1
  }
}
