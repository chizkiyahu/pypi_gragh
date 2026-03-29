import type { CacheEntry, CacheStore } from '../types.ts'

const DB_NAME = 'pypi-graph-cache'
const STORE_NAME = 'responses'
const DB_VERSION = 1

export class MemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, CacheEntry<unknown>>()

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key)
    return (entry as CacheEntry<T> | undefined) ?? null
  }

  async set<T>(entry: CacheEntry<T>): Promise<void> {
    this.store.set(entry.key, entry as CacheEntry<unknown>)
  }
}

class IndexedDbCacheStore implements CacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null
  private readonly fallback = new MemoryCacheStore()

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open cache'))
    })

    return this.dbPromise
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const db = await this.openDb()
      return await new Promise<CacheEntry<T> | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.get(key)
        request.onsuccess = () => resolve((request.result as CacheEntry<T> | undefined) ?? null)
        request.onerror = () => reject(request.error ?? new Error('Failed to read cache'))
      })
    } catch {
      return this.fallback.get<T>(key)
    }
  }

  async set<T>(entry: CacheEntry<T>): Promise<void> {
    try {
      const db = await this.openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(entry)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error('Failed to write cache'))
      })
    } catch {
      await this.fallback.set(entry)
    }
  }
}

export function createBrowserCacheStore(): CacheStore {
  if (typeof indexedDB === 'undefined') {
    return new MemoryCacheStore()
  }

  return new IndexedDbCacheStore()
}
