import { apiFetch } from './api'
export type FinanceResource = 'accounts' | 'transactions' | 'budgets' | 'goals'
export type FinanceData = Record<string, string | number>
export type FinanceRecord = { id: string; version: number; data: FinanceData; updatedAt: string }
export type FinanceCategory = { id: string; name: string; kind: string; color: string }
export type FinanceMutation = { id: string; ownerId: string; resource: FinanceResource; operation: 'create' | 'update' | 'delete'; recordId: string; version: number; data?: FinanceData; queuedAt: string; attempts: number; nextAttemptAt?: number; conflict?: boolean }

type CacheEntry = { ownerId: string; records: unknown[] }
const DATABASE = 'pocketflow-local'
const DATABASE_VERSION = 3
const OWNER_KEY = 'finance-owner'
const FINANCE_CACHE = 'finance-cache'
const FINANCE_OUTBOX = 'finance-outbox'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences')
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' })
      if (!db.objectStoreNames.contains(FINANCE_CACHE)) db.createObjectStore(FINANCE_CACHE)
      if (!db.objectStoreNames.contains(FINANCE_OUTBOX)) db.createObjectStore(FINANCE_OUTBOX, { keyPath: 'id' })
      if (!db.objectStoreNames.contains('shopping-cache')) db.createObjectStore('shopping-cache')
      if (!db.objectStoreNames.contains('shopping-outbox')) db.createObjectStore('shopping-outbox', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function read<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  }))
}

function write(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    if (key === undefined) tx.objectStore(storeName).put(value)
    else tx.objectStore(storeName).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

export async function setFinanceOwner(ownerId: string): Promise<void> {
  await write('preferences', ownerId, OWNER_KEY)
}

export async function getFinanceOwner(): Promise<string | null> {
  if (navigator.onLine) {
    try {
      const response = await apiFetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      if (response.status === 401) return null
      if (!response.ok) return (await read<string>('preferences', OWNER_KEY)) ?? null
      const user = await response.json() as { id?: string }
      if (user.id) {
        await write('preferences', user.id, OWNER_KEY)
        return user.id
      }
    } catch {
      // Fall back to the last authenticated owner only when the service is unreachable.
    }
  }
  return (await read<string>('preferences', OWNER_KEY)) ?? null
}

export async function getCachedFinance(resource: FinanceResource): Promise<FinanceRecord[]> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) return []
  const entry = await read<CacheEntry>(FINANCE_CACHE, `${ownerId}:${resource}`)
  return entry?.ownerId === ownerId ? entry.records as FinanceRecord[] : []
}

export async function cacheFinance(resource: FinanceResource, records: FinanceRecord[], ownerId?: string): Promise<void> {
  const resolvedOwner = ownerId ?? await getFinanceOwner()
  if (!resolvedOwner) return
  await write(FINANCE_CACHE, { ownerId: resolvedOwner, records } satisfies CacheEntry, `${resolvedOwner}:${resource}`)
}

export async function cacheFinanceCategories(categories: FinanceCategory[], ownerId?: string): Promise<void> {
  const resolvedOwner = ownerId ?? await getFinanceOwner()
  if (!resolvedOwner) return
  await write(FINANCE_CACHE, { ownerId: resolvedOwner, records: categories } satisfies CacheEntry, `${resolvedOwner}:categories`)
}

export async function loadFinanceCategories(): Promise<FinanceCategory[]> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw new Error('Sign in to view your categories.')
  if (navigator.onLine) {
    try {
      const response = await apiFetch('/api/categories', { credentials: 'include', cache: 'no-store' })
      if (response.status === 401) throw new Error('Sign in to view your categories.')
      if (!response.ok) throw new Error('Could not load categories.')
      const result = await response.json() as { items: FinanceCategory[] }
      await cacheFinanceCategories(result.items, ownerId)
      return result.items
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Sign in')) throw error
      const cached = await read<CacheEntry>(FINANCE_CACHE, `${ownerId}:categories`)
      if (cached?.ownerId === ownerId) return cached.records as FinanceCategory[]
      throw error
    }
  }
  const cached = await read<CacheEntry>(FINANCE_CACHE, `${ownerId}:categories`)
  if (cached?.ownerId !== ownerId) throw new Error('Connect to your account while online to cache categories.')
  return cached.records as FinanceCategory[]
}

