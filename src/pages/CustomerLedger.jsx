import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, HandCoins, Pencil, Plus, Printer } from 'lucide-react'
import { getCustomer, getCustomerLedger } from '../lib/api'
import { formatDate, money } from '../lib/format'
import { customerLabel } from '../lib/customerFields'
import { EmptyState, ErrorBanner, Loading } from '../components/ui'
import { CustomerModal } from '../components/RecordModals'
import ReceiptModal from '../components/ReceiptModal'
import { useAuth } from '../auth/AuthProvider'

const KIND_LABELS = { opening: 'Opening', sale: 'Sale', return: 'Return', receipt: 'Receipt' }

export default function CustomerLedger() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [customer, setCustomer] = useState(null)
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [modal, setModal] = useState(null) // 'edit' | 'receipt'

  const load = () =>
    Promise.all([getCustomer(id), getCustomerLedger(id)])
      .then(([c, e]) => {
        setCustomer(c)
        setEntries(e)
      })
      .catch((e) => setError(e.message))

  useEffect(() => {
    setCustomer(null)
    setEntries(null)
    load()
  }, [id])

  // Entries before `from` (and the opening balance) become one brought-forward line
  const view = useMemo(() => {
    if (!entries) return null
    let balance = 0
    let opening = 0
    const rows = []
    for (const e of entries) {
      const amt = Number(e.debit) - Number(e.credit)
      if (from && (e.entry_date === null || e.entry_date < from)) {
        opening += amt
        balance += amt
        continue
      }
      if (to && e.entry_date > to) continue
      balance += amt
      rows.push({ ...e, balance })
    }
    const debit = rows.reduce((s, r) => s + Number(r.debit), 0)
    const credit = rows.reduce((s, r) => s + Number(r.credit), 0)
    const current = entries.reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0)
    return { rows, opening, debit, credit, closing: opening + debit - credit, current }
  }, [entries, from, to])

  if (!customer || !view) return error ? <ErrorBanner message={error} /> : <Loading />

  const refLink = (e) => {
    if (e.kind === 'sale' || e.kind === 'return') return <Link to={`/invoices/${e.ref_id}`} className="link">Inv #{e.ref_no}</Link>
    if (e.kind === 'receipt') return `Rcpt #${e.ref_no}`
    return '—'
  }

  const overLimit = Number(customer.credit_limit) > 0 && view.current > Number(customer.credit_limit)

  return (
    <>
      <div className="page-header no-print">
        <div>
          <Link to="/customers" className="back-link">
            <ArrowLeft size={15} /> Customers
          </Link>
          <h1>Customer ledger</h1>
        </div>
        <div className="page-actions">
          {isAdmin && (
            <button className="btn btn-secondary" onClick={() => setModal('edit')}>
              <Pencil size={16} /> Edit
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          <button className="btn btn-secondary" onClick={() => setModal('receipt')}>
            <HandCoins size={16} /> Receive payment
          </button>
          <Link to={`/invoices/new?customer=${customer.id}`} className="btn btn-primary">
            <Plus size={16} /> New sale
          </Link>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card ledger-head">
        <div>
          <div className="text-muted mono">Code {customer.code}</div>
          <h2>{customerLabel(customer)}</h2>
          <div className="text-secondary">
            {[customer.contact_person, customer.phone, customer.phone2].filter(Boolean).join(' · ') || 'No contact details'}
          </div>
          {customer.address && <div className="text-secondary">{customer.address}</div>}
        </div>
        <div className="ledger-total">
          <div className="meta-label">{view.current < 0 ? 'We owe them' : 'Balance due'}</div>
          <div className={`ledger-total-value ${overLimit ? 'text-critical' : ''}`}>{money(Math.abs(view.current))}</div>
          {Number(customer.credit_limit) > 0 && (
            <div className={overLimit ? 'text-critical' : 'text-muted'}>
              Credit limit {money(customer.credit_limit)}
              {overLimit && ' · over limit'}
            </div>
          )}
        </div>
      </div>

      <div className="card card-flush">
        <div className="toolbar no-print">
          <div className="date-range">
            <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="text-muted">to</span>
            <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          {(from || to) && (
            <button className="btn btn-ghost btn-sm" onClick={() => (setFrom(''), setTo(''))}>
              Show all
            </button>
          )}
        </div>

        <div className="print-only print-title">
          {customerLabel(customer)} · Ledger{(from || to) && ` · ${from ? formatDate(from) : '…'} to ${to ? formatDate(to) : '…'}`}
        </div>

        {view.rows.length === 0 && !view.opening ? (
          <EmptyState icon={BookOpen} title="No entries yet" text="Sales, returns and payments for this customer will appear here." />
        ) : (
          <table className="table table-compact table-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Ref</th>
                <th>Description</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {from && (
                <tr className="row-muted">
                  <td>{formatDate(from)}</td>
                  <td colSpan={5}>Balance brought forward</td>
                  <td className="num strong">{money(view.opening)}</td>
                </tr>
              )}
              {view.rows.map((e, i) => (
                <tr key={`${e.kind}-${e.ref_id ?? 'opening'}-${i}`}>
                  <td className="text-secondary nowrap">{e.entry_date ? formatDate(e.entry_date) : '—'}</td>
                  <td>{KIND_LABELS[e.kind]}</td>
                  <td className="nowrap">{refLink(e)}</td>
                  <td className="text-secondary">{e.description}</td>
                  <td className="num">{Number(e.debit) ? money(e.debit) : ''}</td>
                  <td className="num">{Number(e.credit) ? money(e.credit) : ''}</td>
                  <td className="num strong">{money(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-secondary">
                  Totals
                </td>
                <td className="num strong">{money(view.debit)}</td>
                <td className="num strong">{money(view.credit)}</td>
                <td className="num strong">{money(view.closing)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {modal === 'edit' && (
        <CustomerModal
          customer={customer}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
          onDeleted={() => navigate('/customers', { replace: true })}
        />
      )}
      {modal === 'receipt' && (
        <ReceiptModal
          customer={customer}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
    </>
  )
}
