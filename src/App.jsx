import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/AuthProvider'
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
import Settings from './pages/Settings'

const adminOnly = (el) => <RequireAuth adminOnly>{el}</RequireAuth>

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="invoices" element={<InvoiceList />} />
        <Route path="invoices/new" element={<InvoiceForm />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="receipts" element={<Receipts />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerLedger />} />
        <Route path="products" element={<Products />} />
        <Route path="products/:id/ledger" element={<ProductLedger />} />
        <Route path="stock" element={<Stock />} />
        <Route path="stock/entries" element={adminOnly(<StockEntries />)} />
        <Route path="stock/new" element={adminOnly(<StockEntryForm />)} />
        <Route path="users" element={adminOnly(<Users />)} />
        <Route path="settings" element={adminOnly(<Settings />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
