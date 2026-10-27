import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { AuthProvider, RequireAuth } from './auth/AuthProvider'
import SiteLayout from './site/SiteLayout'
import Home from './site/Home'
import SiteProducts from './site/SiteProducts'
import Wholesale from './site/Wholesale'
import About from './site/About'
import Contact from './site/Contact'
import NotFound from './site/NotFound'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import InvoiceList from './pages/InvoiceList'
import InvoiceForm from './pages/InvoiceForm'
import InvoiceDetail from './pages/InvoiceDetail'
import Receipts from './pages/Receipts'
import Customers from './pages/Customers'
import CustomerLedger from './pages/CustomerLedger'
import Products from './pages/Products'
import ProductLedger from './pages/ProductLedger'
import Stock from './pages/Stock'
import StockEntries from './pages/StockEntries'
import StockEntryForm from './pages/StockEntryForm'
import Users from './pages/Users'
import Suppliers from './pages/Suppliers'
import Containers from './pages/Containers'
import ContainerForm from './pages/ContainerForm'
import ContainerReceive from './pages/ContainerReceive'
import Settings from './pages/Settings'

const only = (permission, el) => <RequireAuth permission={permission}>{el}</RequireAuth>

function ConfigMissing() {
  return (
    <div className="screen-center">
      <div className="card config-card">
        <h2>Supabase not configured</h2>
        <p className="text-secondary">
          Copy <code>.env.example</code> to <code>.env</code>, fill in your Supabase URL and publishable key, run <code>supabase/setup.sql</code> in the SQL Editor, then restart{' '}
          <code>npm run dev</code>.
        </p>
      </div>
    </div>
  )
}

// Login and the software need Supabase; the public website does not
function AuthShell() {
  if (!isConfigured) return <ConfigMissing />
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public website */}
      <Route element={<SiteLayout />}>
        <Route index element={<Home />} />
        <Route path="products" element={<SiteProducts />} />
        <Route path="wholesale" element={<Wholesale />} />
        <Route path="about" element={<About />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Staff software */}
      <Route element={<AuthShell />}>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="invoices" element={only('sales', <InvoiceList />)} />
          <Route path="invoices/new" element={only('sales', <InvoiceForm />)} />
          <Route path="invoices/:id" element={only('sales', <InvoiceDetail />)} />
          <Route path="receipts" element={only('sales', <Receipts />)} />
          <Route path="customers" element={only('sales', <Customers />)} />
          <Route path="customers/:id" element={only('sales', <CustomerLedger />)} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id/ledger" element={<ProductLedger />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/entries" element={only('stock.manage', <StockEntries />)} />
          <Route path="stock/new" element={only('stock.manage', <StockEntryForm />)} />
          <Route path="containers" element={only('containers.view', <Containers />)} />
          <Route path="containers/new" element={only('containers.manage', <ContainerForm />)} />
          <Route path="containers/:id" element={only('containers.view', <ContainerForm />)} />
          <Route path="containers/:id/receive" element={only('containers.receive', <ContainerReceive />)} />
          <Route path="suppliers" element={only('containers.manage', <Suppliers />)} />
          <Route path="users" element={only('users', <Users />)} />
          <Route path="settings" element={only('settings', <Settings />)} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
