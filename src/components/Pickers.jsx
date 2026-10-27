import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { matchesWords } from '../lib/stock'
import { money, qtyText } from '../lib/format'
import { customerLabel } from '../lib/customerFields'

const MAX_RESULTS = 40

// Type-to-search list with keyboard support (↑ ↓ Enter Esc). `render(item)` draws one row.
// `browse`: also works as a dropdown — click or ↓ with nothing typed lists every item.
const SearchBox = forwardRef(function SearchBox({ items, filter, render, onPick, placeholder, autoFocus, emptyText, browse }, ref) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

  const results = useMemo(() => {
    if (!q.trim() && !browse) return []
    const limit = q.trim() ? MAX_RESULTS : Infinity
    const out = []
    for (const it of items) {
      if (filter(it, q)) out.push(it)
      if (out.length >= limit) break
    }
    return out
  }, [items, filter, q, browse])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(it) {
    onPick(it)
    setQ('')
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (results[active]) {
        e.preventDefault()
        pick(results[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="searchbox" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="input-icon">
        <Search size={16} />
        <input
          ref={inputRef}
          className="input"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => q && setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {q ? (
          <button type="button" className="input-suffix" onClick={() => setQ('')} aria-label="Clear">
            <X size={15} />
          </button>
        ) : (
          browse && (
            <button
              type="button"
              className="input-suffix"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen((o) => !o)
                inputRef.current?.focus()
              }}
              aria-label="Show all"
            >
              <ChevronDown size={16} />
            </button>
          )
        )}
      </div>
      {open && (q.trim() || browse) && (
        <ul className="searchbox-list" ref={listRef} role="listbox">
          {results.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
              >
                {render(it)}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="searchbox-empty">{emptyText}</li>}
        </ul>
      )}
    </div>
  )
})

const productFilter = (p, q) => p.active !== false && matchesWords(q, p.code, p.name, p.company, p.brand, p.category)

// `stock` = stockIndex() result, used to show stock next to each product
export const ProductSearch = forwardRef(function ProductSearch({ products, stock, onPick, autoFocus, placeholder }, ref) {
  return (
    <SearchBox
      ref={ref}
      items={products}
      filter={productFilter}
      onPick={onPick}
      autoFocus={autoFocus}
      placeholder={placeholder ?? 'Search product by name or code'}
      emptyText="No product matches"
      render={(p) => {
        const total = stock?.[p.id]?.total ?? 0
        return (
          <>
            <span className="sb-main">
              <span className="strong">{p.name}</span>
              <span className="text-muted">
                {p.code}
                {p.company && ` · ${p.company}`}
                {p.carton_qty > 1 && ` · ${p.carton_qty}/ctn`}
              </span>
            </span>
            <span className="sb-side">
              <span className="strong">{money(p.price)}</span>
              <span className={total > 0 ? 'text-muted' : 'text-critical'}>{qtyText(total, p.unit, p.carton_qty)}</span>
            </span>
          </>
        )
      }}
    />
  )
})

const customerFilter = (c, q) => c.active !== false && matchesWords(q, String(c.code), c.name, c.city, c.phone, c.contact_person)

// `balances` = { [customer_id]: balance }
export function CustomerSearch({ customers, balances, onPick, autoFocus }) {
  return (
    <SearchBox
      items={customers}
      filter={customerFilter}
      onPick={onPick}
      autoFocus={autoFocus}
      browse
      placeholder="Select customer"
      emptyText="No customer matches"
      render={(c) => (
        <>
          <span className="sb-main">
            <span className="strong">{customerLabel(c)}</span>
            <span className="text-muted">
              #{c.code}
              {c.phone && ` · ${c.phone}`}
            </span>
          </span>
          {balances && <span className="sb-side strong">{money(balances[c.id] ?? 0)}</span>}
        </>
      )}
    />
  )
}

// From / To date filter used on list pages
export function DateRange({ from, to, onChange }) {
  return (
    <div className="date-range">
      <input type="date" className="input" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} aria-label="From date" />
      <span className="text-muted">to</span>
      <input type="date" className="input" value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} aria-label="To date" />
    </div>
  )
}
