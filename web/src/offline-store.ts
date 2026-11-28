import { apiFetch } from './api'
import { replayFinanceOutbox } from './finance-store'
import { replayShoppingOutbox } from './shopping-store'

export type Preferences = {
  displayName: string
  email: string
  country: string
  currency: string
  language: string
  theme: 'system' | 'light' | 'dark'
  notifications: boolean
  privacyInsights: boolean
  avatar: string | null
}

export const defaultPreferences: Preferences = {
  displayName: 'Alex Morgan',
  email: '',
  country: 'Uganda',
  currency: 'UGX',
  language: 'English',
  theme: 'system',
  notifications: true,
  privacyInsights: false,
  avatar: null,
}

const DB_NAME = 'pocketflow-local'
const DB_VERSION = 3
const STORE = 'preferences'
const OUTBOX = 'outbox'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' })
      if (!db.objectStoreNames.contains('finance-cache')) db.createObjectStore('finance-cache')
      if (!db.objectStoreNames.contains('finance-outbox')) db.createObjectStore('finance-outbox', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('shopping-cache')) db.createObjectStore('shopping-cache')
      if (!db.objectStoreNames.contains('shopping-outbox')) db.createObjectStore('shopping-outbox', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function normalizePreferences(value: Partial<Preferences> | undefined): Preferences {
  const merged = { ...defaultPreferences, ...value }
  const currency = typeof merged.currency === 'string' && /^[A-Z]{3}$/.test(merged.currency) ? merged.currency : defaultPreferences.currency
  const theme = merged.theme === 'light' || merged.theme === 'dark' || merged.theme === 'system' ? merged.theme : defaultPreferences.theme
  return { ...merged, currency, theme, country: merged.country || defaultPreferences.country, language: merged.language || defaultPreferences.language }
}

export async function loadPreferences(): Promise<Preferences> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get('profile')
    request.onsuccess = () => resolve(normalizePreferences(request.result as Partial<Preferences> | undefined))
    request.onerror = () => reject(request.error)
  })
}

export async function savePreferences(preferences: Preferences, enqueue = true): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(preferences, 'profile')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  if (enqueue) await queueSync(preferences)
}

async function queueSync(preferences: Preferences): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite')
    tx.objectStore(OUTBOX).put({ id: 'preferences', preferences, updatedAt: new Date().toISOString() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadAccountPreferences(): Promise<Preferences | null> {
  try {
    const response = await apiFetch('/api/preferences', { credentials: 'include', cache: 'no-store' })
    if (!response.ok) return null
    const value = await response.json() as Partial<Preferences>
    return Object.keys(value).length ? normalizePreferences(value) : null
  } catch {
    return null
  }
}

export async function syncPreferences(preferences: Preferences): Promise<'synced' | 'offline' | 'sign-in-required' | 'service-unavailable'> {
  if (!navigator.onLine) return 'offline'
  try {
    const response = await apiFetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(preferences),
    })
    if (response.status === 401) return 'sign-in-required'
    if (!response.ok) return 'service-unavailable'
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX, 'readwrite')
      tx.objectStore(OUTBOX).delete('preferences')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return 'synced'
  } catch {
    return navigator.onLine ? 'service-unavailable' : 'offline'
  }
}

export async function pendingPreferences(): Promise<boolean> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(OUTBOX).objectStore(OUTBOX).count()
    request.onsuccess = () => resolve(request.result > 0)
    request.onerror = () => reject(request.error)
  })
}

export async function pendingChanges(): Promise<boolean> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OUTBOX, 'finance-outbox', 'shopping-outbox'])
    const preferenceRequest = tx.objectStore(OUTBOX).count()
    const financeRequest = tx.objectStore('finance-outbox').count()
    const shoppingRequest = tx.objectStore('shopping-outbox').count()
    tx.oncomplete = () => resolve(preferenceRequest.result + financeRequest.result + shoppingRequest.result > 0)
    tx.onerror = () => reject(tx.error)
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void Promise.all([loadPreferences().then(syncPreferences), replayFinanceOutbox(), replayShoppingOutbox()]).then(([preferencesResult, financeResult, shoppingResult]) => {
      const result = financeResult !== 'synced' ? financeResult : shoppingResult !== 'synced' ? shoppingResult : preferencesResult
      window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: result }))
    }).catch(() => undefined)
  })
}

