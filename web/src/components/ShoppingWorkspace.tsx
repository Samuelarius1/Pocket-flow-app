import { apiFetch } from '../api'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './ShoppingWorkspace.css'
import useSWR from 'swr'
import { Check, CheckCheck, LoaderCircle, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react'
import { enqueueShoppingMutation, loadShoppingItems, saveShoppingCache, type ShoppingItem, type ShoppingMutation } from '../shopping-store'

type ShoppingListResponse = { items: ShoppingItem[] }
type ShoppingInput = Pick<ShoppingItem, 'name' | 'quantity' | 'purchased'> & { version?: number }
type Props = { onSignIn: () => void }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw Object.assign(new Error(body.error || 'Something went wrong. Please try again.'), { status: response.status })
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

export function ShoppingWorkspace({ onSignIn }: Props) {
  const { data, error, mutate } = useSWR<ShoppingListResponse>('/api/shopping', loadShoppingItems, { revalidateOnFocus: true, revalidateOnReconnect: true })
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [filter, setFilter] = useState<'all' | 'needed' | 'purchased'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const items = data?.items ?? []
  const purchasedCount = useMemo(() => items.filter((item) => item.purchased).length, [items])
  const visibleItems = useMemo(() => items.filter((item) => filter === 'all' || (filter === 'purchased' ? item.purchased : !item.purchased)), [filter, items])
  const needsSignIn = (error as (Error & { status?: number }) | undefined)?.status === 401 || error?.message.includes('Sign in')
  const progress = items.length ? Math.round((purchasedCount / items.length) * 100) : 0

  useEffect(() => {
    const onSync = () => { void mutate() }
    window.addEventListener('pocketflow:shopping-sync-complete', onSync)
    return () => window.removeEventListener('pocketflow:shopping-sync-complete', onSync)
  }, [mutate])

  async function saveOfflineList(nextItems: ShoppingItem[], mutation: Omit<ShoppingMutation, 'id' | 'ownerId' | 'queuedAt' | 'attempts' | 'nextAttemptAt'>) {
    await enqueueShoppingMutation(mutation)
    await saveShoppingCache(nextItems)
    await mutate({ items: nextItems }, { revalidate: false })
    window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: 'offline' }))
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName || busy) return
    setBusy('add')
    setNotice('')
    const id = crypto.randomUUID()
    const input = { name: cleanName, quantity, purchased: false }
    const optimistic: ShoppingItem = { id, version: 0, ...input, updatedAt: new Date().toISOString() }
    try {
      if (!navigator.onLine) {
        await saveOfflineList([optimistic, ...items], { operation: 'create', recordId: id, version: 0, data: input })
        setNotice(`${cleanName} saved on this device. It will sync when you reconnect.`)
      } else {
        try {
          await request<ShoppingItem>('/api/shopping', { method: 'POST', body: JSON.stringify({ id, ...input }) })
          await mutate()
          setNotice(`${cleanName} added to your list.`)
        } catch (reason) {
          if ((reason as { status?: number }).status === 401 || !(reason instanceof TypeError)) throw reason
          await saveOfflineList([optimistic, ...items], { operation: 'create', recordId: id, version: 0, data: input })
          setNotice(`${cleanName} saved on this device. It will sync when the service returns.`)
        }
      }
      setName('')
      setQuantity(1)
    } catch (reason) { setNotice((reason as Error).message) } finally { setBusy(null) }
  }

  async function updateItem(item: ShoppingItem, patch: Partial<ShoppingInput>) {
    if (busy) return
    setBusy(item.id)
    setNotice('')
    const input = { name: item.name, quantity: patch.quantity ?? item.quantity, purchased: patch.purchased ?? item.purchased }
    const nextItem: ShoppingItem = { ...item, ...input, version: item.version + 1, updatedAt: new Date().toISOString() }
    const nextItems = [nextItem, ...items.filter((entry) => entry.id !== item.id)]
    try {
      if (!navigator.onLine) {
        await saveOfflineList(nextItems, { operation: 'update', recordId: item.id, version: item.version, data: input })
      } else {
        try {
          await request<ShoppingItem>(`/api/shopping/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify({ ...input, version: item.version }) })
          await mutate()
        } catch (reason) {
          if ((reason as { status?: number }).status === 401 || !(reason instanceof TypeError)) throw reason
          await saveOfflineList(nextItems, { operation: 'update', recordId: item.id, version: item.version, data: input })
          setNotice('Saved on this device. This change will sync when the service returns.')
        }
      }
    } catch (reason) {
      setNotice((reason as Error).message)
      await mutate()
    } finally { setBusy(null) }
  }

  async function deleteItem(item: ShoppingItem) {
    if (busy) return
    setBusy(item.id)
    setNotice('')
    const nextItems = items.filter((entry) => entry.id !== item.id)
    try {
      if (!navigator.onLine) {
        await saveOfflineList(nextItems, { operation: 'delete', recordId: item.id, version: item.version })
        setNotice(`${item.name} removed on this device. It will sync when you reconnect.`)
      } else {
        try {
          await request<void>(`/api/shopping/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
          await mutate()
          setNotice(`${item.name} removed.`)
        } catch (reason) {
          if ((reason as { status?: number }).status === 401 || !(reason instanceof TypeError)) throw reason
          await saveOfflineList(nextItems, { operation: 'delete', recordId: item.id, version: item.version })
          setNotice(`${item.name} removed on this device. It will sync when the service returns.`)
        }
      }
    } catch (reason) { setNotice((reason as Error).message) } finally { setBusy(null) }
  }

  async function clearPurchased() {
    if (busy || !purchasedCount) return
    setBusy('clear')
    setNotice('')
    const purchased = items.filter((item) => item.purchased)
    try {
      if (!navigator.onLine) {
        let nextItems = [...items]
        for (const item of purchased) {
          await enqueueShoppingMutation({ operation: 'delete', recordId: item.id, version: item.version })
          nextItems = nextItems.filter((entry) => entry.id !== item.id)
        }
        await saveShoppingCache(nextItems)
        await mutate({ items: nextItems }, { revalidate: false })
        window.dispatchEvent(new CustomEvent('pocketflow:sync-complete', { detail: 'offline' }))
      } else {
        await Promise.all(purchased.map((item) => request<void>(`/api/shopping/${encodeURIComponent(item.id)}`, { method: 'DELETE' })))
        await mutate()
      }
      setNotice('Purchased items cleared.')
    } catch (reason) {
      setNotice((reason as Error).message)
      await mutate()
    } finally { setBusy(null) }
  }

  return <section className="shopping-page" aria-labelledby="shopping-title">
    <header className="shopping-head">
      <div><p className="eyebrow">YOUR EVERYDAY LIST</p><h1 id="shopping-title">Shopping list</h1><p>Keep the essentials close. Your list syncs to your account and stays available offline.</p></div>
      {data && !needsSignIn && <div className="shopping-count-card"><span className="shopping-count-icon"><ShoppingBasket size={19}/></span><span><strong>{items.length}</strong><small>{items.length === 1 ? 'item on your list' : 'items on your list'}</small></span></div>}
    </header>

    {data && !needsSignIn && <section className="shopping-progress panel" aria-label="Shopping progress">
      <div className="shopping-progress-copy"><div><span className="eyebrow">LIST PROGRESS</span><strong>{purchasedCount} of {items.length} picked up</strong></div><span className="shopping-progress-percent">{progress}%</span></div>
      <div className="shopping-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={items.length || 1} aria-valuenow={purchasedCount} aria-label="Items purchased"><span style={{ width: `${progress}%` }}/></div>
      <p>{items.length ? (purchasedCount === items.length ? 'Everything is checked off. Nice work.' : `${items.length - purchasedCount} ${items.length - purchasedCount === 1 ? 'item' : 'items'} left to find`) : 'Add your first item to get your list started.'}</p>
    </section>}

    {needsSignIn ? <section className="shopping-empty panel"><span className="shopping-empty-icon"><ShoppingBasket size={22}/></span><h2>Sign in to keep your list</h2><p>Your shopping items are private to your account and sync across your devices.</p><button className="button button-primary" onClick={onSignIn}>Sign in to continue</button></section> : error && !data ? <section className="shopping-empty panel" role="alert"><span className="shopping-empty-icon"><ShoppingBasket size={22}/></span><h2>Couldn&apos;t reach your saved list</h2><p>Your shopping data hasn&apos;t been changed. Check your connection and try again.</p><button className="button button-secondary" onClick={() => void mutate()}>Try again</button></section> : !data ? <section className="shopping-loading" aria-live="polite"><LoaderCircle className="spin" size={18}/> Loading your saved listâ€¦</section> : <>
      {error && <p className="shopping-notice" role="status">Couldn&apos;t refresh. Showing the last loaded list.</p>}
      <form className="shopping-add panel" onSubmit={(event) => void addItem(event)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }}>
        <label className="shopping-name-field"><span className="sr-only">Item name</span><input autoComplete="off" maxLength={120} placeholder="What do you need?" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="shopping-quantity-field"><span>Qty</span><input aria-label="Quantity" type="number" min={1} max={999} value={quantity} onChange={(event) => setQuantity(Math.min(999, Math.max(1, Number(event.target.value) || 1)))} /></div>
        <button className="button button-primary shopping-add-button" type="submit" disabled={!name.trim() || Boolean(busy)}>{busy === 'add' ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>}<span>Add item</span></button>
      </form>

      <div className="shopping-list-toolbar"><div className="shopping-filters" role="group" aria-label="Filter shopping items">{([['all', 'Everything', items.length], ['needed', 'To get', items.length - purchasedCount], ['purchased', 'Picked up', purchasedCount]] as const).map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}</div>{purchasedCount > 0 && <button className="shopping-clear-button" onClick={() => void clearPurchased()} disabled={Boolean(busy)}><Trash2 size={14}/> Clear picked up</button>}</div>

      {notice && <p className="shopping-notice" role="status">{notice}</p>}
      {visibleItems.length === 0 ? <section className="shopping-empty panel"><span className="shopping-empty-icon">{filter === 'purchased' ? <CheckCheck size={22}/> : <ShoppingBasket size={22}/>}</span><h2>{items.length === 0 ? 'A fresh start' : filter === 'needed' ? 'Youâ€™re all caught up' : filter === 'purchased' ? 'Nothing picked up yet' : 'No items here'}</h2><p>{items.length === 0 ? 'Add what you need above. Your list will appear here, ready for your next shop.' : filter === 'needed' ? 'Everything on your list has been checked off.' : 'Items that you mark as picked up will show here.'}</p></section> : <ul className="shopping-items" aria-label="Shopping items">{visibleItems.map((item) => <li key={item.id} className={`shopping-item panel${item.purchased ? ' is-purchased' : ''}`}>
        <button className="shopping-check" aria-label={`${item.purchased ? 'Mark' : 'Mark'} ${item.name} as ${item.purchased ? 'needed' : 'picked up'}`} aria-pressed={item.purchased} disabled={Boolean(busy)} onClick={() => void updateItem(item, { purchased: !item.purchased })}>{busy === item.id ? <LoaderCircle className="spin" size={17}/> : item.purchased ? <Check size={17}/> : null}</button>
        <span className="shopping-item-name"><strong>{item.name}</strong><small>{item.purchased ? 'Picked up' : 'On your list'}</small></span>
        <div className="shopping-stepper" aria-label={`Quantity: ${item.quantity}`}><button aria-label={`Decrease ${item.name} quantity`} disabled={item.quantity <= 1 || Boolean(busy)} onClick={() => void updateItem(item, { quantity: item.quantity - 1 })}><Minus size={13}/></button><span>{item.quantity}</span><button aria-label={`Increase ${item.name} quantity`} disabled={item.quantity >= 999 || Boolean(busy)} onClick={() => void updateItem(item, { quantity: item.quantity + 1 })}><Plus size={13}/></button></div>
        <button className="shopping-delete" aria-label={`Remove ${item.name}`} disabled={Boolean(busy)} onClick={() => void deleteItem(item)}><Trash2 size={16}/></button>
      </li>)}</ul>}
      <p className="shopping-footnote"><CheckCheck size={14}/>{navigator.onLine ? 'Changes sync to your account automatically.' : 'Offline · changes are saved on this device and queued to sync.'}</p>
    </>}
  </section>
}

