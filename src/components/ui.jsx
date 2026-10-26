import { useEffect } from 'react'
import { AlertCircle, Ban, Banknote, CheckCircle2, Clock, ReceiptText, RotateCcw, X } from 'lucide-react'

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

const STATUS = {
  active: { label: 'Active', cls: 'good', icon: CheckCircle2 },
  inactive: { label: 'Inactive', cls: 'neutral', icon: Ban },
}

// Status always carries an icon + label, never color alone
export function StatusBadge({ status }) {
  const s = STATUS[status] ?? { label: status, cls: 'neutral', icon: Clock }
  const Icon = s.icon
  return (
    <span className={`status status-${s.cls}`}>
      <Icon size={13} strokeWidth={2.2} />
      {s.label}
    </span>
  )
}

// Sale / return and cash / credit, always icon + label
export function TxnBadge({ type, mode }) {
  if (type === 'return') {
    return (
      <span className="status status-warning">
        <RotateCcw size={13} strokeWidth={2.2} />
        Return
      </span>
    )
  }
  const cash = mode === 'cash'
  const Icon = cash ? Banknote : ReceiptText
  return (
    <span className={`status ${cash ? 'status-good' : 'status-info'}`}>
      <Icon size={13} strokeWidth={2.2} />
      {cash ? 'Cash sale' : 'Credit sale'}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="empty-icon">
          <Icon size={22} strokeWidth={1.8} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {text && <p className="text-secondary">{text}</p>}
      {action}
    </div>
  )
}

export function ErrorBanner({ message }) {
  if (!message) return null
  return (
    <div className="alert">
      <AlertCircle size={16} />
      <span>{message}</span>
    </div>
  )
}

export function Loading() {
  return (
    <div className="loading">
      <div className="spinner" />
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
