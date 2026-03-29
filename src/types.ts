export type PlatformOption = 'linux' | 'windows' | 'macos'

export interface ResolutionInputs {
  packageName: string
  pythonVersion: string
  platform: PlatformOption
  extras: string[]
  manualVersions: Record<string, string>
}

export interface CacheEntry<T> {
  key: string
  value: T
  fetchedAt: number
  expiresAt: number
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>
  set<T>(entry: CacheEntry<T>): Promise<void>
}

export interface PypiFile {
  filename: string
  packagetype: string
  python_version: string
  requires_python: string | null
  yanked: boolean
}

export interface PypiInfo {
  name: string
  version: string
  summary: string | null
  requires_dist: string[] | null
  requires_python: string | null
  provides_extra: string[] | null
  project_url: string | null
  package_url: string
  project_urls?: Record<string, string>
}

export interface PypiProjectResponse {
  info: PypiInfo
  releases: Record<string, PypiFile[]>
}

export interface PypiVersionResponse {
  info: PypiInfo
  urls: PypiFile[]
}

export type MarkerOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '~='
  | '==='
  | 'in'
  | 'not in'

export interface MarkerOperand {
  kind: 'identifier' | 'string'
  value: string
}

export interface MarkerComparisonNode {
  kind: 'comparison'
  left: MarkerOperand
  operator: MarkerOperator
  right: MarkerOperand
}

export interface MarkerGroupNode {
  kind: 'group'
  operator: 'and' | 'or'
  children: MarkerNode[]
}

export type MarkerNode = MarkerComparisonNode | MarkerGroupNode

export interface ParsedRequirement {
  raw: string
  name: string
  normalizedName: string
  extras: string[]
  specifier: string
  markerText: string | null
  markerAst: MarkerNode | null
  directReference: string | null
}

export interface MarkerContext {
  pythonVersion: string
  pythonFullVersion: string
  sysPlatform: string
  platformSystem: string
  osName: string
  platformMachine: string
  implementationName: string
  implementationVersion: string
  platformPythonImplementation: string
  extras: string[]
}

export interface MarkerEvaluation {
  active: boolean
  reason: string
}

export interface InactiveRequirement {
  raw: string
  reason: string
  markerText: string | null
}

export interface GraphNode {
  id: string
  kind: 'package' | 'unresolved'
  packageName: string
  normalizedName: string
  version: string | null
  displayVersion: string
  summary: string
  depth: number
  selectedExtras: string[]
  incomingRequirements: string[]
  inactiveRequirements: InactiveRequirement[]
  availableVersions: string[]
  combinedSpecifiers: string[]
  manualOverride: string | null
  requiresPython: string | null
  projectUrl: string | null
  cacheSource: 'cache' | 'network' | 'mixed'
  notes: string[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  requirement: string
  markerText: string | null
}

export interface DependencyInsights {
  rootExtras: string[]
  observedExtras: string[]
  observedPlatforms: string[]
  pythonMarkers: string[]
  markerFields: string[]
}

export interface ResolutionLimits {
  cycleEdges: number
  unresolvedNodes: number
  skippedDirectReferences: number
  parseFailures: number
  inactiveRequirements: number
  cacheHits: number
  networkRequests: number
}

export interface RootOptions {
  extras: string[]
  supportedPythonVersions: string[]
  supportedPlatforms: PlatformOption[]
  showPythonSelector: boolean
  showPlatformSelector: boolean
}

export interface ResolutionResult {
  rootId: string | null
  nodes: GraphNode[]
  edges: GraphEdge[]
  insights: DependencyInsights
  limits: ResolutionLimits
  rootOptions: RootOptions
  effectiveInputs: ResolutionInputs
}
