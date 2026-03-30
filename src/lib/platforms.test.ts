import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLATFORM,
  detectBrowserPlatform,
  detectBrowserPlatformSync,
} from './platforms.ts'

describe('browser platform detection', () => {
  it('detects linux arm64 from synchronous browser hints', () => {
    const detected = detectBrowserPlatformSync({
      platform: 'Linux aarch64',
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36',
    })

    expect(detected).toBe('linux-aarch64')
  })

  it('detects windows x86_64 from synchronous browser hints', () => {
    const detected = detectBrowserPlatformSync({
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })

    expect(detected).toBe('windows-x86_64')
  })

  it('uses high-entropy browser hints to refine macOS arm64 detection', async () => {
    const detected = await detectBrowserPlatform({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      userAgentData: {
        platform: 'macOS',
        async getHighEntropyValues() {
          return {
            architecture: 'arm',
            bitness: '64',
            platform: 'macOS',
          }
        },
      },
    })

    expect(detected).toBe('macos-arm64')
  })

  it('falls back to the default platform when the browser platform is unknown', () => {
    const detected = detectBrowserPlatformSync({
      platform: 'PlayStation',
      userAgent: 'Mozilla/5.0',
    })

    expect(detected).toBe(DEFAULT_PLATFORM)
  })
})

