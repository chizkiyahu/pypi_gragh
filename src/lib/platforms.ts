import type { PlatformOption } from '../types.ts'

export interface PlatformDescriptor {
  id: PlatformOption
  label: string
  family: 'linux' | 'windows' | 'macos'
  sysPlatform: string
  platformSystem: string
  osName: string
  machine: string
}

interface BrowserPlatformHints {
  platform?: string | null
  userAgent?: string | null
  userAgentData?: BrowserUserAgentDataLike | null
}

interface BrowserHighEntropyValues {
  architecture?: string
  bitness?: string
  platform?: string
}

interface BrowserUserAgentDataLike {
  platform?: string
  architecture?: string
  bitness?: string
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<BrowserHighEntropyValues>
}

const PLATFORM_DESCRIPTORS: PlatformDescriptor[] = [
  {
    id: 'linux-x86_64',
    label: 'Linux x86_64',
    family: 'linux',
    sysPlatform: 'linux',
    platformSystem: 'Linux',
    osName: 'posix',
    machine: 'x86_64',
  },
  {
    id: 'linux-aarch64',
    label: 'Linux ARM64',
    family: 'linux',
    sysPlatform: 'linux',
    platformSystem: 'Linux',
    osName: 'posix',
    machine: 'aarch64',
  },
  {
    id: 'linux-armv7l',
    label: 'Linux ARMv7',
    family: 'linux',
    sysPlatform: 'linux',
    platformSystem: 'Linux',
    osName: 'posix',
    machine: 'armv7l',
  },
  {
    id: 'linux-x86',
    label: 'Linux x86',
    family: 'linux',
    sysPlatform: 'linux',
    platformSystem: 'Linux',
    osName: 'posix',
    machine: 'i686',
  },
  {
    id: 'linux-ppc64le',
    label: 'Linux PPC64LE',
    family: 'linux',
    sysPlatform: 'linux',
    platformSystem: 'Linux',
    osName: 'posix',
    machine: 'ppc64le',
  },
  {
    id: 'linux-s390x',
    label: 'Linux s390x',
    family: 'linux',
    sysPlatform: 'linux',
    platformSystem: 'Linux',
    osName: 'posix',
    machine: 's390x',
  },
  {
    id: 'windows-x86_64',
    label: 'Windows x86_64',
    family: 'windows',
    sysPlatform: 'win32',
    platformSystem: 'Windows',
    osName: 'nt',
    machine: 'AMD64',
  },
  {
    id: 'windows-arm64',
    label: 'Windows ARM64',
    family: 'windows',
    sysPlatform: 'win32',
    platformSystem: 'Windows',
    osName: 'nt',
    machine: 'ARM64',
  },
  {
    id: 'windows-x86',
    label: 'Windows x86',
    family: 'windows',
    sysPlatform: 'win32',
    platformSystem: 'Windows',
    osName: 'nt',
    machine: 'x86',
  },
  {
    id: 'macos-arm64',
    label: 'macOS ARM64',
    family: 'macos',
    sysPlatform: 'darwin',
    platformSystem: 'Darwin',
    osName: 'posix',
    machine: 'arm64',
  },
  {
    id: 'macos-x86_64',
    label: 'macOS x86_64',
    family: 'macos',
    sysPlatform: 'darwin',
    platformSystem: 'Darwin',
    osName: 'posix',
    machine: 'x86_64',
  },
]

const PLATFORM_DESCRIPTOR_MAP = new Map(
  PLATFORM_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
)

export const COMMON_PLATFORM_OPTIONS = PLATFORM_DESCRIPTORS.map((descriptor) => descriptor.id)
export const DEFAULT_PLATFORM: PlatformOption = 'linux-x86_64'

export function normalizePlatformTarget(value: string): PlatformOption {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return DEFAULT_PLATFORM
  }

  if (normalized === 'linux') {
    return 'linux-x86_64'
  }
  if (normalized === 'windows' || normalized === 'win32') {
    return 'windows-x86_64'
  }
  if (normalized === 'macos' || normalized === 'darwin') {
    return 'macos-arm64'
  }

  return normalized
}

export function getPlatformDescriptor(target: PlatformOption): PlatformDescriptor {
  const normalized = normalizePlatformTarget(target)
  const descriptor = PLATFORM_DESCRIPTOR_MAP.get(normalized)
  if (descriptor) {
    return descriptor
  }

  const [family = 'linux', machine = 'x86_64'] = normalized.split('-', 2)
  return {
    id: normalized,
    label: `${formatFamilyLabel(family)} ${machine}`,
    family: family === 'windows' || family === 'macos' ? family : 'linux',
    sysPlatform: family === 'windows' ? 'win32' : family === 'macos' ? 'darwin' : 'linux',
    platformSystem: family === 'windows' ? 'Windows' : family === 'macos' ? 'Darwin' : 'Linux',
    osName: family === 'windows' ? 'nt' : 'posix',
    machine,
  }
}

