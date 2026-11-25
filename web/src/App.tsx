import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { mutate as mutateSWR } from 'swr'
import { ArrowDownLeft, ArrowRight, Bell, ChevronDown, Download, Menu, Moon, Search, ShoppingBasket, Sparkles, Sun, X } from 'lucide-react'
import { AccountDialog } from './components/AccountDialog'
import { AssistantPanel } from './components/AssistantPanel'
import { Dashboard } from './components/Dashboard'
import { Sidebar, type Section } from './components/Sidebar'
import { Settings } from './components/Settings'
import { defaultPreferences, loadPreferences, normalizePreferences, pendingChanges, pendingPreferences, savePreferences, syncPreferences, type Preferences } from './offline-store'
import { replayFinanceOutbox, setFinanceOwner } from './finance-store'
import { FinanceWorkspace } from './components/FinanceWorkspace'
import { ShoppingWorkspace } from './components/ShoppingWorkspace'
const InsightsWorkspace = lazy(() => import('./components/InsightsWorkspace').then((module) => ({ default: module.InsightsWorkspace })))
const installedVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

const sectionTitles: Record<Section, string> = { overview: 'Overview', accounts: 'Accounts', transactions: 'Transactions', budgets: 'Budgets', goals: 'Savings goals', shopping: 'Shopping list', insights: 'Insights', settings: 'Settings' }

