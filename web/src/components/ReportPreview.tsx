import { useMemo, useState } from 'react'
import { Download, FileText, Printer } from 'lucide-react'
import type { FinanceRecord } from '../finance-store'
import './ReportPreview.css'

type Props = { transactions: FinanceRecord[]; currency: string }

function digits(currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 }
}

function money(minor: number, currency: string) {
  const places = digits(currency)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: places }).format(minor / (10 ** places))
}

function csvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value
  return `"${safeValue.replaceAll('"', '""')}"`
}

export function ReportPreview({ transactions, currency }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`)
  const [endDate, setEndDate] = useState(today)
  const [isOpen, setIsOpen] = useState(false)
  const reportTransactions = useMemo(() => transactions
    .filter((item) => item.data.currency === currency)
    .filter((item) => {
      const date = String(item.data.occurredAt || '').slice(0, 10)
      return date >= startDate && date <= endDate
    })
    .sort((a, b) => String(a.data.occurredAt || '').localeCompare(String(b.data.occurredAt || ''))), [currency, endDate, startDate, transactions])
  const income = reportTransactions.filter((item) => item.data.kind === 'income').reduce((total, item) => total + Number(item.data.amountMinor || 0), 0)
  const expenses = reportTransactions.filter((item) => item.data.kind === 'expense').reduce((total, item) => total + Number(item.data.amountMinor || 0), 0)
  const transfers = reportTransactions.filter((item) => item.data.kind === 'transfer').reduce((total, item) => total + Number(item.data.amountMinor || 0), 0)

  function downloadCsv() {
    const headings = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Currency']
    const lines = reportTransactions.map((item) => [
      new Date(String(item.data.occurredAt || '')).toLocaleDateString(),
      String(item.data.description || ''),
      String(item.data.category || ''),
      String(item.data.kind || ''),
      money(Number(item.data.amountMinor || 0), currency),
      currency,
    ])
    const csv = [headings, ...lines].map((row) => row.map((cell) => csvCell(String(cell))).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `pocketflow-report-${startDate}-to-${endDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <section className="report-builder panel" aria-labelledby="report-builder-title">
    <div className="report-builder-head"><span className="report-icon"><FileText size={18}/></span><div><h2 id="report-builder-title">Transaction report</h2><p>Preview, print, or export a date-bounded report in {currency}.</p></div></div>
    <div className="report-controls">
      <label className="form-field"><span>From</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)}/></label>
      <label className="form-field"><span>To</span><input type="date" value={endDate} min={startDate} max={today} onChange={(event) => setEndDate(event.target.value)}/></label>
      <button className="button button-primary" onClick={() => setIsOpen(true)}>Preview report</button>
    </div>
    {isOpen && <section className="report-preview" id="report-preview" aria-labelledby="report-title" aria-live="polite">
      <div className="report-preview-head"><div><p className="eyebrow">POCKETFLOW · FINANCIAL REPORT</p><h2 id="report-title">Transactions from {startDate} to {endDate}</h2><p>{reportTransactions.length} records · {currency}</p></div><div className="report-actions"><button className="button button-secondary" onClick={downloadCsv}><Download size={15}/>Download CSV</button><button className="button button-primary" onClick={() => window.print()}><Printer size={15}/>Print / Save PDF</button><button className="button button-secondary report-close" onClick={() => setIsOpen(false)}>Close</button></div></div>
      <div className="report-totals" aria-label="Report totals"><div><span>Income</span><strong>{money(income, currency)}</strong></div><div><span>Expenses</span><strong>{money(expenses, currency)}</strong></div><div><span>Net</span><strong>{money(income - expenses, currency)}</strong></div><div><span>Transfers</span><strong>{money(transfers, currency)}</strong></div></div>
      {reportTransactions.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Category</th><th scope="col">Type</th><th scope="col">Amount</th></tr></thead><tbody>{reportTransactions.map((item) => <tr key={item.id}><td>{new Date(String(item.data.occurredAt)).toLocaleDateString()}</td><td>{String(item.data.description || 'Transaction')}</td><td>{String(item.data.category || 'Uncategorized')}</td><td>{String(item.data.kind || 'transaction')}</td><td>{money(Number(item.data.amountMinor || 0), currency)}</td></tr>)}</tbody></table></div> : <p className="report-empty">No transactions were recorded in this date range.</p>}
    </section>}
  </section>
}
