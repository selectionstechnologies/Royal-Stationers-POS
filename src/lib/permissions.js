// Roles and what each may do. The database enforces the same rules
// (public.has_permission() in supabase/setup.sql); this copy only shapes the UI.
// Keep both in sync, and the role list in supabase/functions/admin-users.

export const ROLES = [
  {
    value: 'admin',
    label: 'Administrator',
    text: 'Everything: users, settings, deleting records, reports, below-minimum prices.',
  },
  {
    value: 'manager',
    label: 'Manager',
    text: 'Sales, returns, receipts, customers, products, stock and all reports. No users, settings or deleting.',
  },
  {
    value: 'cashier',
    label: 'Cashier',
    text: 'Sale invoices and receipts. Can add customers. No deleting, stock changes or below-minimum prices.',
  },
  {
    value: 'storekeeper',
    label: 'Store keeper',
    text: 'Stock in, stock out and transfers. Sees products and stock only, no sales or customer accounts.',
  },
]

export const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.value, r.label]))

const PERMISSIONS = {
  sales: ['admin', 'manager', 'cashier'], // invoices, receipts, customers and their ledgers
  'price.override': ['admin', 'manager'], // sell below a product's minimum price
  'customers.manage': ['admin', 'manager'], // edit customers, opening balance, credit limit
  'products.manage': ['admin', 'manager'], // add, edit and import products
  'stock.manage': ['admin', 'manager', 'storekeeper'], // stock in / out / transfer
  reports: ['admin', 'manager'], // business-wide dashboard and who-did-what
  delete: ['admin'], // invoices, receipts, stock entries, customers, products
  users: ['admin'],
  settings: ['admin'],
}

export const can = (role, permission) => Boolean(role && PERMISSIONS[permission]?.includes(role))