export default function App() {
  const [section, setSection] = useState<Section>('overview')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [hasPendingChanges, setHasPendingChanges] = useState(false)
  const [syncState, setSyncState] = useState('saved')
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences)
  const [accountDialog, setAccountDialog] = useState(false)
  const [releaseInfo, setReleaseInfo] = useState<{ version?: string; mandatory?: boolean; notes?: string } | null>(null)
  const [updateSyncBlocked, setUpdateSyncBlocked] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    loadPreferences().then((value) => { if (active) setPreferences(value) }).catch(() => undefined)
    pendingChanges().then((value) => { if (active) setHasPendingChanges(value) }).catch(() => undefined)
    const onOnline = () => setOnline(true)
    const onOffline = () => { setOnline(false); setSyncState('offline') }
    const onRelease = (event: Event) => setReleaseInfo((event as CustomEvent<{ version?: string; mandatory?: boolean; notes?: string }>).detail ?? { notes: 'A new application version is available.' })
    const onSync = (event: Event) => { const result = (event as CustomEvent<string>).detail; setSyncState(result); setHasPendingChanges(result !== 'synced') }
    const onAccountPreferences = (event: Event) => { const remote = normalizePreferences((event as CustomEvent<Preferences>).detail); setPreferences(remote); void savePreferences(remote, false); setSyncState('synced'); void pendingChanges().then(setHasPendingChanges) }
    const onAccountAuthenticated = () => { for (const key of ['/api/finance/accounts', '/api/finance/transactions', '/api/finance/budgets', '/api/finance/goals', '/api/categories', '/api/shopping']) void mutateSWR(key) }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pocketflow:update-available', onRelease)
    window.addEventListener('pocketflow:sync-complete', onSync)
    window.addEventListener('pocketflow:account-preferences', onAccountPreferences)
    window.addEventListener('pocketflow:account-authenticated', onAccountAuthenticated)
    return () => {
      active = false
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pocketflow:update-available', onRelease)
      window.removeEventListener('pocketflow:sync-complete', onSync)
      window.removeEventListener('pocketflow:account-preferences', onAccountPreferences)
      window.removeEventListener('pocketflow:account-authenticated', onAccountAuthenticated)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
  }, [preferences.theme])

  const changePreferences = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch }
    setPreferences(next)
    setSyncState('saving')
    void savePreferences(next).then(() => {
      setHasPendingChanges(true)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void syncPreferences(next).then((result) => {
          setSyncState(result)
          if (result === 'synced') setHasPendingChanges(false)
        })
      }, 500)
    }).catch(() => setSyncState('offline'))
  }

  const navigate = (next: Section) => { setSection(next); setMobileMenuOpen(false) }
  const installUpdate = async (continueWithSavedChanges = false) => {
    if (!continueWithSavedChanges && await pendingChanges()) {
      if (!navigator.onLine) { setUpdateSyncBlocked(true); return }
      const preferencesPending = await pendingPreferences()
      const [financeResult, preferencesResult] = await Promise.all([
        replayFinanceOutbox(true),
        preferencesPending ? loadPreferences().then(syncPreferences) : Promise.resolve('synced' as const),
      ])
      if (await pendingChanges()) {
        setSyncState(financeResult !== 'synced' ? financeResult : preferencesResult)
        setUpdateSyncBlocked(true)
        return
      }
    }
    setUpdateSyncBlocked(false)
    const registration = await navigator.serviceWorker?.getRegistration()
    if (!registration?.waiting) { window.location.reload(); return }
    const activated = new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    await activated
    window.location.reload()
  }

  return <div className="app-shell">
    <Sidebar current={section} onNavigate={navigate} onAssistant={() => setAssistantOpen(true)} profileName={preferences.displayName} avatar={preferences.avatar} />
    <div className="main-column">
      <header className="topbar"><button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}><Menu size={20}/></button><div className="breadcrumb"><span>PocketFlow</span><span className="breadcrumb-slash">/</span><strong>{sectionTitles[section]}</strong></div><div className="topbar-actions"><div className={`sync-status ${online ? 'online' : 'offline'}`}><span className="sync-indicator"/><span>{online ? hasPendingChanges ? 'Saved on device' : 'PocketFlow ready' : 'Offline mode'}</span><ChevronDown size={13}/></div><button className="topbar-icon theme-toggle" aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => changePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })}>{preferences.theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="topbar-icon" aria-label="Notifications"><Bell size={18}/><i/></button><button className="topbar-avatar" aria-label="Open settings" onClick={() => navigate('settings')}>{preferences.avatar ? <img src={preferences.avatar} alt=""/> : preferences.displayName.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</button></div></header>
      {releaseInfo && <div className="release-banner" role="status"><span><Download size={16}/><strong>{releaseInfo.mandatory ? 'Required PocketFlow update.' : 'A new PocketFlow update is ready.'}</strong> {releaseInfo.version && <span>v{installedVersion} → v{releaseInfo.version}</span>} {releaseInfo.notes || 'Your saved data stays right where it is.'} {updateSyncBlocked && <strong> Pending changes could not sync; they remain saved on this device.</strong>}</span><button onClick={() => void installUpdate()}>{updateSyncBlocked ? 'Retry sync' : 'Update now'} <ArrowRight size={14}/></button>{updateSyncBlocked && <button onClick={() => void installUpdate(true)}>Update with saved changes</button>}{!releaseInfo.mandatory && <button className="release-dismiss" aria-label="Dismiss update notice" onClick={() => setReleaseInfo(null)}><X size={15}/></button>}</div>}
      {mobileMenuOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileMenuOpen(false)}><nav className="mobile-nav" aria-label="Mobile navigation" onClick={(event) => event.stopPropagation()}><div className="mobile-nav-head"><strong>Menu</strong><button onClick={() => setMobileMenuOpen(false)} aria-label="Close menu"><X size={18}/></button></div>{(['overview','accounts','transactions','budgets','goals','shopping','insights','settings'] as Section[]).map((item) => <button key={item} onClick={() => navigate(item)}>{sectionTitles[item]}<ArrowRight size={15}/></button>)}</nav></div>}
      <main className="main-content">{section === 'overview' ? <Dashboard onNavigate={navigate} onAssistant={() => setAssistantOpen(true)} displayName={preferences.displayName} currency={preferences.currency} onSignIn={() => setAccountDialog(true)} /> : section === 'settings' ? <Settings preferences={preferences} onChange={changePreferences} syncState={syncState} onSignIn={() => setAccountDialog(true)} /> : section === 'insights' ? <Suspense fallback={<section className="finance-empty panel" aria-live="polite"><p>Opening your insights…</p></section>}><InsightsWorkspace currency={preferences.currency} onSignIn={() => setAccountDialog(true)} onNavigate={navigate} /></Suspense> : section === 'shopping' ? <ShoppingWorkspace onSignIn={() => setAccountDialog(true)} /> : <FinanceWorkspace resource={section} currency={preferences.currency} onSignIn={() => setAccountDialog(true)} />}</main>
      <footer className="app-footer"><span>Made for a little more peace of mind.</span><span><i className={`footer-dot ${online ? '' : 'is-offline'}`}/>{online ? 'You’re up to date' : 'Changes stay on this device'}</span></footer>
    </div>
    <nav className="mobile-bottom-nav" aria-label="Quick navigation">{([['overview','Overview',Sparkles],['shopping','Shopping',ShoppingBasket],['transactions','Activity',ArrowDownLeft],['settings','Settings',Search]] as const).map(([item,label,Icon])=><button key={item} className={section === item ? 'selected' : ''} onClick={() => navigate(item)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    {releaseInfo?.mandatory && <div className="mandatory-update-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="mandatory-update-title"><section className="mandatory-update-card"><div className="modal-icon"><Download size={21}/></div><p className="eyebrow">IMPORTANT UPDATE</p><h2 id="mandatory-update-title">Update PocketFlow to continue</h2><p>{releaseInfo.notes || 'A required security or compatibility update is ready. Your saved preferences and offline changes remain on this device.'}</p>{updateSyncBlocked && <p role="status">Pending changes could not sync. They are still saved on this device.</p>}<button className="button button-primary" onClick={() => void installUpdate()}>{updateSyncBlocked ? 'Retry sync' : 'Update now'} <ArrowRight size={15}/></button>{updateSyncBlocked && <button className="button button-secondary" onClick={() => void installUpdate(true)}>Update with saved changes</button>}</section></div>}
    {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} />}
    {accountDialog && <AccountDialog onClose={() => setAccountDialog(false)} onAuthenticated={async (user) => { await setFinanceOwner(user.id); window.dispatchEvent(new Event('pocketflow:account-authenticated')); const financeResult = await replayFinanceOutbox(true); let saved: Partial<Preferences> = {}; try { const response = await fetch('/api/preferences', { credentials: 'include' }); if (response.ok) saved = await response.json() as Partial<Preferences> } catch { /* Keep local preferences when the service is offline. */ } const updated = normalizePreferences({ ...preferences, ...saved, email: user.email, displayName: user.displayName || preferences.displayName }); setPreferences(updated); await savePreferences(updated); const preferencesResult = await syncPreferences(updated); const result = financeResult !== 'synced' ? financeResult : preferencesResult; setSyncState(result); setHasPendingChanges(await pendingChanges()) }} />}
  </div>
}
