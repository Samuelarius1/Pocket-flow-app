import { apiFetch } from '../api'
import { useEffect, useState, type FormEvent } from 'react'
import useSWR, { mutate as mutateSWR } from 'swr'
import { ArrowDownLeft, ArrowRight, CirclePlus, Landmark, Pencil, RefreshCw, Target, Trash2, WalletCards } from 'lucide-react'
import './FinanceWorkspace.css'
import { adjustCachedAccountBalance, cacheFinanceCategories, clearFinanceMutation, enqueueFinanceMutation, getFinanceConflicts, getFinanceOwner, loadFinanceCategories, loadFinanceRecords, removeCachedFinanceRecord, replayFinanceOutbox, resolveFinanceConflict, saveCachedFinanceRecord, type FinanceCategory, type FinanceData, type FinanceMutation, type FinanceRecord, type FinanceResource } from '../finance-store'

type Props = { resource: FinanceResource; currency: string; onSignIn: () => void; onOpenAccounts?: () => void }
type Draft = { name: string; institution: string; accountType: string; currency: string; balance: string; accountId: string; category: string; categoryId: string; description: string; amount: string; kind: string; occurredAt: string; periodStart: string; periodEnd: string; target: string; saved: string; targetDate: string }

const titles: Record<FinanceResource, { title: string; description: string; add: string; icon: typeof WalletCards }> = {
  accounts: { title: 'Your accounts', description: 'See the balances you have saved with PocketFlow.', add: 'Add account', icon: Landmark },
  transactions: { title: 'Transactions', description: 'Track income and spending with precise currency amounts.', add: 'Add transaction', icon: ArrowDownLeft },
  budgets: { title: 'Monthly budgets', description: 'Set clear limits for the categories that matter to you.', add: 'Create budget', icon: WalletCards },
  goals: { title: 'Savings goals', description: 'Give the things you are saving for a place to grow.', add: 'Add a goal', icon: Target },
}

const today = new Date().toISOString().slice(0, 10)
const monthStart = `${today.slice(0, 7)}-01`
const emptyDraft = (currency: string): Draft => ({ name: '', institution: '', accountType: 'checking', currency, balance: '', accountId: '', category: '', categoryId: '', description: '', amount: '', kind: 'expense', occurredAt: `${today}T12:00:00Z`, periodStart: monthStart, periodEnd: today, target: '', saved: '', targetDate: '' })

function fractionDigits(currency: string): number {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 }
}

function toMinor(value: string, currency: string): number {
  return Math.round(Number(value) * (10 ** fractionDigits(currency)))
}

function formatMoney(minor: number, currency: string): string {
  const digits = fractionDigits(currency)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits }).format(minor / (10 ** digits))
}

function moneyInput(minor: number | undefined, currency: string): string {
  return minor === undefined ? '' : String(minor / (10 ** fractionDigits(currency)))
}

function transactionBalanceDelta(data: FinanceData): number {
  const amount = Number(data.amountMinor || 0)
  return data.kind === 'income' ? amount : -amount
}

async function adjustCachedTransactionBalance(previous?: FinanceData, next?: FinanceData): Promise<void> {
  const changes = new Map<string, { currency: string; delta: number }>()
  const add = (data: FinanceData | undefined, direction: number) => {
    if (!data || !data.accountId) return
    const accountId = String(data.accountId)
    const currency = String(data.currency || '')
    const existing = changes.get(accountId) ?? { currency, delta: 0 }
    existing.delta += transactionBalanceDelta(data) * direction
    changes.set(accountId, existing)
  }
  add(previous, -1)
  add(next, 1)
  for (const [accountId, change] of changes) await adjustCachedAccountBalance(accountId, change.currency, change.delta)
}

function draftFor(record: FinanceRecord, resource: FinanceResource): Draft {
  const data = record.data
  return {
    ...emptyDraft(String(data.currency || 'UGX')),
    name: String(data.name || ''), institution: String(data.institution || ''), accountType: String(data.accountType || 'checking'),
    currency: String(data.currency || 'UGX'), balance: moneyInput(Number(data.balanceMinor), String(data.currency || 'UGX')),
    accountId: String(data.accountId || ''), category: String(data.category || ''), categoryId: String(data.categoryId || ''), description: String(data.description || ''),
    amount: moneyInput(Number(data.amountMinor), String(data.currency || 'UGX')), kind: String(data.kind || 'expense'),
    occurredAt: String(data.occurredAt || `${today}T12:00:00Z`).slice(0, 16), periodStart: String(data.periodStart || monthStart),
    periodEnd: String(data.periodEnd || today), target: moneyInput(Number(data.targetMinor), String(data.currency || 'UGX')),
    saved: moneyInput(Number(data.savedMinor), String(data.currency || 'UGX')), targetDate: String(data.targetDate || ''),
    ...(resource === 'transactions' ? {} : {}),
  }
}

