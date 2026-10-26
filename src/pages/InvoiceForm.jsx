import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, History, Plus, Trash2, UserRound, X } from 'lucide-react'
import { createInvoice, getDefaultCompany, getPriceHistory, listBalances, listCustomers, listLocations, listProducts, listStockLevels } from '../lib/api'
import { DELIVERY_LABELS, computeInvoice, formatDate, money, num, qtyText, toQty, today } from '../lib/format'
import { bestLocation, stockIndex } from '../lib/stock'
import { customerLabel } from '../lib/customerFields'
import { ErrorBanner, Field, Loading } from '../components/ui'
import { CustomerSearch, ProductSearch } from '../components/Pickers'
import { CustomerModal } from '../components/RecordModals'
import { useAuth } from '../auth/AuthProvider'

const n = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0

export default function InvoiceForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { isAdmin } = useAuth()

  const [ready, setReady] = useState(false)
  const [company, setCompany] = useState(null)
  const [products, setProducts] = useState([])
  const [stock, setStock] = useState({})
  const [locations, setLocations] = useState([])
  const [customers, setCustomers] = useState([])
  const [balances, setBalances] = useState({})
  const [error, setError] = useState('')

  const [customer, setCustomer] = useState(null)
  const [date, setDate] = useState(today())
  const [txnType, setTxnType] = useState('sale')
  const [paymentMode, setPaymentMode] = useState('credit')
  const [deliveryMode, setDeliveryMode] = useState('counter')
  const [biltyNo, setBiltyNo] = useState('')
  const [items, setItems] = useState([]) // { key, product_id, name, code, unit, carton_qty, min_price, location_id, cartons, loose, unit_price }
  const [discount, setDiscount] = useState('')
  const [freight, setFreight] = useState('')
  const [received, setReceived] = useState('')
  const [receivedTouched, setReceivedTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)

  // Entry panel for the product being added
  const [entry, setEntry] = useState(null) // { product, location_id, cartons, loose, unit_price }
  const [history, setHistory] = useState([])
  const searchRef = useRef(null)
  const cartonsRef = useRef(null)
  const looseRef = useRef(null)
  const rateRef = useRef(null)

  useEffect(() => {
    Promise.all([getDefaultCompany(), listProducts(), listStockLevels(), listLocations(), listCustomers(), listBalances()])
      .then(([co, p, levels, locs, cu, bal]) => {
        setCompany(co)
        setProducts(p)
        setStock(stockIndex(levels))
        setLocations(locs.filter((l) => l.active))
        setCustomers(cu)
        setBalances(bal)
        const pre = params.get('customer')
        if (pre) setCustomer(cu.find((c) => c.id === pre) ?? null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true))
  }, [])

  // Last sales of the product being added, to this customer
  useEffect(() => {
    setHistory([])
    if (!entry?.product || !customer) return
    let live = true
    getPriceHistory(customer.id, entry.product.id)
      .then((h) => live && setHistory(h))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [entry?.product, customer])

  const totals = useMemo(() => computeInvoice(items, discount, freight), [items, discount, freight])

  // Cash: money taken = bill total, unless the user typed another amount
  useEffect(() => {
    if (!receivedTouched) setReceived(paymentMode === 'cash' ? String(totals.total) : '')
  }, [paymentMode, totals.total, receivedTouched])

  if (!ready) return <Loading />
  if (!company) return <ErrorBanner message={error || 'Add your business details in Settings first.'} />

  const isSale = txnType === 'sale'
  const available = (productId, locationId) => stock[productId]?.byLocation[locationId] ?? 0

  // Qty already on the bill per product+store, so two lines can't both use the same stock
  const usedOnBill = (productId, locationId, exceptKey) =>
    items
      .filter((i) => i.product_id === productId && i.location_id === locationId && i.key !== exceptKey)
      .reduce((s, i) => s + toQty(i.cartons, i.loose, i.carton_qty), 0)

  function pickProduct(p) {
    setEntry({
      product: p,
      location_id: bestLocation(stock[p.id], locations),
      cartons: '',
      loose: '',
      unit_price: String(p.price),
    })
    setTimeout(() => (p.carton_qty > 1 ? cartonsRef : looseRef).current?.focus(), 0)
  }

  const entryQty = entry ? toQty(entry.cartons, entry.loose, entry.product.carton_qty) : 0
  const entryValid = entry && entryQty > 0 && entry.unit_price !== '' && n(entry.unit_price) >= 0 && entry.location_id

  function addEntry() {
    if (!entryValid) return
    const p = entry.product
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: p.id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        carton_qty: p.carton_qty,
        min_price: Number(p.min_price),
        location_id: entry.location_id,
        cartons: entry.cartons,
        loose: entry.loose,
        unit_price: entry.unit_price,
      },
    ])
    setEntry(null)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const enterTo = (next) => (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (next) next.current?.focus()
    else addEntry()
  }

  const updateItem = (key, field, value) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
  const removeItem = (key) => setItems((prev) => prev.filter((i) => i.key !== key))

  const lines = items.map((i) => {
    const qty = toQty(i.cartons, i.loose, i.carton_qty)
    const avail = available(i.product_id, i.location_id) - usedOnBill(i.product_id, i.location_id, i.key)
    return {
      ...i,
      qty,
      amount: qty * n(i.unit_price),
      short: isSale && !company.allow_negative_stock && qty > avail,
      belowMin: isSale && i.min_price > 0 && n(i.unit_price) < i.min_price,
      avail,
    }
  })

  const prevBalance = customer ? (balances[customer.id] ?? 0) : 0
  const receivedNum = n(received)
  const afterBill = isSale ? prevBalance + totals.total - receivedNum : prevBalance - totals.total + receivedNum
  const overLimit = customer && Number(customer.credit_limit) > 0 && isSale && afterBill > Number(customer.credit_limit)

  const blocking = lines.some((l) => l.short || l.qty <= 0 || n(l.unit_price) < 0 || l.unit_price === '') || (!isAdmin && lines.some((l) => l.belowMin))
  const discountValid = totals.discount >= 0 && totals.discount <= totals.subtotal
  const canSave = customer && lines.length > 0 && !blocking && discountValid && totals.freight >= 0 && receivedNum >= 0 && date

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const id = await createInvoice({
        customerId: customer.id,
        items: lines,
        date,
        txnType,
        paymentMode,
        deliveryMode,
        biltyNo: deliveryMode === 'bilty' ? biltyNo : '',
        discount,
        freight,
        received,
        notes,
      })
      navigate(`/invoices/${id}`, { replace: true })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const entryAvail = entry ? available(entry.product.id, entry.location_id) - usedOnBill(entry.product.id, entry.location_id) : 0
  const entryShort = entry && isSale && !company.allow_negative_stock && entryQty > entryAvail
  const entryBelowMin = entry && isSale && Number(entry.product.min_price) > 0 && n(entry.unit_price) < Number(entry.product.min_price)

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/invoices" className="back-link">
            <ArrowLeft size={15} /> Sale invoices
          </Link>
          <h1>{isSale ? 'New sale invoice' : 'New sale return'}</h1>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card invoice-head">
        <div className="invoice-head-customer">
          <Field label="Customer">
            {customer ? (
              <div className="picked">
                <UserRound size={16} />
                <span className="strong">{customerLabel(customer)}</span>
                <span className="text-muted">#{customer.code}</span>
                <button type="button" className="icon-btn" onClick={() => setCustomer(null)} aria-label="Change customer">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="row-gap">
                <CustomerSearch
                  customers={customers}
                  balances={balances}
                  autoFocus
                  onPick={(c) => {
                    setCustomer(c)
                    setTimeout(() => searchRef.current?.focus(), 0)
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => setAddingCustomer(true)}>
                  <Plus size={15} /> New
                </button>
              </div>
            )}
          </Field>
        </div>
        <Field label="Date">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Type">
          <div className="segmented segmented-fill">
            <button type="button" className={isSale ? 'active' : ''} onClick={() => setTxnType('sale')}>
              Sale
            </button>
            <button type="button" className={!isSale ? 'active' : ''} onClick={() => setTxnType('return')}>
              Return
            </button>
          </div>
        </Field>
        <Field label="Payment">
          <div className="segmented segmented-fill">
            <button type="button" className={paymentMode === 'credit' ? 'active' : ''} onClick={() => setPaymentMode('credit')}>
              Credit
            </button>
            <button type="button" className={paymentMode === 'cash' ? 'active' : ''} onClick={() => setPaymentMode('cash')}>
              Cash
            </button>
          </div>
        </Field>
        <Field label="Delivery">
          <select className="input" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value)}>
            {Object.entries(DELIVERY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {deliveryMode === 'bilty' && (
          <Field label="Bilty no.">
            <input className="input" value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} placeholder="Goods transport receipt" />
          </Field>
        )}
      </div>

      <div className="builder">
        <div className="builder-main">
          <div className="card">
            <div className="card-head card-head-tight">
              <div>
                <h3>Add items</h3>
                <p className="text-secondary">Search, Enter, then cartons → loose → rate → Enter.</p>
              </div>
            </div>
            <ProductSearch ref={searchRef} products={products} stock={stock} onPick={pickProduct} />

            {entry && (
              <div className="entry-panel">
                <div className="entry-title">
                  <div>
                    <div className="strong">{entry.product.name}</div>
                    <div className="text-muted">
                      {entry.product.code} · {entry.product.carton_qty > 1 ? `${entry.product.carton_qty} ${entry.product.unit} per carton` : entry.product.unit} · Price{' '}
                      {money(entry.product.price)}
                      {Number(entry.product.min_price) > 0 && ` · Min ${money(entry.product.min_price)}`}
                    </div>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setEntry(null)} aria-label="Cancel item">
                    <X size={16} />
                  </button>
                </div>

                <div className="chips">
                  {locations.map((l) => {
                    const q = available(entry.product.id, l.id)
                    return (
                      <button
                        type="button"
                        key={l.id}
                        className={`chip ${entry.location_id === l.id ? 'active' : ''} ${q < 0 ? 'chip-critical' : q === 0 ? 'chip-empty' : ''}`}
                        onClick={() => setEntry((e) => ({ ...e, location_id: l.id }))}
                      >
                        {l.name}: <b>{qtyText(q, entry.product.unit, entry.product.carton_qty)}</b>
                      </button>
                    )
                  })}
                </div>

                {customer && history.length > 0 && (
                  <div className="history">
                    <div className="history-title">
                      <History size={14} /> Last sales to {customer.name}
                    </div>
                    <table className="table table-compact">
                      <tbody>
                        {history.map((h) => (
                          <tr key={`${h.invoice_id}-${h.unit_price}-${h.qty}`}>
                            <td>{formatDate(h.invoice_date)}</td>
                            <td>
                              Inv #{h.invoice_no}
                              {h.txn_type === 'return' && <span className="text-muted"> (return)</span>}
                            </td>
                            <td className="num">{qtyText(h.qty, entry.product.unit, entry.product.carton_qty)}</td>
                            <td className="num">
                              <button type="button" className="link-btn" onClick={() => setEntry((e) => ({ ...e, unit_price: String(h.unit_price) }))} title="Use this rate">
                                {money(h.unit_price)}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="entry-inputs">
                  <Field label="Cartons">
                    <input
                      ref={cartonsRef}
                      className="input input-num"
                      inputMode="decimal"
                      disabled={entry.product.carton_qty <= 1}
                      placeholder={entry.product.carton_qty <= 1 ? '—' : '0'}
                      value={entry.product.carton_qty <= 1 ? '' : entry.cartons}
                      onChange={(e) => setEntry((x) => ({ ...x, cartons: e.target.value }))}
                      onKeyDown={enterTo(looseRef)}
                    />
                  </Field>
                  <Field label={`Loose (${entry.product.unit})`}>
                    <input
                      ref={looseRef}
                      className="input input-num"
                      inputMode="decimal"
                      placeholder="0"
                      value={entry.loose}
                      onChange={(e) => setEntry((x) => ({ ...x, loose: e.target.value }))}
                      onKeyDown={enterTo(rateRef)}
                    />
                  </Field>
                  <Field label={`Rate per ${entry.product.unit}`}>
                    <input
                      ref={rateRef}
                      className={`input input-num ${entryBelowMin ? 'warn' : ''}`}
                      inputMode="decimal"
                      value={entry.unit_price}
                      onChange={(e) => setEntry((x) => ({ ...x, unit_price: e.target.value }))}
                      onKeyDown={enterTo(null)}
                    />
                  </Field>
                  <Field label="Amount">
                    <div className="input input-locked">
                      <span className="text-muted">{qtyText(entryQty, entry.product.unit, entry.product.carton_qty)}</span>
                      <span>{money(entryQty * n(entry.unit_price))}</span>
                    </div>
                  </Field>
                  <button type="button" className="btn btn-primary entry-add" disabled={!entryValid} onClick={addEntry}>
                    <Plus size={16} /> Add
                  </button>
                </div>
                {entryShort && (
                  <p className="entry-warn critical">
                    <AlertTriangle size={14} /> Only {qtyText(entryAvail, entry.product.unit, entry.product.carton_qty)} available in this store.
                  </p>
                )}
                {entryBelowMin && (
                  <p className="entry-warn">
                    <AlertTriangle size={14} /> Below minimum price {money(entry.product.min_price)}
                    {isAdmin ? ' (allowed for administrators).' : '. An administrator must make this sale.'}
                  </p>
                )}
              </div>
            )}

            {lines.length > 0 && (
              <div className="lines-wrap">
                <table className="table table-compact lines-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Store</th>
                      <th className="num">Ctn</th>
                      <th className="num">Loose</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={l.key} className={l.short || (l.belowMin && !isAdmin) ? 'row-error' : ''}>
                        <td className="text-muted line-index">{idx + 1}</td>
                        <td className="line-product">
                          <div className="cell-stack">
                            <span className="strong">{l.name}</span>
                            <span className="text-muted">
                              {qtyText(l.qty, l.unit, l.carton_qty)}
                              {l.short && <span className="text-critical"> · only {num(l.avail)} {l.unit} in store</span>}
                              {l.belowMin && <span className="text-warning"> · below min {money(l.min_price)}</span>}
                            </span>
                          </div>
                        </td>
                        <td className="line-store" data-label="Store">
                          <select className="input input-sm" value={l.location_id} onChange={(e) => updateItem(l.key, 'location_id', e.target.value)}>
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num" data-label="Cartons">
                          <input
                            className="input input-num input-sm"
                            inputMode="decimal"
                            disabled={l.carton_qty <= 1}
                            value={l.carton_qty <= 1 ? '' : l.cartons}
                            onChange={(e) => updateItem(l.key, 'cartons', e.target.value)}
                          />
                        </td>
                        <td className="num" data-label="Loose">
                          <input className="input input-num input-sm" inputMode="decimal" value={l.loose} onChange={(e) => updateItem(l.key, 'loose', e.target.value)} />
                        </td>
                        <td className="num" data-label="Rate">
                          <input className="input input-num input-sm" inputMode="decimal" value={l.unit_price} onChange={(e) => updateItem(l.key, 'unit_price', e.target.value)} />
                        </td>
                        <td className="num strong line-total" data-label="Amount">{money(l.amount)}</td>
                        <td className="row-actions">
                          <button className="icon-btn danger" onClick={() => removeItem(l.key)} aria-label="Remove">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="builder-aside">
          <div className="card summary">
            <div className="summary-block">
              <div className="summary-label">Customer</div>
              {customer ? (
                <>
                  <div className="strong">{customerLabel(customer)}</div>
                  <div className="sum-row">
                    <span>Previous balance</span>
                    <span>{money(prevBalance)}</span>
                  </div>
                </>
              ) : (
                <div className="text-muted">No customer selected</div>
              )}
            </div>

            <div className="summary-block">
              <div className="summary-label">
                {isSale ? 'Bill' : 'Return'} · {lines.length} item{lines.length === 1 ? '' : 's'}
              </div>
              <div className="sum-row">
                <span>Subtotal</span>
                <span>{money(totals.subtotal)}</span>
              </div>
              <div className="sum-row sum-input">
                <span>Discount</span>
                <input className={`input input-num input-sm ${discountValid ? '' : 'invalid'}`} inputMode="decimal" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div className="sum-row sum-input">
                <span>Freight</span>
                <input className="input input-num input-sm" inputMode="decimal" placeholder="0" value={freight} onChange={(e) => setFreight(e.target.value)} />
              </div>
              <div className="sum-row sum-total">
                <span>Net total</span>
                <span>{money(totals.total)}</span>
              </div>
              <div className="sum-row sum-input">
                <span>{isSale ? 'Received now' : 'Refunded now'}</span>
                <input
                  className="input input-num input-sm"
                  inputMode="decimal"
                  placeholder="0"
                  value={received}
                  onChange={(e) => {
                    setReceivedTouched(true)
                    setReceived(e.target.value)
                  }}
                />
              </div>
              {customer && (
                <div className={`sum-row sum-after ${overLimit ? 'text-critical' : ''}`}>
                  <span>Balance with this bill</span>
                  <span>{money(afterBill)}</span>
                </div>
              )}
              {overLimit && <p className="entry-warn critical">Over credit limit of {money(customer.credit_limit)}.</p>}
            </div>

            <div className="summary-block">
              <Field label="Remarks">
                <textarea className="input" rows={2} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <button className="btn btn-primary btn-block btn-lg summary-save" disabled={!canSave || saving} onClick={handleSave}>
                {saving ? 'Saving…' : isSale ? 'Save invoice' : 'Save return'}
              </button>
              {!customer && <p className="text-muted summary-hint">Choose a customer to save.</p>}
            </div>
          </div>
        </aside>
      </div>

      {addingCustomer && (
        <CustomerModal
          onClose={() => setAddingCustomer(false)}
          onSaved={(c) => {
            setCustomers((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
            setCustomer(c)
            setAddingCustomer(false)
          }}
        />
      )}
    </>
  )
}