export async function enqueueFinanceMutation(mutation: Omit<FinanceMutation, 'id' | 'ownerId' | 'queuedAt' | 'attempts' | 'nextAttemptAt'>): Promise<void> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw new Error('Sign in to queue financial changes.')
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
    const store = tx.objectStore(FINANCE_OUTBOX)
    const key = `${ownerId}:${mutation.resource}:${mutation.recordId}`
    const request = store.get(key)
    request.onsuccess = () => {
      const existing = request.result as FinanceMutation | undefined
      if (existing?.operation === 'create' && mutation.operation === 'delete') {
        store.delete(key)
      } else {
        store.put({ ...mutation, id: key, ownerId, queuedAt: existing?.queuedAt ?? new Date().toISOString(), attempts: existing?.attempts ?? 0, nextAttemptAt: existing?.nextAttemptAt, operation: existing?.operation === 'create' ? 'create' : mutation.operation, version: existing?.version ?? mutation.version })
      }
    }
    request.onerror = () => tx.abort()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function saveCachedFinanceRecord(resource: FinanceResource, record: FinanceRecord): Promise<void> {
  const records = await getCachedFinance(resource)
  await cacheFinance(resource, [record, ...records.filter((item) => item.id !== record.id)])
}

export async function adjustCachedAccountBalance(accountId: string, currency: string, deltaMinor: number): Promise<void> {
  if (!deltaMinor) return
  const accounts = await getCachedFinance('accounts')
  const account = accounts.find((item) => item.id === accountId)
  if (!account || account.data.currency !== currency) return
  await saveCachedFinanceRecord('accounts', {
    ...account,
    data: { ...account.data, balanceMinor: Number(account.data.balanceMinor || 0) + deltaMinor },
    updatedAt: new Date().toISOString(),
  })
}

export async function removeCachedFinanceRecord(resource: FinanceResource, recordId: string): Promise<void> {
  const records = await getCachedFinance(resource)
  await cacheFinance(resource, records.filter((record) => record.id !== recordId))
}

export async function clearFinanceMutation(resource: FinanceResource, recordId: string): Promise<void> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) return
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
    tx.objectStore(FINANCE_OUTBOX).delete(`${ownerId}:${resource}:${recordId}`)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getFinanceConflicts(resource: FinanceResource): Promise<FinanceMutation[]> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) return []
  const db = await openDatabase()
  const mutations = await new Promise<FinanceMutation[]>((resolve, reject) => {
    const request = db.transaction(FINANCE_OUTBOX).objectStore(FINANCE_OUTBOX).getAll()
    request.onsuccess = () => resolve(request.result as FinanceMutation[])
    request.onerror = () => reject(request.error)
  })
  return mutations.filter((mutation) => mutation.ownerId === ownerId && mutation.resource === resource && mutation.conflict)
}

export async function resolveFinanceConflict(
  resource: FinanceResource,
  recordId: string,
  resolution: 'server' | 'local',
  serverRecord?: FinanceRecord,
): Promise<void> {
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw new Error('Sign in to resolve this sync conflict.')
  const db = await openDatabase()
  const key = `${ownerId}:${resource}:${recordId}`
  const mutation = await read<FinanceMutation>(FINANCE_OUTBOX, key)
  if (!mutation?.conflict) return

  if (resolution === 'server' || (!serverRecord && mutation.operation === 'delete')) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
      tx.objectStore(FINANCE_OUTBOX).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    if (serverRecord) await saveCachedFinanceRecord(resource, serverRecord)
    else await removeCachedFinanceRecord(resource, recordId)
    return
  }

  const rebased: FinanceMutation = {
    ...mutation,
    operation: mutation.operation === 'delete' ? 'delete' : serverRecord ? 'update' : 'create',
    version: serverRecord?.version ?? 0,
    conflict: false,
    attempts: 0,
    nextAttemptAt: undefined,
  }
  if (serverRecord && mutation.operation !== 'delete') await saveCachedFinanceRecord(resource, serverRecord)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
    tx.objectStore(FINANCE_OUTBOX).put(rebased)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function deferMutation(db: IDBDatabase, mutation: FinanceMutation): Promise<number> {
  const attempts = mutation.attempts + 1
  const delay = Math.min(60_000, 1_000 * (2 ** Math.min(attempts - 1, 6)))
  const nextAttemptAt = Date.now() + delay
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
    tx.objectStore(FINANCE_OUTBOX).put({ ...mutation, attempts, nextAttemptAt })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  window.setTimeout(() => { if (navigator.onLine) void replayFinanceOutbox() }, delay)
  return nextAttemptAt
}

