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

const only = (permission, el) => <RequireAuth permission={permission}>{el}</RequireAuth>

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
        <Route path="users" element={only('users', <Users />)} />
        <Route path="settings" element={only('settings', <Settings />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
