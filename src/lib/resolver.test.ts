import { describe, expect, it } from 'vitest'
import { MemoryCacheStore } from './cache.ts'
import { evaluateMarker, parseMarkerExpression } from './marker.ts'
import { createPypiClient } from './pypi.ts'
import { resolveDependencyGraph } from './resolver.ts'
import { parseRequirement } from './requirements.ts'
import { selectVersion } from './versions.ts'

describe('requirement parsing', () => {
  it('parses extras, specifiers, and markers', () => {
    const requirement = parseRequirement(
      'httpx[socks]>=0.27.0; python_version >= "3.9" and sys_platform != "win32"',
    )

    expect(requirement.name).toBe('httpx')
    expect(requirement.extras).toEqual(['socks'])
    expect(requirement.specifier).toBe('>=0.27.0')
    expect(requirement.markerText).toBe('python_version >= "3.9" and sys_platform != "win32"')
  })
})

describe('marker evaluation', () => {
  it('evaluates platform and version markers', () => {
    const marker = parseMarkerExpression('python_version >= "3.11" and sys_platform == "linux"')
    const evaluation = evaluateMarker(marker, {
      pythonVersion: '3.12',
      pythonFullVersion: '3.12.0',
      sysPlatform: 'linux',
      platformSystem: 'Linux',
      osName: 'posix',
      platformMachine: 'x86_64',
      implementationName: 'cpython',
      implementationVersion: '3.12.0',
      platformPythonImplementation: 'CPython',
      extras: [],
    }, 'python_version >= "3.11" and sys_platform == "linux"')

    expect(evaluation.active).toBe(true)
  })
})

describe('version selection', () => {
  it('prefers the latest legal version and rejects illegal overrides', () => {
    const choice = selectVersion(['1.0.0', '1.2.0', '2.0.0'], ['>=1,<2'])
    expect(choice.selectedVersion).toBe('1.2.0')

    const rejected = selectVersion(['1.0.0', '1.2.0', '2.0.0'], ['>=1,<2'], '2.0.0')
    expect(rejected.selectedVersion).toBeNull()
    expect(rejected.legalVersions).toEqual(['1.2.0', '1.0.0'])
  })
})

describe('resolver integration', () => {
  it('builds a recursive graph using cached project responses', async () => {
    const fixtures = new Map<string, object>([
      [
        'https://pypi.org/pypi/demo/json',
        {
          info: {
            name: 'demo',
            version: '1.0.0',
            summary: 'demo root',
            requires_dist: ['dep>=2; python_version >= "3.11"'],
            requires_python: '>=3.11',
            provides_extra: ['speed'],
            package_url: 'https://pypi.org/project/demo/',
          },
          releases: {
            '1.0.0': [
              {
                filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
                packagetype: 'bdist_wheel',
                python_version: 'cp312',
                requires_python: '>=3.11',
                yanked: false,
              },
              {
                filename: 'demo-1.0.0-cp312-cp312-macosx_11_0_arm64.whl',
                packagetype: 'bdist_wheel',
                python_version: 'cp312',
                requires_python: '>=3.11',
                yanked: false,
              },
            ],
          },
        },
      ],
      [
        'https://pypi.org/pypi/dep/json',
        {
          info: {
            name: 'dep',
            version: '2.2.0',
            summary: 'dep latest',
            requires_dist: ['leaf>=1'],
            requires_python: null,
            provides_extra: null,
            package_url: 'https://pypi.org/project/dep/',
          },
          releases: {
            '2.0.0': [
              {
                filename: 'dep-2.0.0.tar.gz',
                packagetype: 'sdist',
                python_version: 'source',
                requires_python: null,
                yanked: false,
              },
            ],
            '2.2.0': [
              {
                filename: 'dep-2.2.0.tar.gz',
                packagetype: 'sdist',
                python_version: 'source',
                requires_python: null,
                yanked: false,
              },
            ],
          },
        },
      ],
      [
        'https://pypi.org/pypi/leaf/json',
        {
          info: {
            name: 'leaf',
            version: '1.5.0',
            summary: 'leaf latest',
            requires_dist: null,
            requires_python: null,
            provides_extra: null,
            package_url: 'https://pypi.org/project/leaf/',
          },
          releases: {
            '1.5.0': [
              {
                filename: 'leaf-1.5.0.tar.gz',
                packagetype: 'sdist',
                python_version: 'source',
                requires_python: null,
                yanked: false,
              },
            ],
          },
        },
      ],
    ])

    const fetcher = async (input: RequestInfo | URL) => {
      const key = String(input)
      const data = fixtures.get(key)
      if (!data) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    const client = createPypiClient({
      cache: new MemoryCacheStore(),
      fetcher,
      ttlMs: 1000 * 60 * 60,
    })

    const graph = await resolveDependencyGraph({
      packageName: 'demo',
      pythonVersion: '3.12',
      platform: 'linux',
      extras: [],
      manualVersions: {},
    }, client)

    expect(graph.nodes.map((node) => node.packageName)).toEqual(['demo', 'dep', 'leaf'])
    expect(graph.edges).toHaveLength(2)
    expect(graph.limits.networkRequests).toBe(3)
    expect(graph.rootOptions.supportedPythonVersions).toEqual(['3.11', '3.12', '3.13'])
    expect(graph.rootOptions.supportedPlatforms).toEqual(['linux', 'macos'])
    expect(graph.rootOptions.showPythonSelector).toBe(true)
    expect(graph.rootOptions.showPlatformSelector).toBe(true)
  })
})
