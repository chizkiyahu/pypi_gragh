import type { PlatformOption, ResolutionInputs } from '../types.ts'
import { COMMON_PYTHON_VERSIONS, normalizePackageName } from './versions.ts'

const DEFAULT_INPUTS: ResolutionInputs = {
  packageName: '',
  pythonVersion: '3.12',
  platform: 'linux',
  extras: [],
  manualVersions: {},
}

export function getDefaultInputs(): ResolutionInputs {
  return structuredClone(DEFAULT_INPUTS)
}

export function readInputsFromUrl(): ResolutionInputs {
  const search = new URLSearchParams(window.location.search)
  const packageName = search.get('pkg')?.trim() ?? DEFAULT_INPUTS.packageName
  const pythonVersion = search.get('py')?.trim() ?? DEFAULT_INPUTS.pythonVersion
  const platform = parsePlatform(search.get('platform')) ?? DEFAULT_INPUTS.platform
  const extras = search
    .get('extras')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? []
  const manualVersions = parseManualOverrides(search.get('ov'))

  return {
    packageName,
    pythonVersion: COMMON_PYTHON_VERSIONS.includes(pythonVersion) ? pythonVersion : pythonVersion,
    platform,
    extras,
    manualVersions,
  }
}

export function writeInputsToUrl(inputs: ResolutionInputs): void {
  const search = new URLSearchParams()
  if (inputs.packageName.trim()) {
    search.set('pkg', inputs.packageName.trim())
  }
  search.set('py', inputs.pythonVersion)
  search.set('platform', inputs.platform)
  if (inputs.extras.length > 0) {
    search.set('extras', [...new Set(inputs.extras)].sort((left, right) => left.localeCompare(right)).join(','))
  }
  const overrides = stringifyManualOverrides(inputs.manualVersions)
  if (overrides) {
    search.set('ov', overrides)
  }
  const nextUrl = `${window.location.pathname}?${search.toString()}`
  window.history.replaceState({}, '', nextUrl)
}

function parsePlatform(value: string | null): PlatformOption | null {
  if (value === 'linux' || value === 'windows' || value === 'macos') {
    return value
  }
  return null
}

function parseManualOverrides(value: string | null): Record<string, string> {
  if (!value) {
    return {}
  }

  return value.split(',').reduce<Record<string, string>>((accumulator, entry) => {
    const [packageName, version] = entry.split(':')
    if (!packageName || !version) {
      return accumulator
    }

    accumulator[normalizePackageName(packageName)] = version
    return accumulator
  }, {})
}

function stringifyManualOverrides(value: Record<string, string>): string {
  return Object.entries(value)
    .filter(([, version]) => Boolean(version))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, version]) => `${packageName}:${version}`)
    .join(',')
}
