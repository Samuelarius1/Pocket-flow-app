import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { loadAccountPreferences, loadPreferences, pendingChanges, pendingPreferences, syncPreferences } from './offline-store'
import { replayFinanceOutbox } from './finance-store'

const currentVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

function compareVersions(candidate: string, installed: string): number | null {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  const next = candidate.match(pattern)
  const current = installed.match(pattern)
  if (!next || !current) return null
  for (let index = 1; index <= 3; index += 1) {
    const left = BigInt(next[index])
    const right = BigInt(current[index])
    if (left !== right) return left > right ? 1 : -1
  }
  const nextPrerelease = next[4]
  const currentPrerelease = current[4]
  if (nextPrerelease === currentPrerelease) return 0
  if (!nextPrerelease) return 1
  if (!currentPrerelease) return -1
  const nextIdentifiers = nextPrerelease.split('.')
  const currentIdentifiers = currentPrerelease.split('.')
  for (let index = 0; index < Math.min(nextIdentifiers.length, currentIdentifiers.length); index += 1) {
    const left = nextIdentifiers[index]
    const right = currentIdentifiers[index]
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const normalizedLeft = left.replace(/^0+(?=\d)/, '')
      const normalizedRight = right.replace(/^0+(?=\d)/, '')
      if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length > normalizedRight.length ? 1 : -1
      if (normalizedLeft !== normalizedRight) return normalizedLeft > normalizedRight ? 1 : -1
    } else if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    else if (left !== right) return left > right ? 1 : -1
  }
  return nextIdentifiers.length === currentIdentifiers.length ? 0 : nextIdentifiers.length > currentIdentifiers.length ? 1 : -1
}

function isNewerVersion(candidate: string, installed: string) {
  return compareVersions(candidate, installed) === 1
}

async function checkRelease() {
  try {
    const response = await fetch('/api/releases/latest', { cache: 'no-store' })
    if (!response.ok) return
    const release = await response.json() as { version?: string; minimumVersion?: string; mandatory?: boolean; notes?: string; publishedAt?: string }
    if (!release.version || !isNewerVersion(release.version, currentVersion)) return
    const belowMinimum = Boolean(release.minimumVersion && compareVersions(currentVersion, release.minimumVersion) === -1)
    window.dispatchEvent(new CustomEvent('pocketflow:update-available', { detail: { ...release, mandatory: Boolean(release.mandatory || belowMinimum) } }))
  } catch {
    // Release checks are best-effort while the app is offline.
  }
}

void checkRelease()
window.addEventListener('online', () => void checkRelease())
window.setInterval(() => void checkRelease(), 5 * 60 * 1000)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) window.dispatchEvent(new Event('pocketflow:update-available'))
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new Event('pocketflow:update-available'))
        })
      })
      window.setInterval(() => void registration.update(), 5 * 60 * 1000)
    }).catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

void Promise.all([loadAccountPreferences(), pendingChanges()]).then(async ([remote, hasPending]) => {
  if (remote && !hasPending) window.dispatchEvent(new CustomEvent('pocketflow:account-preferences', { detail: remote }))
  if (hasPending) {
    const preferencesPending = await pendingPreferences()
    const [preferenceResult, financeResult] = await Promise.all([
      preferencesPending ? loadPreferences().then(syncPreferences) : Promise.resolve('synced' as const),
      replayFinanceOutbox(),
    ])
    const result = financeResult !== 'synced' ? financeResult : preferenceResult
    window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: result }))
  }
})