export async function replayFinanceOutbox(force = false): Promise<'synced' | 'offline' | 'sign-in-required' | 'conflict' | 'service-unavailable'> {
  if (!navigator.onLine) return 'offline'
  const db = await openDatabase()
  const allMutations = await new Promise<FinanceMutation[]>((resolve, reject) => {
    const request = db.transaction(FINANCE_OUTBOX).objectStore(FINANCE_OUTBOX).getAll()
    request.onsuccess = () => resolve(request.result as FinanceMutation[])
    request.onerror = () => reject(request.error)
  })
  if (allMutations.length === 0) return 'synced'
  const ownerId = await getFinanceOwner()
  if (!ownerId) return 'sign-in-required'
  const mutations = allMutations.filter((item) => item.ownerId === ownerId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
  if (mutations.length === 0) return 'synced'
  let deferred = false
  for (const mutation of mutations) {
    if (mutation.conflict) { deferred = true; continue }
    if (!force && mutation.nextAttemptAt && mutation.nextAttemptAt > Date.now()) { deferred = true; continue }
    try {
      const response = await apiFetch(`/api/finance/${mutation.resource}${mutation.operation === 'create' ? '' : `/${encodeURIComponent(mutation.recordId)}`}`, {
        method: mutation.operation === 'create' ? 'POST' : mutation.operation === 'update' ? 'PUT' : 'DELETE',
        credentials: 'include',
        headers: mutation.operation === 'delete' ? undefined : { 'Content-Type': 'application/json' },
        body: mutation.operation === 'delete' ? undefined : JSON.stringify(mutation.operation === 'create' ? { id: mutation.recordId, data: mutation.data } : { version: mutation.version, data: mutation.data }),
      })
      if (response.status === 401) return 'sign-in-required'
      if (response.status === 409) {
        const conflictedMutation = { ...mutation, conflict: true }
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
          tx.objectStore(FINANCE_OUTBOX).put(conflictedMutation)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        window.dispatchEvent(new CustomEvent('pocketflow:finance-conflict', { detail: conflictedMutation }))
        return 'conflict'
      }
      if (!response.ok && !(mutation.operation === 'delete' && response.status === 404)) {
        await deferMutation(db, mutation)
        deferred = true
        continue
      }
      const tx = db.transaction(FINANCE_OUTBOX, 'readwrite')
      tx.objectStore(FINANCE_OUTBOX).delete(mutation.id)
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
      if (mutation.operation === 'delete') await removeCachedFinanceRecord(mutation.resource, mutation.recordId)
      else {
        const record = await response.json() as FinanceRecord
        await saveCachedFinanceRecord(mutation.resource, record)
      }
      if (mutation.resource === 'transactions') {
        try { await loadFinanceRecords('accounts') } catch { /* Keep the latest locally saved balance until the service is reachable. */ }
        window.dispatchEvent(new Event('pocketflow:transaction-synced'))
      }
    } catch {
      if (!navigator.onLine) return 'offline'
      await deferMutation(db, mutation)
      deferred = true
    }
  }
  return deferred ? 'service-unavailable' : 'synced'
}

export async function loadFinanceRecords(resource: FinanceResource): Promise<FinanceRecord[]> {
  if (navigator.onLine) {
    try {
      const records: FinanceRecord[] = []
      let cursor = ''
      do {
        const query = new URLSearchParams({ limit: '100' })
        if (cursor) query.set('cursor', cursor)
        const response = await apiFetch(`/api/finance/${resource}?${query.toString()}`, { credentials: 'include', cache: 'no-store' })
        if (response.status === 401) throw new Error('Sign in to see and sync your financial records.')
        if (!response.ok) throw new Error('Could not load financial records. Please try again.')
        const result = await response.json() as { items: FinanceRecord[]; nextCursor?: string }
        records.push(...result.items)
        cursor = result.nextCursor || ''
      } while (cursor)
      const ownerId = await getFinanceOwner()
      if (ownerId) await cacheFinance(resource, records, ownerId)
      return records
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Sign in')) throw error
      const cached = await getCachedFinance(resource)
      if (cached.length) return cached
      throw error
    }
  }
  const ownerId = await getFinanceOwner()
  if (!ownerId) throw new Error('Sign in once while online to use your financial records offline.')
  return getCachedFinance(resource)
}

