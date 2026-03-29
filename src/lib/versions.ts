import { compare, satisfies, valid } from '@renovatebot/pep440'

export const COMMON_PYTHON_VERSIONS = ['3.7', '3.8', '3.9', '3.10', '3.11', '3.12', '3.13']

export interface VersionChoice {
  selectedVersion: string | null
  legalVersions: string[]
  rejectionReason: string | null
}

export function normalizePackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-')
}

export function normalizePythonVersion(version: string): string {
  const trimmed = version.trim()
  if (/^\d+\.\d+$/.test(trimmed)) {
    return `${trimmed}.0`
  }

  return trimmed
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function compareVersionsDesc(left: string, right: string): number {
  return compare(right, left)
}

function filterValidVersions(versions: string[]): string[] {
  return versions.filter((version) => Boolean(valid(version)))
}

function matchesAllSpecifiers(version: string, specifiers: string[], prereleases: boolean): boolean {
  return specifiers.every((specifier) =>
    specifier ? satisfies(version, specifier, { prereleases }) : true,
  )
}

export function selectVersion(
  versions: string[],
  specifiers: string[],
  manualOverride?: string | null,
): VersionChoice {
  const normalizedSpecifiers = specifiers.filter(Boolean)
  const sortedVersions = filterValidVersions(versions).sort(compareVersionsDesc)

  const stableMatches = sortedVersions.filter((version) =>
    matchesAllSpecifiers(version, normalizedSpecifiers, false),
  )
  const prereleaseMatches =
    stableMatches.length > 0
      ? stableMatches
      : sortedVersions.filter((version) => matchesAllSpecifiers(version, normalizedSpecifiers, true))

  if (manualOverride) {
    if (!prereleaseMatches.includes(manualOverride)) {
      return {
        selectedVersion: null,
        legalVersions: prereleaseMatches,
        rejectionReason: `Manual version ${manualOverride} does not satisfy the active constraints.`,
      }
    }

    return {
      selectedVersion: manualOverride,
      legalVersions: prereleaseMatches,
      rejectionReason: null,
    }
  }

  return {
    selectedVersion: prereleaseMatches[0] ?? null,
    legalVersions: prereleaseMatches,
    rejectionReason: prereleaseMatches.length
      ? null
      : normalizedSpecifiers.length
        ? 'No released version satisfied the active constraints.'
        : 'No valid release versions were available on PyPI.',
  }
}
