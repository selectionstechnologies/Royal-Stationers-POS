import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileSpreadsheet, PackageCheck, Plus, Trash2, Undo2 } from 'lucide-react'
import { deleteContainer, getContainer, getDefaultCompany, listProducts, listSuppliers, reopenContainer, saveContainer } from '../lib/api'
import { COST_BASIS_LABELS, CONTAINER_STATUSES, CURRENCIES, formatDate, money, num, qtyText, today } from '../lib/format'
import { landedCosts, lineQty, packingTotals, suggestedPrice } from '../lib/containers'
import { useAuth } from '../auth/AuthProvider'
import { ErrorBanner, Field, Loading } from '../components/ui'
import { ProductSearch } from '../components/Pickers'
import PackingListImport from '../components/PackingListImport'
import { ContainerStatus } from './Containers'

const EMPTY = {
  container_no: '', supplier_id: '', invoice_ref: '', order_date: today(), status: 'ordered',
  shipped_date: '', port_date: '', clearing_date: '', eta: '', shipping_line: '', bl_no: '',
  currency: 'USD', exchange_rate: '', cost_basis: 'cbm', notes: '',
}
const COMMON_EXPENSES = ['Freight', 'Duty & taxes', 'Clearing agent', 'Transport', 'Labour']
const EDITABLE_STATUSES = CONTAINER_STATUSES.filter((s) => s.value !== 'received')

let nextKey = 1
const key = () => nextKey++
const str = (v) => (v === null || v === undefined ? '' : String(v))
const fmt4 = (n) => num(Math.round(Number(n) * 10000) / 10000)

