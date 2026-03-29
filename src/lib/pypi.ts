import type {
  CacheStore,
  PypiProjectResponse,
  PypiVersionResponse,
} from '../types.ts'
import { normalizePackageName } from './versions.ts'

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12

interface CachedResponse<T> {
  data: T
  source: 'cache' | 'network'
}

export interface PypiClient {
  getProject(name: string): Promise<CachedResponse<PypiProjectResponse>>
  getVersion(name: string, version: string): Promise<CachedResponse<PypiVersionResponse>>
}

interface PypiClientOptions {
  cache: CacheStore
  ttlMs?: number
  fetcher?: typeof fetch
}

export function createPypiClient(options: PypiClientOptions): PypiClient {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const fetcher = options.fetcher ?? fetch
  const inflight = new Map<string, Promise<CachedResponse<unknown>>>()

  async function requestJson<T>(cacheKey: string, url: string): Promise<CachedResponse<T>> {
    const existing = inflight.get(cacheKey)
    if (existing) {
      return existing as Promise<CachedResponse<T>>
    }

    const pending = (async () => {
      const cached = await options.cache.get<T>(cacheKey)
      const now = Date.now()
      if (cached && cached.expiresAt > now) {
        return {
          data: cached.value,
          source: 'cache' as const,
        }
      }

      const response = await fetcher(url, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`PyPI request failed with ${response.status} for ${url}`)
      }

      const data = (await response.json()) as T
      await options.cache.set({
        key: cacheKey,
        value: data,
        fetchedAt: now,
        expiresAt: now + ttlMs,
      })

      return {
        data,
        source: 'network' as const,
      }
    })().finally(() => {
      inflight.delete(cacheKey)
    })

    inflight.set(cacheKey, pending as Promise<CachedResponse<unknown>>)
    return pending
  }

  return {
    getProject(name) {
      const normalized = normalizePackageName(name)
      return requestJson<PypiProjectResponse>(
        `project:${normalized}:latest`,
        `https://pypi.org/pypi/${encodeURIComponent(normalized)}/json`,
      )
    },
    getVersion(name, version) {
      const normalized = normalizePackageName(name)
      return requestJson<PypiVersionResponse>(
        `project:${normalized}:${version}`,
        `https://pypi.org/pypi/${encodeURIComponent(normalized)}/${encodeURIComponent(version)}/json`,
      )
    },
  }
}