function payloadFor(resource: FinanceResource, draft: Draft): FinanceData {
  const currency = draft.currency.toUpperCase()
  if (resource === 'accounts') return { name: draft.name.trim(), institution: draft.institution.trim(), accountType: draft.accountType, currency, balanceMinor: toMinor(draft.balance, currency) }
  if (resource === 'transactions') return { accountId: draft.accountId, category: draft.category, categoryId: draft.categoryId, description: draft.description.trim(), currency, amountMinor: toMinor(draft.amount, currency), kind: draft.kind, occurredAt: new Date(draft.occurredAt).toISOString() }
  if (resource === 'budgets') return { category: draft.category, categoryId: draft.categoryId, currency, amountMinor: toMinor(draft.amount, currency), periodStart: draft.periodStart, periodEnd: draft.periodEnd }
  return { name: draft.name.trim(), currency, targetMinor: toMinor(draft.target, currency), savedMinor: toMinor(draft.saved || '0', currency), targetDate: draft.targetDate }
}

export function FinanceWorkspace({ resource, currency, onSignIn, onOpenAccounts }: Props) {
  const title = titles[resource]
  const { data: items = [], error, isLoading, mutate } = useSWR<FinanceRecord[], Error>(`/api/finance/${resource}`, () => loadFinanceRecords(resource), { revalidateOnFocus: true, revalidateOnReconnect: true })
  const { data: accounts = [] } = useSWR<FinanceRecord[]>(resource === 'transactions' ? '/api/finance/accounts' : null, () => loadFinanceRecords('accounts'))
  const { data: categories = [], mutate: mutateCategories } = useSWR<FinanceCategory[]>(resource === 'transactions' || resource === 'budgets' ? '/api/categories' : null, loadFinanceCategories)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(currency))
  const [editing, setEditing] = useState<FinanceRecord | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [categoryDraft, setCategoryDraft] = useState('')
  const [categoryFormOpen, setCategoryFormOpen] = useState(false)
  const [categoryBusy, setCategoryBusy] = useState(false)
  const [conflictMutation, setConflictMutation] = useState<FinanceMutation | null>(null)
  const [conflictServerRecord, setConflictServerRecord] = useState<FinanceRecord | undefined>()
  const [conflictServerLoaded, setConflictServerLoaded] = useState(false)
  const Icon = title.icon

  useEffect(() => {
    let active = true
    void getFinanceConflicts(resource).then(async (conflicts) => {
      const mutation = conflicts[0]
      if (!active || !mutation) return
      setConflictMutation(mutation)
      setConflictServerLoaded(false)
      setMessage('A pending change needs your review before it can sync.')
      const records = await mutate()
      if (active) {
        setConflictServerRecord(records?.find((record) => record.id === mutation.recordId))
        setConflictServerLoaded(true)
      }
    }).catch(() => undefined)
    const onAuthenticated = () => { void mutate() }
    const onConflict = (event: Event) => {
      const mutation = (event as CustomEvent<FinanceMutation>).detail
      if (mutation?.resource !== resource) return
      setConflictMutation(mutation)
      setConflictServerLoaded(false)
      setMessage('A pending change needs your review before it can sync.')
      void mutate().then((records) => {
        setConflictServerRecord(records?.find((record) => record.id === mutation.recordId))
        setConflictServerLoaded(true)
      })
    }
    const onSync = (event: Event) => {
      const result = (event as CustomEvent<string>).detail
      if (result === 'synced') { void mutate(); setMessage('Your saved changes are synced.') }
      else if (result === 'conflict') setMessage('Sync conflict: review the server version, then retry your changes.')
    }
    window.addEventListener('pocketflow:account-authenticated', onAuthenticated)
    window.addEventListener('pocketflow:finance-conflict', onConflict)
    window.addEventListener('pocketflow:sync-complete', onSync)
    return () => {
      active = false
      window.removeEventListener('pocketflow:account-authenticated', onAuthenticated)
      window.removeEventListener('pocketflow:finance-conflict', onConflict)
      window.removeEventListener('pocketflow:sync-complete', onSync)
    }
  }, [mutate, resource])

  const openCreate = () => {
    const firstAccount = resource === 'transactions' ? accounts[0] : undefined
    setEditing(null)
    setDraft({ ...emptyDraft(firstAccount ? String(firstAccount.data.currency || currency) : currency), accountId: firstAccount?.id ?? '' })
    setMessage('')
    setFormOpen(true)
  }
  const openEdit = (record: FinanceRecord) => { setEditing(record); setDraft(draftFor(record, resource)); setMessage(''); setFormOpen(true) }
  const updateDraft = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const makeRecord = (id: string, version: number, data: FinanceData): FinanceRecord => ({ id, version, data, updatedAt: new Date().toISOString() })

  async function syncNow() {
    const result = await replayFinanceOutbox(true)
    window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: result }))
    if (result === 'synced') { setMessage('Everything is synced.'); await mutate() }
    else if (result === 'conflict') setMessage('A newer server version needs review before this change can sync.')
    else if (result === 'sign-in-required') { setMessage('Sign in to sync your offline changes.'); onSignIn() }
    else if (result === 'offline') setMessage('You are offline. Saved changes will retry when you reconnect.')
    else setMessage('Sync could not finish. Your local changes are still saved; try again shortly.')
  }

  async function chooseConflict(resolution: 'server' | 'local') {
    if (!conflictMutation) return
    setBusy(true)
    try {
      await resolveFinanceConflict(resource, conflictMutation.recordId, resolution, conflictServerRecord)
      setConflictMutation(null)
      setConflictServerRecord(undefined)
      setConflictServerLoaded(false)
      if (resolution === 'local') {
        const result = await replayFinanceOutbox(true)
        setMessage(result === 'synced' ? 'Your reviewed changes are synced.' : result === 'conflict' ? 'The record changed again. Review the newer server copy before retrying.' : 'Your reviewed change is saved locally and will retry when possible.')
      } else {
        setMessage('The server copy is now in use. Your conflicting local change was discarded.')
      }
      await mutate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to resolve this sync conflict.')
    } finally {
      setBusy(false)
    }
  }

  async function createCategory() {
    const name = categoryDraft.trim()
    if (!name) return
    setCategoryBusy(true)
    try {
      const response = await apiFetch('/api/categories', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: resource === 'budgets' ? 'expense' : draft.kind, color: '#2F9B6B' }) })
      if (response.status === 401) { onSignIn(); setMessage('Sign in to add a personal category.'); return }
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error || 'Unable to add category.') }
      const category = await response.json() as FinanceCategory
      await mutateCategories((current = []) => [...current, category], { revalidate: false })
      await cacheFinanceCategories([...categories, category])
      setDraft((current) => ({ ...current, categoryId: category.id, category: category.name }))
      setCategoryDraft('')
      setCategoryFormOpen(false)
      setMessage('Category added to your profile.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to add category.') }
    finally { setCategoryBusy(false) }
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const data = payloadFor(resource, draft)
    const recordId = editing?.id ?? crypto.randomUUID()
    const currentVersion = editing?.version ?? 0
    try {
      const ownerId = await getFinanceOwner()
      if (!ownerId && !navigator.onLine) { setMessage('Connect to your account while online before saving financial records offline.'); return }
      if (navigator.onLine) {
        try {
          const response = await apiFetch(`/api/finance/${resource}${editing ? `/${encodeURIComponent(recordId)}` : ''}`, {
            method: editing ? 'PUT' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editing ? { version: currentVersion, data } : { id: recordId, data }),
          })
          if (response.status === 401) { setMessage('Sign in to save and sync your financial records.'); onSignIn(); return }
          if (response.status === 409) { setMessage('This record changed on another device. Refresh the list before saving again.'); await mutate(); return }
          if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error || 'Unable to save this record.') }
          const saved = await response.json() as FinanceRecord
          await clearFinanceMutation(resource, saved.id)
          await saveCachedFinanceRecord(resource, saved)
          await mutate((current = []) => [saved, ...current.filter((item) => item.id !== saved.id)], { revalidate: false })
          if (resource === 'transactions') void mutateSWR('/api/finance/accounts')
          setMessage('Saved and synced to your account.')
          setEditing(null)
          setFormOpen(false)
          setDraft(emptyDraft(currency))
          return
        } catch (error) {
          if (error instanceof Error && !(error instanceof TypeError)) throw error
        }
      }
      const optimistic = makeRecord(recordId, currentVersion, data)
      await enqueueFinanceMutation({ resource, operation: editing ? 'update' : 'create', recordId, version: currentVersion, data })
      if (resource === 'transactions') await adjustCachedTransactionBalance(editing?.data, data)
      await saveCachedFinanceRecord(resource, optimistic)
      await mutate((current = []) => [optimistic, ...current.filter((item) => item.id !== optimistic.id)], { revalidate: false })
      window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: 'offline' }))
      if (resource === 'transactions') {
        const cachedAccounts = await loadFinanceRecords('accounts').catch(() => [])
        await mutateSWR('/api/finance/accounts', cachedAccounts, { revalidate: false })
      }
      setMessage('Saved on this device. It will sync when you are back online.')
      setEditing(null)
      setFormOpen(false)
      setDraft(emptyDraft(currency))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save this record.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteRecord(record: FinanceRecord) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    setBusy(true)
    setMessage('')
    try {
      if (navigator.onLine) {
        try {
          const response = await apiFetch(`/api/finance/${resource}/${encodeURIComponent(record.id)}`, { method: 'DELETE', credentials: 'include' })
          if (response.status === 401) { setMessage('Sign in to manage your financial records.'); onSignIn(); return }
          if (!response.ok && response.status !== 404) throw new Error('Unable to delete this record.')
          await clearFinanceMutation(resource, record.id)
          await removeCachedFinanceRecord(resource, record.id)
          await mutate((current = []) => current.filter((item) => item.id !== record.id), { revalidate: false })
          if (resource === 'transactions') void mutateSWR('/api/finance/accounts')
          setMessage('Record deleted.')
          return
        } catch (error) {
          if (error instanceof Error && !(error instanceof TypeError)) throw error
        }
      }
      const ownerId = await getFinanceOwner()
      if (!ownerId) { setMessage('Connect to your account while online before deleting records offline.'); return }
      await enqueueFinanceMutation({ resource, operation: 'delete', recordId: record.id, version: record.version })
      if (resource === 'transactions') await adjustCachedTransactionBalance(record.data)
      await removeCachedFinanceRecord(resource, record.id)
      await mutate((current = []) => current.filter((item) => item.id !== record.id), { revalidate: false })
      window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: 'offline' }))
      if (resource === 'transactions') {
        const cachedAccounts = await loadFinanceRecords('accounts').catch(() => [])
        await mutateSWR('/api/finance/accounts', cachedAccounts, { revalidate: false })
      }
      setMessage('Deleted on this device. The change will sync when you are back online.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete this record.')
    } finally { setBusy(false) }
  }

  const filtered = items.filter((record) => Object.values(record.data).join(' ').toLowerCase().includes(query.toLowerCase()))
  const showAmount = (record: FinanceRecord, field: string) => formatMoney(Number(record.data[field] || 0), String(record.data.currency || currency))
  const categoryKind = resource === 'budgets' ? 'expense' : draft.kind
  const categoryField = <div className="form-field"><span>Category</span><div className="category-select-row"><select required value={draft.categoryId} onChange={(event) => { const selected = categories.find((category) => category.id === event.target.value); setDraft((current) => ({ ...current, categoryId: event.target.value, category: selected?.name ?? '' })) }}><option value="">Choose a category</option>{categories.filter((category) => category.kind === categoryKind).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="button" className="button button-secondary" onClick={() => setCategoryFormOpen(!categoryFormOpen)}>{categoryFormOpen ? 'Cancel' : 'New'}</button></div>{categoryFormOpen && <div className="new-category-form"><input aria-label="New category name" maxLength={60} value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void createCategory() } }} placeholder="Category name"/><button type="button" className="button button-primary" onClick={() => void createCategory()} disabled={categoryBusy || !categoryDraft.trim()}>{categoryBusy ? 'Addingâ€¦' : 'Add'}</button></div>}</div>

  return <div className="finance-page page-stack">
    <section className="finance-page-head">
      <div><p className="eyebrow">YOUR MONEY, IN GOOD FLOW</p><h1>{title.title}</h1><p>{title.description}</p></div>
      <div className="finance-head-actions">{resource === 'transactions' && accounts.length === 0 && <button className="button button-secondary" onClick={onOpenAccounts}>Add account</button>}<button className="button button-primary" onClick={openCreate}><CirclePlus size={16}/>{title.add}</button></div>
    </section>
    <section className="finance-toolbar panel" aria-label={`${title.title} tools`}>
      <label className="finance-search"><span className="sr-only">Search {title.title.toLowerCase()}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.title.toLowerCase()}`}/></label>
      <span className="finance-sync-label"><i className={`footer-dot ${navigator.onLine ? '' : 'is-offline'}`}/>{navigator.onLine ? 'Synced records' : 'Offline records'}</span>
      <button className="icon-button" aria-label="Retry pending changes and refresh records" onClick={() => void syncNow()} disabled={busy}><RefreshCw size={16}/></button>
    </section>
    {message && <p className="finance-message" role="status">{message}</p>}
    {conflictMutation && <section className="finance-conflict panel" role="alert" aria-labelledby="finance-conflict-title"><div><h2 id="finance-conflict-title">Review a sync conflict</h2><p>This change is paused because the record changed on another device. Compare the saved copy before choosing what to keep.</p><details><summary>Compare saved and server versions</summary><div className="finance-conflict-comparison"><p><strong>Your saved version</strong><code>{JSON.stringify(conflictMutation.data ?? { deletion: true })}</code></p><p><strong>Current server version</strong><code>{conflictServerLoaded ? conflictServerRecord ? JSON.stringify(conflictServerRecord.data) : 'This record no longer exists on the server.' : 'Loading the latest server versionâ€¦'}</code></p></div></details></div><div className="finance-conflict-actions"><button className="button button-secondary" onClick={() => void chooseConflict('server')} disabled={busy || !conflictServerLoaded}>Use server copy</button><button className="button button-primary" onClick={() => void chooseConflict('local')} disabled={busy || !conflictServerLoaded}>{busy ? 'Resolvingâ€¦' : 'Keep my version and sync'}</button></div></section>}
    {error && items.length === 0 && <section className="finance-empty panel"><div className="empty-illustration"><Icon size={24}/></div><h2>{error.message.includes('Sign in') ? 'Sign in to sync your records' : 'Your records are not available yet'}</h2><p>{error.message}</p><button className="button button-primary" onClick={onSignIn}>Sign in or create account <ArrowRight size={15}/></button></section>}
    {isLoading && items.length === 0 && <section className="finance-empty panel" aria-live="polite"><p>Loading your recordsâ€¦</p></section>}
    {!error && !isLoading && filtered.length === 0 && <section className="finance-empty panel"><div className="empty-illustration"><Icon size={24}/></div><h2>{query ? 'No matching records' : `Nothing in ${title.title.toLowerCase()} yet`}</h2><p>{query ? 'Try a different search.' : 'Add your first record and PocketFlow will keep it available offline on this device.'}</p>{!query && <button className="button button-primary" onClick={openCreate}><CirclePlus size={16}/>{title.add}</button>}</section>}
    {filtered.length > 0 && <section className="finance-record-list" aria-label={title.title}>{filtered.map((record) => {
      const amountField = resource === 'accounts' ? 'balanceMinor' : resource === 'transactions' || resource === 'budgets' ? 'amountMinor' : 'targetMinor'
      const amountLabel = resource === 'accounts' ? 'Balance' : resource === 'transactions' ? String(record.data.kind || 'transaction') : resource === 'budgets' ? 'Budget' : 'Target'
      const primary = String(record.data.name || record.data.description || record.data.category || 'Financial record')
      const secondary = resource === 'accounts' ? `${record.data.institution || 'Personal'} Â· ${record.data.accountType || 'Account'}` : resource === 'transactions' ? `${record.data.category || 'Uncategorized'} Â· ${new Date(String(record.data.occurredAt)).toLocaleDateString()}` : resource === 'budgets' ? `${record.data.periodStart || ''} â€“ ${record.data.periodEnd || ''}` : `Saved ${showAmount(record, 'savedMinor')} of ${showAmount(record, 'targetMinor')}`
      return <article className="finance-record panel" key={record.id}><span className="finance-record-icon"><Icon size={18}/></span><span className="finance-record-copy"><strong>{primary}</strong><small>{secondary}</small></span><span className="finance-record-value"><small>{amountLabel}</small><strong>{showAmount(record, amountField)}</strong></span><button className="icon-button" aria-label={`Edit ${primary}`} onClick={() => openEdit(record)} disabled={busy}><Pencil size={15}/></button><button className="icon-button danger-button" aria-label={`Delete ${primary}`} onClick={() => void deleteRecord(record)} disabled={busy}><Trash2 size={15}/></button></article>
    })}</section>}
    {formOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}><section className="finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-form-title"><div className="finance-modal-head"><span className="modal-icon"><Icon size={19}/></span><button className="modal-close" aria-label="Close form" onClick={() => setFormOpen(false)}>Ã—</button></div><p className="eyebrow">{editing ? 'UPDATE YOUR RECORD' : 'ADD A REAL RECORD'}</p><h2 id="finance-form-title">{editing ? 'Edit record' : title.add}</h2><form className="account-form" onSubmit={(event) => void saveRecord(event)}>
      {(resource === 'accounts' || resource === 'goals') && <label className="form-field"><span>{resource === 'accounts' ? 'Account name' : 'Goal name'}</span><input required maxLength={120} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder={resource === 'accounts' ? 'Everyday account' : 'Emergency fund'}/></label>}
      {resource === 'accounts' && <><label className="form-field"><span>Institution</span><input maxLength={120} value={draft.institution} onChange={(event) => updateDraft('institution', event.target.value)} placeholder="Bank or cash wallet"/></label><label className="form-field"><span>Account type</span><select value={draft.accountType} onChange={(event) => updateDraft('accountType', event.target.value)}><option value="checking">Checking</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="credit">Credit</option><option value="investment">Investment</option></select></label><MoneyField label="Current balance" value={draft.balance} currency={draft.currency} onValue={(value) => updateDraft('balance', value)} allowNegative/></>}
      {resource === 'transactions' && <><label className="form-field"><span>Description</span><input required maxLength={200} value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} placeholder="Groceries, salary, rent…"/></label><label className="form-field"><span>Account</span><select required value={draft.accountId} onChange={(event) => { const account = accounts.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, accountId: event.target.value, currency: String(account?.data.currency || current.currency) })) }}><option value="">Choose an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{String(account.data.name)} · {String(account.data.currency)}</option>)}</select></label><label className="form-field"><span>Type</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value, categoryId: '', category: '' }))}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></label>{categoryField}<MoneyField label="Amount" value={draft.amount} currency={draft.currency} onValue={(value) => updateDraft('amount', value)}/><label className="form-field"><span>Date and time</span><input required type="datetime-local" value={draft.occurredAt} onChange={(event) => updateDraft('occurredAt', event.target.value)}/></label></>}
      {resource === 'budgets' && <>{categoryField}<MoneyField label="Budget limit" value={draft.amount} currency={draft.currency} onValue={(value) => updateDraft('amount', value)}/><label className="form-field"><span>Period begins</span><input required type="date" value={draft.periodStart} onChange={(event) => updateDraft('periodStart', event.target.value)}/></label><label className="form-field"><span>Period ends</span><input required type="date" value={draft.periodEnd} onChange={(event) => updateDraft('periodEnd', event.target.value)}/></label></>}
      {resource === 'goals' && <><MoneyField label="Target amount" value={draft.target} currency={draft.currency} onValue={(value) => updateDraft('target', value)}/><MoneyField label="Already saved" value={draft.saved} currency={draft.currency} onValue={(value) => updateDraft('saved', value)}/><label className="form-field"><span>Target date (optional)</span><input type="date" value={draft.targetDate} onChange={(event) => updateDraft('targetDate', event.target.value)}/></label></>}
      {resource === 'transactions' ? <label className="form-field"><span>Currency</span><input value={draft.currency} readOnly aria-readonly="true"/><small>Matches the selected account.</small></label> : <label className="form-field"><span>Currency</span><select value={draft.currency} onChange={(event) => updateDraft('currency', event.target.value)}><option value="UGX">UGX · Ugandan shilling</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British pound</option><option value="KES">KES · Kenyan shilling</option><option value="TZS">TZS · Tanzanian shilling</option></select></label>}
      {message && <p className="form-error" role="alert">{message}</p>}
      <div className="finance-form-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Savingâ€¦' : editing ? 'Save changes' : title.add}</button></div>
    </form></section></div>}
  </div>
}

function MoneyField({ label, value, currency, onValue, allowNegative = false }: { label: string; value: string; currency: string; onValue: (value: string) => void; allowNegative?: boolean }) {
  return <label className="form-field"><span>{label}</span><div className="money-input-wrap"><span>{currency}</span><input required type="number" inputMode="decimal" step={fractionDigits(currency) ? 1 / (10 ** fractionDigits(currency)) : 1} min={allowNegative ? undefined : 0} value={value} onChange={(event) => onValue(event.target.value)} placeholder="0"/></div></label>
}

