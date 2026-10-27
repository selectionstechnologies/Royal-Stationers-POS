import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  Boxes,
  Factory,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldCheck,
  Ship,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { ROLE_LABELS, initials } from '../lib/format'
import { Logo } from './Logo'

const NAV = [
  { section: 'Overview', links: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    section: 'Sales',
    links: [
      { to: '/app/invoices', label: 'Sale invoices', icon: ReceiptText, permission: 'sales' },
      { to: '/app/receipts', label: 'Receipts', icon: HandCoins, permission: 'sales' },
      { to: '/app/customers', label: 'Customers', icon: Users, permission: 'sales' },
    ],
  },
  {
    section: 'Stock',
    links: [
      { to: '/app/products', label: 'Products', icon: Package },
      { to: '/app/stock', label: 'Stock', icon: Boxes, end: true },
      { to: '/app/stock/entries', label: 'Stock entries', icon: ArrowLeftRight, permission: 'stock.manage' },
    ],
  },
  {
    section: 'Purchase',
    links: [
      { to: '/app/containers', label: 'Containers', icon: Ship, permission: 'containers.view' },
      { to: '/app/suppliers', label: 'Suppliers', icon: Factory, permission: 'containers.manage' },
    ],
  },
  {
    section: 'Administration',
    links: [
      { to: '/app/users', label: 'Users', icon: ShieldCheck, permission: 'users' },
      { to: '/app/settings', label: 'Settings', icon: SettingsIcon, permission: 'settings' },
    ],
  },
]

export default function Layout() {
  const { user, can, signOut } = useAuth()
  const nav = NAV.map((g) => ({ ...g, links: g.links.filter((l) => !l.permission || can(l.permission)) })).filter((g) => g.links.length)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer after navigating
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="shell">
      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Logo light size={38} />
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map((group) => (
            <div key={group.section} className="nav-group">
              <div className="nav-section">{group.section}</div>
              {group.links.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="nav-link">
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{initials(user?.name || user?.email)}</div>
          <div className="user-meta">
            <div className="user-email" title={user?.email}>
              {user?.name || user?.email}
            </div>
            <div className="user-role">{ROLE_LABELS[user?.role] ?? user?.role}</div>
          </div>
          <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {open && <div className="scrim no-print" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-date">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <span className={`role-pill role-${user?.role}`}>{ROLE_LABELS[user?.role]}</span>
          <div className="avatar avatar-sm" title={user?.email}>{initials(user?.name || user?.email)}</div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