export default function ContainerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = useAuth()
  const showCosts = can('costs')
  const canManage = can('containers.manage')

  const [products, setProducts] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [margin, setMargin] = useState(0)
  const [doc, setDoc] = useState(null) // saved container, null when new
  const [form, setForm] = useState(EMPTY)
  const [lines, setLines] = useState([]) // { key, product, cartons, carton_qty, loose, cbm, weight, unit_price, received_qty, price }
  const [expenses, setExpenses] = useState([]) // { key, name, amount }
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(location.state?.notice ?? '')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [version, setVersion] = useState(0)
  const searchRef = useRef(null)
  const cartonRefs = useRef({})

  useEffect(() => {
    setError('')
    Promise.all([
      listProducts(),
      canManage ? listSuppliers() : [],
      getDefaultCompany(),
      id ? getContainer(id, { withCosts: showCosts }) : null,
    ])
      .then(([p, s, company, c]) => {
        const byId = Object.fromEntries(p.map((x) => [x.id, x]))
        setProducts(p)
        setSuppliers(s.filter((x) => x.active || x.id === c?.supplier_id))
        setMargin(Number(company?.default_margin) || 0)
        setDoc(c)
        if (c) {
          setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, str(c[k])])))
          setLines(
            c.items.map((it) => ({
              key: key(),
              product: byId[it.product_id],
              cartons: str(it.cartons),
              carton_qty: str(it.carton_qty),
              loose: Number(it.loose) ? str(it.loose) : '',
              cbm: Number(it.cbm) ? str(it.cbm) : '',
              weight: Number(it.weight) ? str(it.weight) : '',
              unit_price: it.price ? str(it.price.unit_price) : '',
              received_qty: it.received_qty,
              price: it.price,
            })),
          )
          setExpenses(c.expenses.map((e) => ({ key: key(), name: e.name, amount: str(e.amount) })))
        }
        setDirty(false)
      })
      .catch((e) => setError(e.message))
  }, [id, version, canManage, showCosts])

  const received = doc?.status === 'received'
  const editable = canManage && !received
  const totals = useMemo(() => packingTotals(lines), [lines])
  const costs = useMemo(
    () => (showCosts ? landedCosts(lines, { exchangeRate: form.exchange_rate, costBasis: form.cost_basis, expenses }) : []),
    [showCosts, lines, form.exchange_rate, form.cost_basis, expenses],
  )
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  if (!products) return error ? <ErrorBanner message={error} /> : <Loading />

  const change = (fn) => {
    setDirty(true)
    setNotice('')
    fn()
  }
  const set = (k) => (e) => change(() => setForm((f) => ({ ...f, [k]: e.target.value })))

  function setStatus(value) {
    change(() =>
      setForm((f) => {
        const dateKey = CONTAINER_STATUSES.find((s) => s.value === value).date
        return { ...f, status: value, [dateKey]: f[dateKey] || today() }
      }),
    )
  }

  function chooseSupplier(e) {
    const s = suppliers.find((x) => x.id === e.target.value)
    change(() => setForm((f) => ({ ...f, supplier_id: e.target.value, currency: s?.currency ?? f.currency })))
  }

  function addProduct(p) {
    const existing = lines.find((l) => l.product.id === p.id)
    if (existing) {
      cartonRefs.current[existing.key]?.focus()
      return
    }
    const line = { key: key(), product: p, cartons: '', carton_qty: str(p.carton_qty), loose: '', cbm: Number(p.cbm) ? str(p.cbm) : '', weight: '', unit_price: '' }
    change(() => setLines((prev) => [...prev, line]))
    setTimeout(() => cartonRefs.current[line.key]?.focus(), 0)
  }

  // Imported rows replace lines for the same product
  function importRows(rows) {
    change(() =>
      setLines((prev) => {
        const next = [...prev]
        for (const r of rows) {
          const line = { key: key(), product: r.product, cartons: r.cartons, carton_qty: r.carton_qty, loose: r.loose, cbm: r.cbm, weight: r.weight, unit_price: r.unit_price }
          const i = next.findIndex((l) => l.product.id === r.product.id)
          if (i >= 0) next[i] = line
          else next.push(line)
        }
        return next
      }),
    )
    setImporting(false)
  }

  const updateLine = (k, field, value) => change(() => setLines((prev) => prev.map((l) => (l.key === k ? { ...l, [field]: value } : l))))
  const removeLine = (k) => change(() => setLines((prev) => prev.filter((l) => l.key !== k)))
  const updateExpense = (k, field, value) => change(() => setExpenses((prev) => prev.map((e) => (e.key === k ? { ...e, [field]: value } : e))))
  const addExpense = (name = '') => change(() => setExpenses((prev) => [...prev, { key: key(), name, amount: '' }]))
  const removeExpense = (k) => change(() => setExpenses((prev) => prev.filter((e) => e.key !== k)))

  const problem = !form.container_no.trim()
    ? 'Enter the container number.'
    : !(Number(form.exchange_rate) > 0)
      ? 'Enter the exchange rate (Rs for 1 ' + form.currency + ').'
      : lines.some((l) => lineQty(l) <= 0)
        ? 'Every line needs a quantity.'
        : expenses.some((e) => !e.name.trim())
          ? 'Every expense needs a name.'
          : ''

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const handleSave = () =>
    run(async () => {
      const savedId = await saveContainer({
        ...(id ? { id } : {}),
        ...form,
        items: lines.map((l) => ({
          product_id: l.product.id,
          cartons: l.cartons,
          carton_qty: l.carton_qty,
          loose: l.loose,
          cbm: l.cbm,
          weight: l.weight,
          unit_price: l.unit_price,
        })),
        expenses: expenses.map((e) => ({ name: e.name, amount: e.amount })),
      })
      if (!id) {
        navigate(`/app/containers/${savedId}`, { replace: true, state: { notice: 'Container saved.' } })
        return
      }
      setNotice('Container saved.')
      setVersion((v) => v + 1)
    })

  const handleReopen = () => {
    if (!window.confirm('Reopen this container? The stock it added will be removed from the stores and product costs restored.')) return
    run(async () => {
      await reopenContainer(id)
      setNotice('Container reopened. Its stock was removed.')
      setVersion((v) => v + 1)
    })
  }

  const handleDelete = () => {
    if (!window.confirm(`Delete container ${doc.container_no}? This cannot be undone.`)) return
    run(async () => {
      await deleteContainer(id)
      navigate('/app/containers', { replace: true, state: { notice: `Container ${doc.container_no} deleted.` } })
    })
  }

  const supplierName = doc?.supplier?.name ?? suppliers.find((s) => s.id === form.supplier_id)?.name

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/app/containers" className="back-link">
            <ArrowLeft size={16} /> Containers
          </Link>
          <h1 className="container-title">
            {doc ? <span className="mono">{doc.container_no}</span> : 'New container'}
            {doc && <ContainerStatus status={doc.status} />}
          </h1>
          {doc && (
            <p className="text-secondary">
              {supplierName ?? 'No supplier'} · Ordered {formatDate(doc.order_date)}
              {received && ` · Received ${formatDate(doc.received_date)}`}
            </p>
          )}
        </div>
        <div className="page-actions">
          {doc && received && can('delete') && (
            <button className="btn btn-secondary" onClick={handleReopen} disabled={busy}>
              <Undo2 size={16} /> Reopen
            </button>
          )}
          {doc && !received && can('delete') && (
            <button className="btn btn-danger-ghost" onClick={handleDelete} disabled={busy}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          {doc && !received && can('containers.receive') && (
            <Link
              to={`/app/containers/${id}/receive`}
              className={`btn btn-primary ${dirty || lines.length === 0 ? 'disabled' : ''}`}
              onClick={(e) => (dirty || lines.length === 0) && e.preventDefault()}
              title={dirty ? 'Save your changes first' : undefined}
            >
              <PackageCheck size={16} /> Receive container
            </Link>
          )}
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}
      <ErrorBanner message={error} />
      {received && canManage && (
        <p className="text-secondary form-help">This container is received and locked. {can('delete') ? 'Reopen it to make changes.' : 'An administrator can reopen it.'}</p>
      )}

      <div className="stack">
        {/* ---------- Details ---------- */}
        <div className="card">
          <div className="card-head card-head-tight">
            <div>
              <h3>Details</h3>
              <p className="text-secondary">Container, supplier and currency.</p>
            </div>
          </div>
          <fieldset className="plain-fieldset" disabled={!editable}>
            <div className="form-grid form-grid-4">
              <Field label="Container no.">
                <input className="input mono" value={form.container_no} onChange={set('container_no')} placeholder="e.g. MSKU0221809" autoFocus={!id} />
              </Field>
              <Field label="Supplier">
                {editable ? (
                  <select className="input" value={form.supplier_id} onChange={chooseSupplier}>
                    <option value="">No supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" value={supplierName ?? '—'} readOnly />
                )}
              </Field>
              <Field label="Supplier invoice / PI no.">
                <input className="input" value={form.invoice_ref} onChange={set('invoice_ref')} />
              </Field>
              <Field label="Order date">
                <input type="date" className="input" value={form.order_date} onChange={set('order_date')} />
              </Field>
              <Field label="Currency">
                <select className="input" value={form.currency} onChange={set('currency')}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label={`Exchange rate (Rs for 1 ${form.currency})`}>
                <input className="input input-num" inputMode="decimal" value={form.exchange_rate} onChange={set('exchange_rate')} placeholder={form.currency === 'PKR' ? '1' : 'e.g. 280'} />
              </Field>
              <div className="span-2">
                <Field label="Notes">
                  <input className="input" value={form.notes} onChange={set('notes')} placeholder="Optional" />
                </Field>
              </div>
            </div>
          </fieldset>
        </div>

        {/* ---------- Status ---------- */}
        <div className="card">
          <div className="card-head card-head-tight">
            <div>
              <h3>Status</h3>
              <p className="text-secondary">Shipped, at port and clearing show as "On the way" on stock screens.</p>
            </div>
          </div>
          {received ? (
            <ol className="status-steps">
              {CONTAINER_STATUSES.map((s) => (
                <li key={s.value} className="done">
                  <span className="strong">{s.label}</span>
                  <span className="text-muted">{formatDate(doc[s.date]) || '—'}</span>
                </li>
              ))}
            </ol>
          ) : (
            <>
              <div className="segmented segmented-wide">
                {EDITABLE_STATUSES.map((s) => (
                  <button key={s.value} className={form.status === s.value ? 'active' : ''} onClick={() => setStatus(s.value)} disabled={!editable}>
                    {s.label}
                  </button>
                ))}
              </div>
              <fieldset className="plain-fieldset" disabled={!editable}>
                <div className="form-grid form-grid-4 status-dates">
                  <Field label="Shipped on">
                    <input type="date" className="input" value={form.shipped_date} onChange={set('shipped_date')} />
                  </Field>
                  <Field label="Reached port on">
                    <input type="date" className="input" value={form.port_date} onChange={set('port_date')} />
                  </Field>
                  <Field label="Clearing from">
                    <input type="date" className="input" value={form.clearing_date} onChange={set('clearing_date')} />
                  </Field>
                  <Field label="Expected arrival (ETA)">
                    <input type="date" className="input" value={form.eta} onChange={set('eta')} />
                  </Field>
                  <Field label="Shipping line">
                    <input className="input" value={form.shipping_line} onChange={set('shipping_line')} placeholder="e.g. Maersk" />
                  </Field>
                  <Field label="B/L no.">
                    <input className="input mono" value={form.bl_no} onChange={set('bl_no')} />
                  </Field>
                </div>
              </fieldset>
            </>
          )}
        </div>

        {/* ---------- Packing list ---------- */}
        <div className="card entry-lines">
          <div className="card-head card-head-tight">
            <div>
              <h3>Packing list</h3>
              <p className="text-secondary">
                {editable ? 'Search a product, press Enter, then cartons. Or import the supplier’s list.' : 'What is in this container.'}
                {showCosts && ` Prices are per piece in ${form.currency}.`}
              </p>
            </div>
            {editable && (
              <button className="btn btn-secondary btn-sm" onClick={() => setImporting(true)}>
                <FileSpreadsheet size={16} /> Import CSV
              </button>
            )}
          </div>
          {editable && <ProductSearch ref={searchRef} products={products} onPick={addProduct} placeholder="Add a product by name or code" />}

          {lines.length > 0 && (
            <div className="table-scroll">
              <table className="table table-compact lines-table packing-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Cartons</th>
                    <th className="num">Qty/ctn</th>
                    <th className="num">Loose</th>
                    <th className="num">Total</th>
                    <th className="num">CBM/ctn</th>
                    <th className="num">Kg/ctn</th>
                    {showCosts && <th className="num">Price</th>}
                    {showCosts && <th className="num">Amount</th>}
                    {received && <th className="num">Received</th>}
                    {editable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const p = l.product
                    const qty = lineQty(l)
                    const input = (field, extra = {}) =>
                      editable ? (
                        <input
                          className="input input-num input-sm"
                          inputMode="decimal"
                          value={l[field]}
                          placeholder="0"
                          onChange={(e) => updateLine(l.key, field, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && searchRef.current?.focus()}
                          {...extra}
                        />
                      ) : (
                        num(l[field])
                      )
                    const short = received && Number(l.received_qty) < qty
                    return (
                      <tr key={l.key} className={short ? 'row-warn' : ''}>
                        <td className="line-product">
                          <div className="cell-stack">
                            <Link to={`/app/products/${p.id}/ledger`} className="strong link">
                              {p.name}
                            </Link>
                            <span className="text-muted">
                              {p.code} · {p.unit}
                            </span>
                          </div>
                        </td>
                        <td className="num" data-label="Cartons">
                          {input('cartons', { ref: (el) => (cartonRefs.current[l.key] = el) })}
                        </td>
                        <td className="num" data-label="Qty/ctn">
                          {input('carton_qty')}
                        </td>
                        <td className="num" data-label="Loose">
                          {input('loose')}
                        </td>
                        <td className="num strong" data-label="Total">
                          {qtyText(qty, p.unit, l.carton_qty)}
                        </td>
                        <td className="num" data-label="CBM/ctn">
                          {input('cbm')}
                        </td>
                        <td className="num" data-label="Kg/ctn">
                          {input('weight')}
                        </td>
                        {showCosts && (
                          <td className="num" data-label="Price">
                            {input('unit_price')}
                          </td>
                        )}
                        {showCosts && (
                          <td className="num text-secondary" data-label="Amount">
                            {num(qty * (Number(l.unit_price) || 0))}
                          </td>
                        )}
                        {received && (
                          <td className={`num strong ${short ? 'text-warning' : ''}`} data-label="Received">
                            {qtyText(l.received_qty, p.unit, l.carton_qty)}
                            {short && <div className="text-muted">short {qtyText(qty - Number(l.received_qty), p.unit, l.carton_qty)}</div>}
                          </td>
                        )}
                        {editable && (
                          <td className="row-actions">
                            <button className="icon-btn danger" onClick={() => removeLine(l.key)} aria-label="Remove">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="strong">
                      {lines.length} item{lines.length === 1 ? '' : 's'}
                    </td>
                    <td className="num strong">{num(totals.cartons)}</td>
                    <td colSpan={2} />
                    <td className="num strong">{num(totals.qty)}</td>
                    <td className="num strong">{num(totals.cbm)} m³</td>
                    <td className="num strong">{num(totals.weight)} kg</td>
                    {showCosts && <td />}
                    {showCosts && (
                      <td className="num strong">
                        {form.currency} {num(totals.value)}
                      </td>
                    )}
                    {received && <td />}
                    {editable && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {lines.length === 0 && <p className="text-muted rank-empty">{editable ? 'No products yet.' : 'This container has no products.'}</p>}
        </div>

        {/* ---------- Expenses + landed cost (costs permission) ---------- */}
        {showCosts && (
          <div className="container-costs">
            <div className="card">
              <div className="card-head card-head-tight">
                <div>
                  <h3>Expenses</h3>
                  <p className="text-secondary">Everything paid to bring the goods to the store, in Rs.</p>
                </div>
              </div>
              <fieldset className="plain-fieldset" disabled={!editable}>
                <Field label="Share expenses">
                  <select className="input" value={form.cost_basis} onChange={set('cost_basis')}>
                    {Object.entries(COST_BASIS_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <ul className="expense-list">
                  {expenses.map((e) => (
                    <li key={e.key}>
                      <input className="input" value={e.name} placeholder="Expense" onChange={(ev) => updateExpense(e.key, 'name', ev.target.value)} />
                      <input
                        className="input input-num"
                        inputMode="decimal"
                        value={e.amount}
                        placeholder="0"
                        onChange={(ev) => updateExpense(e.key, 'amount', ev.target.value)}
                      />
                      {editable && (
                        <button type="button" className="icon-btn danger" onClick={() => removeExpense(e.key)} aria-label="Remove expense">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </fieldset>
              {editable && (
                <div className="chips expense-chips">
                  {COMMON_EXPENSES.filter((name) => !expenses.some((e) => e.name === name)).map((name) => (
                    <button key={name} type="button" className="chip" onClick={() => addExpense(name)}>
                      <Plus size={13} /> {name}
                    </button>
                  ))}
                  <button type="button" className="chip" onClick={() => addExpense()}>
                    <Plus size={13} /> Other
                  </button>
                </div>
              )}
              <div className="cost-total">
                <span className="text-secondary">Total expenses</span>
                <span className="strong">{money(expenseTotal)}</span>
              </div>
            </div>

            <div className="card card-flush">
              <div className="card-head">
                <div>
                  <h3>Landed cost</h3>
                  <p className="text-secondary">
                    Goods × {num(form.exchange_rate || 0)} + share of expenses, per piece. Suggested price adds {num(margin)}% (Settings).
                  </p>
                </div>
              </div>
              {lines.length === 0 ? (
                <p className="text-muted rank-empty">Add products to see their landed cost.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Goods (Rs)</th>
                        <th className="num">Expenses (Rs)</th>
                        <th className="num">Landed / pc</th>
                        <th className="num">Sale price</th>
                        <th className="num">Suggested</th>
                        {received && <th className="num">New avg. cost</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const c = costs[i]
                        const low = c.landed > 0 && Number(l.product.price) < c.landed
                        return (
                          <tr key={l.key}>
                            <td className="strong">{l.product.name}</td>
                            <td className="num">{num(c.goods)}</td>
                            <td className="num">{num(c.share)}</td>
                            <td className="num strong">{fmt4(c.landed)}</td>
                            <td className={`num ${low ? 'text-critical strong' : ''}`} title={low ? 'Sale price is below the landed cost' : undefined}>
                              {money(l.product.price)}
                            </td>
                            <td className="num">{money(suggestedPrice(c.landed, margin))}</td>
                            {received && <td className="num">{l.price?.new_cost != null ? fmt4(l.price.new_cost) : '—'}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="strong">Total</td>
                        <td className="num strong">{num(costs.reduce((s, c) => s + c.goods, 0))}</td>
                        <td className="num strong">{num(costs.reduce((s, c) => s + c.share, 0))}</td>
                        <td colSpan={received ? 4 : 3} className="num strong">
                          {money(costs.reduce((s, c) => s + c.goods + c.share, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {editable && (
          <div className="card form-footer">
            <span className="text-secondary mr-auto">{problem || (dirty ? 'Unsaved changes' : doc ? 'All changes saved' : '')}</span>
            <Link to="/app/containers" className="btn btn-secondary">
              Cancel
            </Link>
            <button className="btn btn-primary" disabled={Boolean(problem) || busy || (doc && !dirty)} onClick={handleSave}>
              {busy ? 'Saving…' : 'Save container'}
            </button>
          </div>
        )}

      </div>

      {importing && <PackingListImport products={products} onProducts={setProducts} onImport={importRows} onClose={() => setImporting(false)} />}
    </>
  )
}
