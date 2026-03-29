import { useEffect, useRef, useState } from 'preact/hooks'
import './app.css'
import { GraphCanvas } from './components/GraphCanvas.tsx'
import { createBrowserCacheStore } from './lib/cache.ts'
import { createPypiClient } from './lib/pypi.ts'
import { resolveDependencyGraph } from './lib/resolver.ts'
import { getDefaultInputs, readInputsFromUrl, writeInputsToUrl } from './lib/url-state.ts'
import { normalizePackageName } from './lib/versions.ts'
import type { GraphNode, PlatformOption, ResolutionInputs, ResolutionResult } from './types.ts'

const SAMPLE_PACKAGES = ['fastapi', 'httpx', 'apache-airflow', 'pydantic']

export function App() {
  const cacheRef = useRef(createBrowserCacheStore())
  const clientRef = useRef(createPypiClient({ cache: cacheRef.current }))
  const initialInputsRef = useRef(
    typeof window === 'undefined' ? getDefaultInputs() : readInputsFromUrl(),
  )
  const initialInputs = initialInputsRef.current

  const [inputs, setInputs] = useState<ResolutionInputs>(initialInputs)
  const [result, setResult] = useState<ResolutionResult | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    initialInputs.packageName ? 'loading' : 'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const latestRequestId = useRef(0)
  const syncingInputsRef = useRef(false)

  useEffect(() => {
    writeInputsToUrl(inputs)
  }, [inputs])

  useEffect(() => {
    if (!initialInputs.packageName.trim()) {
      return
    }

    void runResolution(initialInputs)
  }, [])

  async function runResolution(nextInputs: ResolutionInputs) {
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    setStatus('loading')
    setError(null)

    try {
      const nextResult = await resolveDependencyGraph(nextInputs, clientRef.current)
      if (latestRequestId.current !== requestId) {
        return
      }
      if (!sameResolutionInputs(nextInputs, nextResult.effectiveInputs)) {
        syncingInputsRef.current = true
        setInputs(nextResult.effectiveInputs)
      }
      setResult(nextResult)
      setSelectedNodeId(nextResult.rootId)
      setStatus('ready')
    } catch (resolveError) {
      if (latestRequestId.current !== requestId) {
        return
      }
      setStatus('error')
      setError(resolveError instanceof Error ? resolveError.message : 'The graph could not be built.')
    }
  }

  function updateInputs(mutator: (current: ResolutionInputs) => ResolutionInputs) {
    setInputs((current) => mutator(current))
  }

  function handleSubmit(event: Event) {
    event.preventDefault()
    void runResolution(inputs)
  }

  function handlePlatformChange(platform: PlatformOption) {
    updateInputs((current) => ({ ...current, platform }))
  }

  function handleVersionOverride(packageName: string, version: string) {
    updateInputs((current) => {
      const manualVersions = { ...current.manualVersions }
      const normalizedName = normalizePackageName(packageName)
      if (version) {
        manualVersions[normalizedName] = version
      } else {
        delete manualVersions[normalizedName]
      }
      return {
        ...current,
        manualVersions,
      }
    })
  }

  useEffect(() => {
    if (syncingInputsRef.current) {
      syncingInputsRef.current = false
      return
    }

    if (!result || !inputs.packageName.trim()) {
      return
    }

    void runResolution(inputs)
  }, [
    inputs.extras.join(','),
    JSON.stringify(inputs.manualVersions),
    inputs.platform,
    inputs.pythonVersion,
  ])

  const hasFreshResult =
    result !== null &&
    normalizePackageName(inputs.packageName) === normalizePackageName(result.effectiveInputs.packageName)
  const rootOptions = hasFreshResult ? result?.rootOptions ?? null : null
  const extras = rootOptions?.extras ?? []
  const pythonOptions = rootOptions?.supportedPythonVersions ?? []
  const platformOptions = rootOptions?.supportedPlatforms ?? []
  const showPythonSelector = Boolean(rootOptions?.showPythonSelector)
  const showPlatformSelector = Boolean(rootOptions?.showPlatformSelector)
  const selectedNode =
    selectedNodeId && result ? result.nodes.find((node) => node.id === selectedNodeId) ?? null : null

  return (
    <div class="shell">
      <div class="ambient ambient-left" />
      <div class="ambient ambient-right" />

      <header class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">PyPI dependency atlas</p>
          <h1>Inspect the graph fast.</h1>
          <p class="lede">Fetch PyPI metadata, reuse a local cache, and switch only the root-level knobs that actually change the graph.</p>
        </div>
        <div class="hero-card">
          <span>Static by design</span>
          <p>GitHub Pages frontend, IndexedDB cache, recursive marker-aware resolution, no backend.</p>
        </div>
      </header>

      <section class="panel control-panel">
        <form class="controls" onSubmit={handleSubmit}>
          <label class="field package-field">
            <span>Package</span>
            <input
              value={inputs.packageName}
              onInput={(event) =>
                updateInputs((current) => ({
                  ...current,
                  packageName: (event.currentTarget as HTMLInputElement).value,
                }))}
              placeholder="fastapi"
              spellcheck={false}
            />
          </label>

          {showPythonSelector ? (
            <div class="field environment-field">
              <span>Python versions from this package</span>
              <div class="pill-row">
                {pythonOptions.map((version) => (
                  <button
                    type="button"
                    class={version === inputs.pythonVersion ? 'pill active' : 'pill'}
                    onClick={() =>
                      updateInputs((current) => ({
                        ...current,
                        pythonVersion: version,
                      }))}
                  >
                    {version}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showPlatformSelector ? (
            <div class="field environment-field">
              <span>Platforms from this package</span>
              <div class="pill-row">
                {platformOptions.map((platform) => (
                  <button
                    type="button"
                    class={platform === inputs.platform ? 'pill active' : 'pill'}
                    onClick={() => handlePlatformChange(platform)}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div class="field field-extras">
            <span>Top-level extras</span>
            <div class="extras-grid">
              {extras.length > 0 ? (
                extras.map((extra) => {
                  const active = inputs.extras.includes(extra)
                  return (
                    <label class={active ? 'chip active' : 'chip'}>
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(event) => {
                          const enabled = (event.currentTarget as HTMLInputElement).checked
                          updateInputs((current) => ({
                            ...current,
                            extras: enabled
                              ? [...new Set([...current.extras, extra])].sort((left, right) => left.localeCompare(right))
                              : current.extras.filter((value) => value !== extra),
                          }))
                        }}
                      />
                      <span>{extra}</span>
                    </label>
                  )
                })
              ) : (
                <p class="helper-text">Extras appear after the root package metadata is loaded.</p>
              )}
            </div>
          </div>

          <div class="control-actions">
            <button
              class="primary"
              type="submit"
              disabled={!inputs.packageName.trim() || status === 'loading'}
            >
              {status === 'loading' ? 'Resolving graph...' : 'Build graph'}
            </button>
            <button
              class="secondary"
              type="button"
              onClick={() => {
                const nextInputs = getDefaultInputs()
                setInputs(nextInputs)
                setResult(null)
                setSelectedNodeId(null)
                setStatus('idle')
                setError(null)
              }}
            >
              Reset
            </button>
          </div>
        </form>

        <div class="sample-row">
          <span>Quick starts</span>
          {SAMPLE_PACKAGES.map((sample) => (
            <button
              class="sample-link"
              type="button"
              onClick={() =>
                setInputs((current) => ({
                  ...current,
                  packageName: sample,
                  extras: [],
                  manualVersions: {},
                }))}
            >
              {sample}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <section class="panel error-panel">
          <strong>Resolution failed.</strong>
          <p>{error}</p>
        </section>
      ) : null}

      <section class="stats-grid">
        <article class="stat-card">
          <span>Nodes</span>
          <strong>{result?.nodes.length ?? 0}</strong>
        </article>
        <article class="stat-card">
          <span>Edges</span>
          <strong>{result?.edges.length ?? 0}</strong>
        </article>
        <article class="stat-card">
          <span>Cache hits</span>
          <strong>{result?.limits.cacheHits ?? 0}</strong>
        </article>
        <article class="stat-card">
          <span>Network calls</span>
          <strong>{result?.limits.networkRequests ?? 0}</strong>
        </article>
      </section>

      <section class="layout-grid">
        <div class="panel graph-panel">
          <div class="panel-header">
            <div>
              <p class="section-kicker">Dependency graph</p>
              <h2>
                {result
                  ? `${result.effectiveInputs.packageName} graph`
                  : inputs.packageName
                    ? `${inputs.packageName} graph`
                    : 'Load a package to begin'}
              </h2>
            </div>
            {result ? (
              <div class="summary-badges">
                <span>{result.limits.cycleEdges} cycle edges</span>
                <span>{result.limits.unresolvedNodes} unresolved</span>
                <span>{result.limits.skippedDirectReferences} direct refs</span>
              </div>
            ) : null}
          </div>

          <div class="graph-frame">
            {result ? (
              <GraphCanvas
                nodes={result.nodes}
                edges={result.edges}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
            ) : (
              <div class="graph-empty">
                <p>Search a package, fetch its metadata, then inspect the recursive graph.</p>
              </div>
            )}
          </div>
        </div>

        <aside class="panel side-panel">
          <div class="panel-header stacked">
            <p class="section-kicker">Limits and choices</p>
            <h2>Resolution lens</h2>
          </div>

          <div class="selection-card">
            <span>Selected inputs</span>
            <ul class="plain-list">
              <li><strong>Package</strong> {inputs.packageName || 'none'}</li>
              {showPythonSelector ? <li><strong>Python</strong> {inputs.pythonVersion}</li> : null}
              {showPlatformSelector ? <li><strong>Platform</strong> {inputs.platform}</li> : null}
              {extras.length > 0 ? (
                <li><strong>Extras</strong> {inputs.extras.length ? inputs.extras.join(', ') : 'none'}</li>
              ) : null}
            </ul>
          </div>

          <div class="selection-card">
            <span>Root package metadata</span>
            <ul class="plain-list">
              {showPythonSelector ? (
                <li><strong>Python versions</strong> {pythonOptions.join(', ')}</li>
              ) : null}
              {showPlatformSelector ? (
                <li><strong>Platforms</strong> {platformOptions.join(', ')}</li>
              ) : null}
              {extras.length > 0 ? (
                <li><strong>Extras</strong> {extras.join(', ')}</li>
              ) : null}
              {!showPythonSelector && !showPlatformSelector && extras.length === 0 ? (
                <li>No root-specific python/platform split was detected.</li>
              ) : null}
            </ul>
          </div>

          <div class="selection-card">
            <span>Model limits</span>
            <ul class="plain-list">
              <li>Resolver is metadata-based and does not replicate pip’s SAT solving.</li>
              <li>Direct URL dependencies are shown but not recursively expanded.</li>
              <li>Extras can be changed only for the root package; downstream extras come from requirement declarations.</li>
            </ul>
          </div>

          <div class="panel-header stacked">
            <p class="section-kicker">Inspector</p>
            <h2>{selectedNode ? selectedNode.packageName : 'Select a node'}</h2>
          </div>

            {selectedNode ? (
              <NodeInspector
                node={selectedNode}
                rootId={result?.rootId ?? null}
                onOverrideChange={(version) => {
                  handleVersionOverride(selectedNode.packageName, version)
                }}
              />
            ) : (
            <p class="helper-text">Click a node in the graph to inspect its constraints, available versions, and excluded requirements.</p>
          )}
        </aside>
      </section>
    </div>
  )
}

interface NodeInspectorProps {
  node: GraphNode
  rootId: string | null
  onOverrideChange: (value: string) => void
}

function NodeInspector(props: NodeInspectorProps) {
  const canOverride = props.node.kind === 'package' && props.node.id !== props.rootId
  const overrideValue = props.node.manualOverride ?? ''

  return (
    <div class="inspector">
      <p class="node-title">
        {props.node.packageName} <span>{props.node.displayVersion}</span>
      </p>
      <p class="node-summary">{props.node.summary}</p>

      <ul class="plain-list">
        <li><strong>Extras on this node</strong> {props.node.selectedExtras.length ? props.node.selectedExtras.join(', ') : 'none'}</li>
        <li><strong>Requires Python</strong> {props.node.requiresPython ?? 'not declared'}</li>
        <li><strong>Constraint fragments</strong> {props.node.combinedSpecifiers.join(', ') || 'none'}</li>
        <li><strong>Metadata source</strong> {props.node.cacheSource}</li>
      </ul>

      {canOverride ? (
        <label class="field">
          <span>Manual version override</span>
          <select value={overrideValue} onChange={(event) => props.onOverrideChange((event.currentTarget as HTMLSelectElement).value)}>
            <option value="">Auto select latest legal version</option>
            {props.node.availableVersions.slice(0, 120).map((version) => (
              <option value={version}>{version}</option>
            ))}
          </select>
        </label>
      ) : null}

      {props.node.incomingRequirements.length > 0 ? (
        <div class="detail-block">
          <span>Incoming requirements</span>
          <ul class="detail-list">
            {props.node.incomingRequirements.map((requirement) => (
              <li>{requirement}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.node.inactiveRequirements.length > 0 ? (
        <div class="detail-block">
          <span>Excluded in this view</span>
          <ul class="detail-list muted">
            {props.node.inactiveRequirements.slice(0, 8).map((requirement) => (
              <li>
                <strong>{requirement.raw}</strong>
                <small>{requirement.reason}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.node.notes.length > 0 ? (
        <div class="detail-block">
          <span>Notes</span>
          <ul class="detail-list">
            {props.node.notes.map((note) => (
              <li>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function sameResolutionInputs(left: ResolutionInputs, right: ResolutionInputs): boolean {
  return (
    left.packageName === right.packageName &&
    left.pythonVersion === right.pythonVersion &&
    left.platform === right.platform &&
    left.extras.join(',') === right.extras.join(',') &&
    JSON.stringify(left.manualVersions) === JSON.stringify(right.manualVersions)
  )
}
