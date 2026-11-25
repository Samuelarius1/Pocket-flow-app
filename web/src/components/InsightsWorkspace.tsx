import useSWR from 'swr'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, ChartNoAxesCombined, CreditCard, Target } from 'lucide-react'
import { loadFinanceRecords, type FinanceRecord } from '../finance-store'

function digits(currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 }
}

function money(minor: number, currency: string) {
  const places = digits(currency)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: places }).format(minor / (10 ** places))
}

export function InsightsWorkspace({ currency, onSignIn, onNavigate }: { currency: string; onSignIn: () => void; onNavigate: (section: 'transactions' | 'budgets' | 'goals') => void }) {
  const { data: transactions = [], error: transactionError, isLoading } = useSWR<FinanceRecord[], Error>('/api/finance/transactions', () => loadFinanceRecords('transactions'))
  const { data: budgets = [] } = useSWR<FinanceRecord[]>('/api/finance/budgets', () => loadFinanceRecords('budgets'))
  const { data: goals = [] } = useSWR<FinanceRecord[]>('/api/finance/goals', () => loadFinanceRecords('goals'))
  const month = new Date().toISOString().slice(0, 7)
  const expenses = transactions.filter((item) => item.data.kind === 'expense' && item.data.currency === currency && String(item.data.occurredAt || '').startsWith(month))
  const categoryTotals = new Map<string, number>()
  for (const transaction of expenses) {
    const category = String(transaction.data.category || 'Uncategorized')
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + Number(transaction.data.amountMinor || 0))
  }
  const chartData = [...categoryTotals.entries()].map(([category, amount]) => ({ category, amount, label: money(amount, currency) })).sort((a, b) => b.amount - a.amount).slice(0, 8)
  const spent = expenses.reduce((total, item) => total + Number(item.data.amountMinor || 0), 0)
  const needsSignIn = transactionError?.message.includes('Sign in')

  return <div className="page-stack finance-page">
    <section className="finance-page-head"><div><p className="eyebrow">YOUR MONEY, IN GOOD FLOW</p><h1>Insights</h1><p>See the patterns in the records you have saved.</p></div><button className="button button-primary" onClick={() => onNavigate('transactions')}>View transactions <ArrowRight size={15}/></button></section>
    {needsSignIn && <section className="finance-message" role="status"><span>Sign in to view and sync your private financial records.</span><button className="text-link" onClick={onSignIn}>Sign in <ArrowRight size={14}/></button></section>}
    {isLoading && <section className="finance-empty panel" aria-live="polite"><p>Calculating your insights…</p></section>}
    {!isLoading && <><section className="stat-grid" aria-label="Monthly spending summary"><article className="stat-card balance-card"><div className="stat-top"><span>Spent this month</span><ChartNoAxesCombined size={16}/></div><div className="stat-value">{money(spent, currency)}</div><div className="stat-foot"><span>{expenses.length} recorded expense{expenses.length === 1 ? '' : 's'} · {currency}</span></div></article><article className="stat-card"><div className="stat-top"><span>Budgets</span><CreditCard size={16}/></div><div className="stat-value">{budgets.length}</div><div className="stat-foot"><span>Active plans</span></div></article><article className="stat-card"><div className="stat-top"><span>Savings goals</span><Target size={16}/></div><div className="stat-value">{goals.length}</div><div className="stat-foot"><span>Personal milestones</span></div></article></section>
      <section className="panel insight-chart-panel"><div className="panel-heading"><div><h2>Spending by category</h2><p>Current month · {currency}</p></div></div>{chartData.length ? <div className="insight-chart" role="img" aria-label="Bar chart of this month's spending by category"><ResponsiveContainer width="100%" height={Math.max(190, chartData.length * 42)}><BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }} accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--line)"/><XAxis type="number" hide/><YAxis type="category" dataKey="category" width={110} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip formatter={(value) => money(Number(value), currency)} cursor={{ fill: 'var(--primary-soft)' }}/><Bar dataKey="amount" name="Spent" fill="var(--primary)" radius={[0, 6, 6, 0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div> : <div className="insight-empty"><ChartNoAxesCombined size={21}/><p>Your category breakdown will appear after you record expenses for this month.</p></div>}</section>
      <section className="insight-lower-grid"><article className="panel insight-list-panel"><div className="panel-heading"><div><h2>Budget check-in</h2><p>Spending compared with your limits</p></div><button className="text-link" onClick={() => onNavigate('budgets')}>Manage <ArrowRight size={14}/></button></div>{budgets.length ? budgets.map((budget) => { const category = String(budget.data.category || ''); const limit = Number(budget.data.amountMinor || 0); const currencyCode = String(budget.data.currency || currency); const actual = transactions.filter((item) => item.data.kind === 'expense' && item.data.category === category && item.data.currency === currencyCode && String(item.data.occurredAt || '').slice(0, 10) >= String(budget.data.periodStart || '') && String(item.data.occurredAt || '').slice(0, 10) <= String(budget.data.periodEnd || '')).reduce((total, item) => total + Number(item.data.amountMinor || 0), 0); const percent = limit > 0 ? Math.min(100, Math.round(actual / limit * 100)) : 0; return <div className="insight-progress" key={budget.id}><div><strong>{category}</strong><span>{money(actual, currencyCode)} of {money(limit, currencyCode)}</span></div><progress value={percent} max="100" aria-label={`${category} budget ${percent}% used`}/></div> }) : <p className="dashboard-empty-copy">Add a budget to compare planned and actual spending.</p>}</article><article className="panel insight-list-panel"><div className="panel-heading"><div><h2>Savings progress</h2><p>Small steps toward your goals</p></div><button className="text-link" onClick={() => onNavigate('goals')}>Manage <ArrowRight size={14}/></button></div>{goals.length ? goals.map((goal) => { const target = Number(goal.data.targetMinor || 0); const saved = Number(goal.data.savedMinor || 0); const percent = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0; const goalCurrency = String(goal.data.currency || currency); return <div className="insight-progress" key={goal.id}><div><strong>{String(goal.data.name || 'Savings goal')}</strong><span>{money(saved, goalCurrency)} of {money(target, goalCurrency)}</span></div><progress value={percent} max="100" aria-label={`${String(goal.data.name || 'Savings goal')} ${percent}% complete`}/></div> }) : <p className="dashboard-empty-copy">Create a savings goal to track progress toward what matters to you.</p>}</article></section>
    </>}
  </div>
}
