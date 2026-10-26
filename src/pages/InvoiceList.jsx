import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, ReceiptText, Search } from 'lucide-react'
import { findInvoiceId, listInvoices } from '../lib/api'
import { DELIVERY_LABELS, formatDate, money, monthStart, today } from '../lib/format'
import { matchesWords } from '../lib/stock'
import { EmptyState, ErrorBanner, Loading, PageHeader, TxnBadge } from '../components/ui'
import { DateRange } from '../components/Pickers'
import { useAuth } from '../auth/AuthProvider'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit' },
  { value: 'return', label: 'Returns' },
]

const net = (r) => (r.txn_type === 'return' ? -Number(r.total) : Number(r.total))

export default function InvoiceList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [goNo, setGoNo] = useState('')

  useEffect(() => {
    setRows(null)
    listInvoices(range).then(setRows).catch((e) => setError(e.message))
  }, [range])

  const filtered = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        if (filter === 'return' && r.txn_type !== 'return') return false
        if ((filter === 'cash' || filter === 'credit') && (r.txn_type !== 'sale' || r.payment_mode !== filter)) return false
        return matchesWords(q, String(r.invoice_no), r.customers?.name, r.customers?.city, r.bilty_no)
      }),
    [rows, q, filter],
  )

  const total = filtered.reduce((s, r) => s + net(r), 0)

  async function goTo(e) {
    e.preventDefault()
    const no = Number(goNo)
    if (!Number.isInteger(no) || no <= 0) return
    setError('')
    try {
      const id = await findInvoiceId(no)
      if (id) navigate(`/invoices/${id}`)
      else setError(`Invoice #${no} was not found.`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <PageHeader
        title="Sale invoices"
        subtitle="Sales and returns. Click a row to view or print."
        actions={
          <>
            <form className="go-to" onSubmit={goTo}>
              <input className="input" inputMode="numeric" placeholder="Invoice #" value={goNo} onChange={(e) => setGoNo(e.target.value)} aria-label="Open invoice number" />
              <button className="btn btn-secondary">Open</button>
            </form>
            <Link to="/invoices/new" className="btn btn-primary">
              <Plus size={16} /> New sale
            </Link>
          </>
        }
      />

      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search invoice #, customer, city or bilty" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <DateRange {...range} onChange={setRange} />
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.value} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {!rows && !error && <Loading />}
        {rows && filtered.length === 0 && (
          <EmptyState
            icon={rows.length ? Search : ReceiptText}
            title={rows.length ? 'No matches' : 'No invoices in these dates'}
            text={rows.length ? 'Try a different search or filter.' : 'Change the dates, or create a new sale.'}
            action={
              !rows.length && (
                <Link to="/invoices/new" className="btn btn-primary btn-sm">
                  <Plus size={15} /> New sale
                </Link>
              )
            }
          />
        )}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Inv #</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Type</th>
                <th className="hide-sm">Delivery</th>
                {isAdmin && <th className="hide-sm">By</th>}
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="row-link" onClick={() => navigate(`/invoices/${r.id}`)}>
                  <td className="strong">{r.invoice_no}</td>
                  <td className="text-secondary nowrap">{formatDate(r.invoice_date)}</td>
                  <td>
                    {r.customers?.name}
                    {r.customers?.city && <span className="text-muted"> · {r.customers.city}</span>}
                  </td>
                  <td>
                    <TxnBadge type={r.txn_type} mode={r.payment_mode} />
                  </td>
                  <td className="text-secondary hide-sm">
                    {DELIVERY_LABELS[r.delivery_mode]}
                    {r.bilty_no && ` · ${r.bilty_no}`}
                  </td>
                  {isAdmin && <td className="text-secondary hide-sm">{r.created_by_name ?? '—'}</td>}
                  <td className={`num strong ${r.txn_type === 'return' ? 'text-warning' : ''}`}>{money(net(r))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="text-secondary">
                  {filtered.length} invoice{filtered.length === 1 ? '' : 's'} · net of returns
                </td>
                <td className="num strong">{money(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}
