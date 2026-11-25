import useSWR from 'swr'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CirclePlus, CreditCard, Target, WalletCards } from 'lucide-react'
import type { Section } from './Sidebar'
import { loadFinanceRecords, type FinanceRecord } from '../finance-store'

type Props = { onNavigate: (section: Section) => void; onAssistant: () => void; displayName?: string; currency: string; onSignIn: () => void }

function fractionDigits(currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 }
}

function money(minor: number, currency: string) {
  const digits = fractionDigits(currency)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits }).format(minor / (10 ** digits))
}

function sum(records: FinanceRecord[], currency: string, field: string) {
  return records.filter((item) => item.data.currency === currency).reduce((total, item) => total + Number(item.data[field] || 0), 0)
}

export function Dashboard({ onNavigate, onAssistant, displayName = '', currency, onSignIn }: Props) {
  const firstName = displayName.trim().split(/\s+/)[0] || 'there'
  const { data: accounts = [], error: accountError, isLoading: accountsLoading } = useSWR<FinanceRecord[], Error>('/api/finance/accounts', () => loadFinanceRecords('accounts'))
  const { data: transactions = [], error: transactionError, isLoading: transactionsLoading } = useSWR<FinanceRecord[], Error>('/api/finance/transactions', () => loadFinanceRecords('transactions'))
  const { data: budgets = [] } = useSWR<FinanceRecord[]>('/api/finance/budgets', () => loadFinanceRecords('budgets'))
  const { data: goals = [] } = useSWR<FinanceRecord[]>('/api/finance/goals', () => loadFinanceRecords('goals'))
  const monthKey = new Date().toISOString().slice(0, 7)
  const currentTransactions = transactions.filter((item) => String(item.data.occurredAt || '').startsWith(monthKey) && item.data.currency === currency)
  const income = currentTransactions.filter((item) => item.data.kind === 'income').reduce((total, item) => total + Number(item.data.amountMinor || 0), 0)
  const expenses = currentTransactions.filter((item) => item.data.kind === 'expense').reduce((total, item) => total + Number(item.data.amountMinor || 0), 0)
  const balance = sum(accounts, currency, 'balanceMinor')
  const recent = [...transactions].sort((a, b) => String(b.data.occurredAt).localeCompare(String(a.data.occurredAt))).slice(0, 5)
  const loading = accountsLoading || transactionsLoading
  const needsSignIn = [accountError, transactionError].some((error) => error?.message.includes('Sign in'))

  return <div className="page-stack">
    <div className="demo-banner"><span className="demo-dot"/><span><strong>Private by default</strong> · Your totals include records you have saved in PocketFlow, in {currency}.</span><button onClick={() => onNavigate('accounts')}>Manage accounts <ArrowRight size={14}/></button></div>
    <section className="welcome-row"><div><p className="eyebrow">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase()}</p><h1>Good morning, {firstName}</h1><p className="welcome-sub">A clear picture of the money you have recorded.</p></div><button className="button button-primary" onClick={() => onNavigate('transactions')}><CirclePlus size={17}/> Add transaction</button></section>
    {needsSignIn && <section className="finance-message" role="status"><span>Sign in to view and sync your private financial records.</span><button className="text-link" onClick={onSignIn}>Sign in <ArrowRight size={14}/></button></section>}
    <section className="stat-grid" aria-label="Financial summary"><article className="stat-card balance-card"><div className="stat-top"><span>Total account balance</span><WalletCards size={16}/></div><div className="stat-value">{money(balance, currency)}</div><div className="stat-foot"><span>{accounts.filter((item) => item.data.currency === currency).length} account{accounts.filter((item) => item.data.currency === currency).length === 1 ? '' : 's'} in {currency}</span></div></article><article className="stat-card"><div className="stat-top"><span>Income</span><span className="stat-icon income"><ArrowDownLeft size={16}/></span></div><div className="stat-value">{money(income, currency)}</div><div className="stat-foot"><span>This month</span></div></article><article className="stat-card"><div className="stat-top"><span>Expenses</span><span className="stat-icon expense"><ArrowUpRight size={16}/></span></div><div className="stat-value">{money(expenses, currency)}</div><div className="stat-foot"><span>This month</span></div></article></section>
    {loading && <section className="finance-empty panel" aria-live="polite"><p>Loading your saved financial records…</p></section>}
    {!loading && accounts.length === 0 && transactions.length === 0 && <section className="finance-empty panel"><div className="empty-illustration"><WalletCards size={24}/></div><h2>Your overview starts with your records</h2><p>No example figures are shown here. Add an account or transaction to see your actual totals.</p><button className="button button-primary" onClick={() => onNavigate('accounts')}><CirclePlus size={16}/> Add your first account</button></section>}
    <section className="lower-grid"><article className="panel transactions-panel"><div className="panel-heading"><div><h2>Recent transactions</h2><p>Your latest saved activity</p></div><button className="text-link" onClick={() => onNavigate('transactions')}>See all <ArrowRight size={15}/></button></div>{recent.length ? <div className="transaction-list">{recent.map((item) => { const positive = item.data.kind === 'income'; const transactionCurrency = String(item.data.currency || currency); return <div className="transaction-row" key={item.id}><span className={`transaction-icon ${positive ? 'mint' : 'peach'}`}>{positive ? <ArrowDownLeft size={17}/> : <CreditCard size={17}/>}</span><span className="transaction-info"><strong>{String(item.data.description || 'Transaction')}</strong><span>{String(item.data.category || 'Uncategorized')} · {new Date(String(item.data.occurredAt)).toLocaleDateString()}</span></span><strong className={`transaction-amount ${positive ? 'positive' : ''}`}>{positive ? '+' : '−'} {money(Number(item.data.amountMinor || 0), transactionCurrency)}</strong></div>})}</div> : <p className="dashboard-empty-copy">Your recent transactions will appear here.</p>}</article><article className="assistant-callout"><span className="callout-label">YOUR FINANCIAL SNAPSHOT</span><h2>Plan at your own pace.</h2><p>{budgets.length ? `${budgets.length} budget${budgets.length === 1 ? '' : 's'} and ${goals.length} savings goal${goals.length === 1 ? '' : 's'} are ready to guide your next steps.` : 'Create a budget or savings goal to make your next step feel more achievable.'}</p><div className="dashboard-shortcuts"><button onClick={() => onNavigate('budgets')}><CreditCard size={15}/> Budgets <ArrowRight size={14}/></button><button onClick={() => onNavigate('goals')}><Target size={15}/> Goals <ArrowRight size={14}/></button></div><button className="button callout-button" onClick={onAssistant}>Open My PF Assistant <ArrowRight size={15}/></button></article></section>
    <section className="bottom-prompt"><div className="bottom-icon"><Target size={17}/></div><div><strong>{budgets.length ? 'Small steps build a steady plan' : 'Start with a simple budget'}</strong><p>{budgets.length ? 'Your plans stay private and sync to your account when online.' : 'Set a spending limit that feels realistic for this month.'}</p></div><button onClick={() => onNavigate('budgets')} aria-label="Create a budget"><ArrowRight size={18}/></button></section>
  </div>
}
