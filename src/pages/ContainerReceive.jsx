import { Fragment, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Split, Trash2 } from 'lucide-react'
import { getContainer, listLocations, listProducts, receiveContainer } from '../lib/api'
import { num, qtyText, toQty, today } from '../lib/format'
import { ErrorBanner, Field, Loading } from '../components/ui'

let nextKey = 1
const key = () => nextKey++

// Puts a container's goods into stores. Each packing list line starts as one row for the full
// quantity; split it to send part to another store, or lower it when less arrived.
export default function ContainerReceive() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [products, setProducts] = useState({})
  const [locations, setLocations] = useState([])
  const [rows, setRows] = useState({}) // { [item_id]: [{ key, location_id, cartons, loose }] }
  const [date, setDate] = useState(today())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([getContainer(id), listLocations(), listProducts()])
      .then(([c, locs, p]) => {
        const active = locs.filter((l) => l.active)
        setDoc(c)
        setLocations(active)
        setProducts(Object.fromEntries(p.map((x) => [x.id, x])))
        setRows(
          Object.fromEntries(
            c.items.map((it) => [
              it.id,
              [{ key: key(), location_id: active[0]?.id ?? '', cartons: String(Number(it.cartons) || ''), loose: Number(it.loose) ? String(it.loose) : '' }],
            ]),
          ),
        )
      })
      .catch((e) => setError(e.message))
  }, [id])

  if (!doc) return error ? <ErrorBanner message={error} /> : <Loading />
  if (doc.status === 'received') return <Navigate to={`/app/containers/${id}`} replace />

  const rowQty = (it, r) => toQty(r.cartons, r.loose, it.carton_qty)
  const itemTotal = (it) => (rows[it.id] ?? []).reduce((s, r) => s + rowQty(it, r), 0)

  const setRow = (itemId, k, field, value) =>
    setRows((prev) => ({ ...prev, [itemId]: prev[itemId].map((r) => (r.key === k ? { ...r, [field]: value } : r)) }))
  const split = (it) =>
    setRows((prev) => {
      const used = new Set(prev[it.id].map((r) => r.location_id))
      const other = locations.find((l) => !used.has(l.id)) ?? locations[0]
      return { ...prev, [it.id]: [...prev[it.id], { key: key(), location_id: other?.id ?? '', cartons: '', loose: '' }] }
    })
  const removeRow = (itemId, k) => setRows((prev) => ({ ...prev, [itemId]: prev[itemId].filter((r) => r.key !== k) }))
  const allTo = (locationId) =>
    setRows((prev) => Object.fromEntries(Object.entries(prev).map(([itemId, list]) => [itemId, list.map((r) => ({ ...r, location_id: locationId }))])))

  const over = doc.items.filter((it) => itemTotal(it) > Number(it.qty))
  const totalReceived = doc.items.reduce((s, it) => s + itemTotal(it), 0)
  const short = doc.items.filter((it) => itemTotal(it) < Number(it.qty))
  const missingStore = doc.items.some((it) => rows[it.id]?.some((r) => rowQty(it, r) > 0 && !r.location_id))
  const problem = over.length
    ? 'More than the packing list for some products.'
    : missingStore
      ? 'Choose a store for every line.'
      : totalReceived <= 0
        ? 'Enter the quantity received.'
        : ''

  async function handleReceive() {
    if (short.length && !window.confirm(`${short.length} product${short.length === 1 ? ' is' : 's are'} less than the packing list. Receive anyway?`)) return
    setBusy(true)
    setError('')
    try {
      const lines = doc.items.flatMap((it) =>
        rows[it.id]
          .filter((r) => rowQty(it, r) > 0)
          .map((r) => ({ item_id: it.id, location_id: r.location_id, cartons: Number(r.cartons) || 0, loose: Number(r.loose) || 0 })),
      )
      await receiveContainer(id, lines, date)
      navigate(`/app/containers/${id}`, { replace: true, state: { notice: 'Container received. The goods are now in stock.' } })
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Link to={`/app/containers/${id}`} className="back-link">
            <ArrowLeft size={16} /> {doc.container_no}
          </Link>
          <h1>Receive container</h1>
          <p className="text-secondary">Check what arrived and choose the store for each product. Stock is added when you confirm.</p>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card">
        <div className="form-grid form-grid-4">
          <Field label="Received on">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Put everything in">
            <select className="input" value="" onChange={(e) => e.target.value && allTo(e.target.value)}>
              <option value="">Choose to set all lines…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="card entry-lines">
        <div className="table-scroll">
          <table className="table table-compact lines-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Packing list</th>
                <th>Store</th>
                <th className="num">Cartons</th>
                <th className="num">Loose</th>
                <th className="num">Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it) => {
                const p = products[it.product_id]
                const unit = p?.unit ?? ''
                const total = itemTotal(it)
                const diff = total - Number(it.qty)
                return (
                  <Fragment key={it.id}>
                    {rows[it.id].map((r, i) => (
                      <tr key={r.key} className={diff > 0 ? 'row-error' : ''}>
                        {i === 0 && (
                          <>
                            <td className="line-product" rowSpan={rows[it.id].length}>
                              <div className="cell-stack">
                                <span className="strong">{p?.name ?? 'Unknown product'}</span>
                                <span className="text-muted">
                                  {p?.code} · {it.carton_qty > 1 ? `${it.carton_qty} ${unit}/ctn` : unit}
                                </span>
                                <button type="button" className="link-btn split-btn" onClick={() => split(it)}>
                                  <Split size={14} /> Split to another store
                                </button>
                              </div>
                            </td>
                            <td className="num text-secondary" rowSpan={rows[it.id].length} data-label="Packing list">
                              {qtyText(it.qty, unit, it.carton_qty)}
                            </td>
                          </>
                        )}
                        <td data-label="Store">
                          <select className="input input-sm" value={r.location_id} onChange={(e) => setRow(it.id, r.key, 'location_id', e.target.value)}>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num" data-label="Cartons">
                          <input
                            className="input input-num input-sm"
                            inputMode="decimal"
                            disabled={it.carton_qty <= 1}
                            value={it.carton_qty <= 1 ? '' : r.cartons}
                            placeholder={it.carton_qty <= 1 ? '—' : '0'}
                            onChange={(e) => setRow(it.id, r.key, 'cartons', e.target.value)}
                          />
                        </td>
                        <td className="num" data-label="Loose">
                          <input
                            className="input input-num input-sm"
                            inputMode="decimal"
                            value={r.loose}
                            placeholder="0"
                            onChange={(e) => setRow(it.id, r.key, 'loose', e.target.value)}
                          />
                        </td>
                        {i === 0 && (
                          <td className="num strong" rowSpan={rows[it.id].length} data-label="Received">
                            {qtyText(total, unit, it.carton_qty)}
                            {diff < 0 && <div className="text-warning">short {qtyText(-diff, unit, it.carton_qty)}</div>}
                            {diff > 0 && <div className="import-error">more than the list</div>}
                          </td>
                        )}
                        <td className="row-actions">
                          {rows[it.id].length > 1 && (
                            <button className="icon-btn danger" onClick={() => removeRow(it.id, r.key)} aria-label="Remove store line">
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="card-actions">
          <span className="text-secondary mr-auto">
            {problem ||
              `${num(doc.items.length)} product${doc.items.length === 1 ? '' : 's'}${short.length ? ` · ${short.length} short` : ' · all complete'}`}
          </span>
          <Link to={`/app/containers/${id}`} className="btn btn-secondary">
            Cancel
          </Link>
          <button className="btn btn-primary" disabled={Boolean(problem) || busy} onClick={handleReceive}>
            <PackageCheck size={16} /> {busy ? 'Receiving…' : 'Confirm & add to stock'}
          </button>
        </div>
      </div>
    </>
  )
}
