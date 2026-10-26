import { useState } from 'react'
import { UserRound, X } from 'lucide-react'
import { createReceipt } from '../lib/api'
import { METHOD_LABELS, money, today } from '../lib/format'
import { customerLabel } from '../lib/customerFields'
import { ErrorBanner, Field, Modal } from './ui'
import { CustomerSearch } from './Pickers'

// Money received from a customer. Pass `customer` to fix it, or `customers` to choose one.
export default function ReceiptModal({ customer: fixed, customers = [], balances, onClose, onSaved }) {
  const [customer, setCustomer] = useState(fixed ?? null)
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const value = Number(String(amount).replace(/,/g, ''))
  const valid = customer && Number.isFinite(value) && value > 0 && date

  async function handleSave(e) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError('')
    try {
      onSaved(await createReceipt({ customerId: customer.id, date, amount: value, method, reference, note }))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const balance = customer && balances ? (balances[customer.id] ?? 0) : null

  return (
    <Modal
      title="Receive payment"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="receipt-form" className="btn btn-primary" disabled={!valid || busy}>
            {busy ? 'Saving…' : `Save receipt${valid ? ` · ${money(value)}` : ''}`}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <form id="receipt-form" className="form-grid" onSubmit={handleSave} noValidate>
        <div className="span-all">
          <Field label="Customer">
            {customer ? (
              <div className="picked">
                <UserRound size={16} />
                <span className="strong">{customerLabel(customer)}</span>
                {balance !== null && <span className="text-muted">Balance {money(balance)}</span>}
                {!fixed && (
                  <button type="button" className="icon-btn" onClick={() => setCustomer(null)} aria-label="Change customer">
                    <X size={15} />
                  </button>
                )}
              </div>
            ) : (
              <CustomerSearch customers={customers} balances={balances} onPick={setCustomer} autoFocus />
            )}
          </Field>
        </div>
        <Field label="Amount (Rs)">
          <input className="input input-num" inputMode="decimal" autoFocus={Boolean(fixed)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Method">
          <div className="segmented segmented-fill">
            {Object.entries(METHOD_LABELS).map(([k, label]) => (
              <button type="button" key={k} className={method === k ? 'active' : ''} onClick={() => setMethod(k)}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={method === 'cheque' ? 'Cheque no.' : method === 'bank' ? 'Bank / reference' : 'Reference'}>
          <input className="input" value={reference} placeholder="Optional" onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className="span-all">
          <Field label="Note">
            <input className="input" value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
