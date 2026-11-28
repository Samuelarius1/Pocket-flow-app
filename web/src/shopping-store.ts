import { getFinanceOwner } from './finance-store'

export type ShoppingItem = { id: string; version: number; name: string; quantity: number; purchased: boolean; updatedAt: string }
export type ShoppingMutation = {
  id: string
  ownerId: string
  operation: 'create' | 'update' | 'delete'
  recordId: string
  version: number
  data?: Pick<ShoppingItem, 'name' | 'quantity' | 'purchased'>
  queuedAt: string
  attempts: number
  nextAttemptAt?: number
  conflict?: boolean
}

type CacheEntry = { ownerId: string; items: ShoppingItem[] }
type ListResponse = { items: ShoppingItem[] }
const DB_NAME = 'pocketflow-local'
const DB_VERSION = 3
const CACHE = 'shopping-cache'
const OUTBOX = 'shopping-outbox'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences')
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('finance-cache')) db.createObjectStore('finance-cache')
      if (!db.objectStoreNames.contains('finance-outbox')) db.createObjectStore('finance-outbox', { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE)
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function cachedItems(ownerId: string): Promise<ShoppingItem[] | null> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(CACHE).objectStore(CACHE).get(ownerId)
    request.onsuccess = () => {
      const result = request.result as CacheEntry | undefined
      resolve(result?.ownerId === ownerId ? result.items : null)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function saveShoppingCache(items: ShoppingItem[]): Promise<void> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw new Error('Sign in while online before saving a shopping list offline.')
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CACHE, 'readwrite')
    tx.objectStore(CACHE).put({ ownerId, items } satisfies CacheEntry, ownerId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadShoppingItems(): Promise<ListResponse> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw Object.assign(new Error('Sign in to view and sync your shopping list.'), { status: 401 })
  if (navigator.onLine) {
    try {
      const response = await fetch('/api/shopping', { credentials: 'include', cache: 'no-store' })
      if (response.status === 401) throw Object.assign(new Error('Sign in to view and sync your shopping list.'), { status: 401 })
      if (!response.ok) throw new Error('Could not load your shopping list.')
      const result = await response.json() as ListResponse
      await saveShoppingCache(result.items)
      return result
    } catch (error) {
      if ((error as { status?: number }).status === 401) throw error
      const cached = await cachedItems(ownerId)
      if (cached) return { items: cached }
      throw error
    }
  }
  const cached = await cachedItems(ownerId)
  if (!cached) throw new Error('Connect to your account while online to cache your shopping list.')
  return { items: cached }
}

export async function enqueueShoppingMutation(input: Omit<ShoppingMutation, 'id' | 'ownerId' | 'queuedAt' | 'attempts' | 'nextAttemptAt'>): Promise<void> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw new Error('Sign in to queue shopping list changes.')
  const db = await openDatabase()
  const id = `${ownerId}:${input.recordId}`
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite')
    const store = tx.objectStore(OUTBOX)
    const request = store.get(id)
    request.onsuccess = () => {
      const existing = request.result as ShoppingMutation | undefined
      if (existing?.operation === 'create' && input.operation === 'delete') {
        store.delete(id)
      } else {
        store.put({ ...input, id, ownerId, queuedAt: existing?.queuedAt ?? new Date().toISOString(), attempts: existing?.attempts ?? 0, nextAttemptAt: existing?.nextAttemptAt, operation: existing?.operation === 'create' ? 'create' : input.operation, version: existing?.version ?? input.version })
      }
    }
    request.onerror = () => tx.abort()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function storeMutation(mutation: ShoppingMutation): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite')
    tx.objectStore(OUTBOX).put(mutation)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function deferMutation(mutation: ShoppingMutation): Promise<void> {
  const attempts = mutation.attempts + 1
  const nextAttemptAt = Date.now() + Math.min(60_000, 1_000 * (2 ** Math.min(attempts - 1, 6)))
  await storeMutation({ ...mutation, attempts, nextAttemptAt })
  window.setTimeout(() => { if (navigator.onLine) void replayShoppingOutbox() }, nextAttemptAt - Date.now())
}

export async function replayShoppingOutbox(force = false): Promise<'synced' | 'offline' | 'sign-in-required' | 'conflict' | 'service-unavailable'> {
  if (!navigator.onLine) return 'offline'
  const ownerId = await getFinanceOwner()
  if (!ownerId) return 'sign-in-required'
  const db = await openDatabase()
  const mutations = await new Promise<ShoppingMutation[]>((resolve, reject) => {
    const request = db.transaction(OUTBOX).objectStore(OUTBOX).getAll()
    request.onsuccess = () => resolve((request.result as ShoppingMutation[]).filter((item) => item.ownerId === ownerId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)))
    request.onerror = () => reject(request.error)
  })
  if (!mutations.length) return 'synced'
  let deferred = false
  for (const mutation of mutations) {
    if (mutation.conflict) { deferred = true; continue }
    if (!force && mutation.nextAttemptAt && mutation.nextAttemptAt > Date.now()) { deferred = true; continue }
    try {
      const response = await fetch(`/api/shopping${mutation.operation === 'create' ? '' : `/${encodeURIComponent(mutation.recordId)}`}`, {
        method: mutation.operation === 'create' ? 'POST' : mutation.operation === 'update' ? 'PUT' : 'DELETE',
        credentials: 'include',
        headers: mutation.operation === 'delete' ? undefined : { 'Content-Type': 'application/json' },
        body: mutation.operation === 'delete' ? undefined : JSON.stringify(mutation.operation === 'create' ? { id: mutation.recordId, ...mutation.data } : { version: mutation.version, ...mutation.data }),
      })
      if (response.status === 401) return 'sign-in-required'
      if (response.status === 409) {
        await storeMutation({ ...mutation, conflict: true })
        window.dispatchEvent(new CustomEvent('pocketflow:shopping-sync-complete', { detail: 'conflict' }))
        return 'conflict'
      }
      if (!response.ok && !(mutation.operation === 'delete' && response.status === 404)) {
        await deferMutation(mutation)
        deferred = true
        continue
      }
      if (mutation.operation === 'delete') {
        const current = await cachedItems(ownerId) ?? []
        await saveShoppingCache(current.filter((item) => item.id !== mutation.recordId))
      } else {
        const item = await response.json() as ShoppingItem
        const current = await cachedItems(ownerId) ?? []
        await saveShoppingCache([item, ...current.filter((entry) => entry.id !== item.id)])
      }
      const tx = db.transaction(OUTBOX, 'readwrite')
      tx.objectStore(OUTBOX).delete(mutation.id)
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    } catch {
      if (!navigator.onLine) return 'offline'
      await deferMutation(mutation)
      deferred = true
    }
  }
  if (!deferred) window.dispatchEvent(new CustomEvent('pocketflow:shopping-sync-complete', { detail: 'synced' }))
  return deferred ? 'service-unavailable' : 'synced'
}

export async function pendingShoppingChanges(): Promise<boolean> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(OUTBOX).objectStore(OUTBOX).count()
    request.onsuccess = () => resolve(request.result > 0)
    request.onerror = () => reject(request.error)
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void replayShoppingOutbox() })
}