export function formatPlatformOption(target: PlatformOption): string {
  return getPlatformDescriptor(target).label
}

export function sortPlatformOptions(values: Iterable<PlatformOption>): PlatformOption[] {
  const order = new Map(COMMON_PLATFORM_OPTIONS.map((value, index) => [value, index]))

  return [...new Set([...values].filter(Boolean).map(normalizePlatformTarget))].sort((left, right) => {
    const leftOrder = order.get(left)
    const rightOrder = order.get(right)
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder
    }
    if (leftOrder !== undefined) {
      return -1
    }
    if (rightOrder !== undefined) {
      return 1
    }
    return left.localeCompare(right)
  })
}

export function detectBrowserPlatformSync(
  hints: BrowserPlatformHints = getBrowserPlatformHints(),
): PlatformOption {
  const family = detectPlatformFamily(hints)
  if (!family) {
    return DEFAULT_PLATFORM
  }

  const machine = detectPlatformMachine(hints, family)
  return normalizePlatformTarget(`${family}-${machine}`)
}

export async function detectBrowserPlatform(
  hints: BrowserPlatformHints = getBrowserPlatformHints(),
): Promise<PlatformOption> {
  const userAgentData = hints.userAgentData

  if (!userAgentData?.getHighEntropyValues) {
    return detectBrowserPlatformSync(hints)
  }

  try {
    const highEntropyValues = await userAgentData.getHighEntropyValues([
      'architecture',
      'bitness',
      'platform',
    ])

    return detectBrowserPlatformSync({
      ...hints,
      platform: highEntropyValues.platform ?? userAgentData.platform ?? hints.platform,
      userAgentData: {
        ...userAgentData,
        ...highEntropyValues,
      },
    })
  } catch {
    return detectBrowserPlatformSync(hints)
  }
}

function formatFamilyLabel(family: string): string {
  if (family === 'macos') {
    return 'macOS'
  }
  if (family === 'windows') {
    return 'Windows'
  }
  return 'Linux'
}

function getBrowserPlatformHints(): BrowserPlatformHints {
  if (typeof navigator === 'undefined') {
    return {}
  }

  return {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    userAgentData: 'userAgentData' in navigator
      ? (navigator as Navigator & { userAgentData?: BrowserUserAgentDataLike }).userAgentData ?? null
      : null,
  }
}

function detectPlatformFamily(hints: BrowserPlatformHints): PlatformDescriptor['family'] | null {
  const haystack = [
    hints.userAgentData?.platform,
    hints.platform,
    hints.userAgent,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!haystack) {
    return null
  }

  if (haystack.includes('windows') || haystack.includes('win32') || haystack.includes('win64')) {
    return 'windows'
  }

  if (haystack.includes('mac') || haystack.includes('darwin')) {
    return 'macos'
  }

  if (haystack.includes('linux') || haystack.includes('x11')) {
    return 'linux'
  }

  return null
}

function detectPlatformMachine(
  hints: BrowserPlatformHints,
  family: PlatformDescriptor['family'],
): string {
  const architecture = hints.userAgentData?.architecture?.toLowerCase() ?? ''
  const bitness = hints.userAgentData?.bitness?.toLowerCase() ?? ''
  const haystack = [
    architecture,
    bitness,
    hints.userAgentData?.platform,
    hints.platform,
    hints.userAgent,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (
    haystack.includes('aarch64') ||
    haystack.includes('arm64') ||
    haystack.includes('armv8') ||
    (architecture === 'arm' && bitness === '64')
  ) {
    return family === 'linux' ? 'aarch64' : 'arm64'
  }

  if (haystack.includes('armv7') || haystack.includes('armv7l')) {
    return 'armv7l'
  }

  if (haystack.includes('ppc64le')) {
    return 'ppc64le'
  }

  if (haystack.includes('s390x')) {
    return 's390x'
  }

  if (
    haystack.includes('x86_64') ||
    haystack.includes('x64') ||
    haystack.includes('amd64') ||
    haystack.includes('win64') ||
    haystack.includes('wow64') ||
    hints.platform === 'MacIntel'
  ) {
    return 'x86_64'
  }

  if (
    haystack.includes('i386') ||
    haystack.includes('i686') ||
    haystack.includes(' x86') ||
    haystack.endsWith('x86')
  ) {
    return family === 'windows' ? 'x86' : 'i686'
  }

  if (family === 'macos') {
    return 'arm64'
  }

  if (family === 'windows') {
    return 'x86_64'
  }

  return 'x86_64'
}

