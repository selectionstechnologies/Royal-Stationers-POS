import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Pencil, Plus, Power, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { createUser, deleteUser, listUsers, setUserPassword, updateUser } from '../lib/api'
import { ROLE_LABELS, formatDate, initials } from '../lib/format'
import { useAuth } from '../auth/AuthProvider'
import { ErrorBanner, Field, Loading, Modal, PageHeader, StatusBadge } from '../components/ui'

const ROLE_OPTIONS = [
  { value: 'cashier', label: 'Cashier', text: 'Dashboard, quotations, invoices. Can add customers. Cannot edit or delete.' },
  { value: 'admin', label: 'Administrator', text: 'Full access: catalog, customers, users, settings, payments.' },
]

export default function Users() {
  const { user: me } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // { kind: 'create' | 'edit' | 'password', user? }
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    listUsers().then(setRows).catch((e) => setError(e.message))
  }, [])

  const replace = (u) => setRows((prev) => (prev.some((r) => r.id === u.id) ? prev.map((r) => (r.id === u.id ? u : r)) : [...prev, u]))

  async function act(id, fn) {
    setBusyId(id)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    }
    setBusyId(null)
  }

  const toggleActive = (u) =>
    act(u.id, async () => {
      if (u.active && !window.confirm(`Deactivate ${u.name}? They will not be able to sign in.`)) return
      replace(await updateUser(u.id, { active: !u.active }))
    })

  const remove = (u) =>
    act(u.id, async () => {
      if (!window.confirm(`Delete ${u.name} permanently? Their invoices are kept.`)) return
      await deleteUser(u.id)
      setRows((prev) => prev.filter((r) => r.id !== u.id))
    })

  const counts = rows
    ? { total: rows.length, active: rows.filter((u) => u.active).length, admins: rows.filter((u) => u.role === 'admin').length }
    : null

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={counts ? `${counts.total} users · ${counts.active} active · ${counts.admins} admin${counts.admins === 1 ? '' : 's'}` : 'Staff accounts and access.'}
        actions={
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'create' })}>
            <Plus size={16} /> Add user
          </button>
        }
      />

      <ErrorBanner message={error} />

      <div className="card card-flush">
        {!rows && !error && <Loading />}
        {rows && (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Added</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const isMe = u.id === me?.id
                const busy = busyId === u.id
                return (
                  <tr key={u.id} className={u.active ? '' : 'row-dim'}>
                    <td>
                      <div className="cell-with-icon">
                        <span className="avatar avatar-sm avatar-soft">{initials(u.name)}</span>
                        <div className="cell-stack">
                          <span className="strong">
                            {u.name} {isMe && <span className="you">You</span>}
                          </span>
                          <span className="text-muted">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`role-pill role-${u.role}`}>
                        {u.role === 'admin' ? <ShieldCheck size={13} /> : <UserRound size={13} />}
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={u.active ? 'active' : 'inactive'} />
                    </td>
                    <td className="text-secondary">{formatDate(u.created_at?.slice(0, 10))}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Edit" disabled={busy} onClick={() => setModal({ kind: 'edit', user: u })}>
                          <Pencil size={16} />
                        </button>
                        <button className="icon-btn" title="Change password" disabled={busy} onClick={() => setModal({ kind: 'password', user: u })}>
                          <KeyRound size={16} />
                        </button>
                        <button
                          className={`icon-btn ${u.active ? 'warn' : 'ok'}`}
                          title={isMe ? 'You cannot deactivate yourself' : u.active ? 'Deactivate' : 'Activate'}
                          disabled={busy || isMe}
                          onClick={() => toggleActive(u)}
                        >
                          <Power size={16} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title={isMe ? 'You cannot delete yourself' : 'Delete'}
                          disabled={busy || isMe}
                          onClick={() => remove(u)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal?.kind === 'create' && (
        <UserModal
          onClose={() => setModal(null)}
          onSaved={(u) => {
            replace(u)
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'edit' && (
        <UserModal
          user={modal.user}
          isMe={modal.user.id === me?.id}
          onClose={() => setModal(null)}
          onSaved={(u) => {
            replace(u)
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'password' && <PasswordModal user={modal.user} onClose={() => setModal(null)} />}
    </>
  )
}

function PasswordInput({ value, onChange, autoFocus, placeholder = 'At least 8 characters' }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-icon">
      <KeyRound size={16} />
      <input
        className="input"
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="input-suffix" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

function passwordProblem(pw, confirm) {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (pw !== confirm) return 'Passwords do not match.'
  return ''
}

function UserModal({ user, isMe, onClose, onSaved }) {
  const isEdit = Boolean(user)
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: user?.role ?? 'cashier' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Name is required.')
    if (!isEdit) {
      if (!form.email.trim()) return setError('Email is required.')
      const problem = passwordProblem(password, confirm)
      if (problem) return setError(problem)
    }
    setBusy(true)
    setError('')
    try {
      onSaved(isEdit ? await updateUser(user.id, { name: form.name, role: form.role }) : await createUser({ ...form, password }))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `Edit ${user.name}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <form id="user-form" className="form-grid" onSubmit={handleSubmit} noValidate>
        <div className="span-2">
          <Field label="Full name">
            <input className="input" autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Ali Hassan" />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Email (used to sign in)">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={set('email')}
              disabled={isEdit}
              placeholder="name@company.com"
            />
          </Field>
        </div>

        <div className="span-2">
          <span className="field-label">Role</span>
          <div className="role-options">
            {ROLE_OPTIONS.map((r) => (
              <label key={r.value} className={`role-option ${form.role === r.value ? 'selected' : ''} ${isMe ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={form.role === r.value}
                  disabled={isMe}
                  onChange={set('role')}
                />
                <span className="strong">{r.label}</span>
                <span className="text-muted">{r.text}</span>
              </label>
            ))}
          </div>
          {isMe && <span className="field-note">You cannot change your own role.</span>}
        </div>

        {!isEdit && (
          <>
            <Field label="Password">
              <PasswordInput value={password} onChange={setPassword} />
            </Field>
            <Field label="Confirm password">
              <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat password" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  )
}

function PasswordModal({ user, onClose }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      await setUserPassword(user.id, password)
      setDone(true)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <Modal
      title="Change password"
      onClose={onClose}
      footer={
        done ? (
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="password-form" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="success-box">
          Password updated for <strong>{user.name}</strong>. Share the new password with them securely.
        </div>
      ) : (
        <>
          <p className="text-secondary modal-intro">
            Set a new password for <strong>{user.name}</strong> ({user.email}).
          </p>
          <ErrorBanner message={error} />
          <form id="password-form" className="form-grid" onSubmit={handleSubmit} noValidate>
            <Field label="New password">
              <PasswordInput value={password} onChange={setPassword} autoFocus />
            </Field>
            <Field label="Confirm password">
              <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat password" />
            </Field>
          </form>
        </>
      )}
    </Modal>
  )
}
