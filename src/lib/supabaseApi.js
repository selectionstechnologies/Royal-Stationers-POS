import { supabase } from './supabase'
import { productPayload } from './productFields'

function unwrap({ data, error }) {
  if (error) {
    if (error.code === '23505') {
      if (/products_code/i.test(error.message)) throw new Error('This code is already used by another product.')
      if (/products_name/i.test(error.message)) throw new Error('A product with this name already exists.')
      if (/customers_name_city/i.test(error.message)) throw new Error('A customer with this name already exists in this city.')
      if (/locations_name/i.test(error.message)) throw new Error('A store with this name already exists.')
      throw new Error('This record already exists.')
    }
    if (error.code === '23503') throw new Error('This record is used in invoices or stock entries, so it cannot be deleted.')
    if (error.code === '42501') throw new Error('You do not have permission to do this.')
    throw new Error(error.message)
  }
  return data
}

// Supabase returns at most 1,000 rows per request; this pages through all of them.
// `build` must return a fresh query with a stable order.
async function selectAll(build, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(await build().range(from, from + pageSize - 1))
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

// ---------- Business profile & stores ----------

// Default company first; falls back to the oldest one.
export async function getDefaultCompany() {
  return unwrap(
    await supabase
      .from('companies')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  )
}

export async function saveCompany({ id, name, address, phone, email, ntn, strn, allow_negative_stock }) {
  const row = { name, address, phone, email, ntn, strn, allow_negative_stock: Boolean(allow_negative_stock) }
  if (id) return unwrap(await supabase.from('companies').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('companies').insert({ ...row, is_default: true }).select().single())
}

export async function listLocations() {
  return unwrap(await supabase.from('locations').select('*').order('sort_order').order('name'))
}

export async function saveLocation({ id, name, sort_order, active }) {
  const row = { name: String(name ?? '').trim(), sort_order: Number(sort_order) || 0, active: active ?? true }
  if (id) return unwrap(await supabase.from('locations').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('locations').insert(row).select().single())
}

// ---------- Products ----------

const PRODUCT_SELECT = '*, product_companies(name), brands(name), categories(name)'

const flattenProduct = ({ product_companies, brands, categories, ...p }) => ({
  ...p,
  company: product_companies?.name ?? '',
  brand: brands?.name ?? '',
  category: categories?.name ?? '',
})

export async function listProducts() {
  const rows = await selectAll(() => supabase.from('products').select(PRODUCT_SELECT).order('name').order('id'))
  return rows.map(flattenProduct)
}

export async function getProduct(id) {
  return flattenProduct(unwrap(await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).single()))
}

// Names of existing companies, brands and categories (for suggestions)
export async function listLookups() {
  const [companies, brands, categories] = await Promise.all(
    ['product_companies', 'brands', 'categories'].map((t) => selectAll(() => supabase.from(t).select('name').order('name'))),
  )
  const names = (rows) => rows.map((r) => r.name)
  return { companies: names(companies), brands: names(brands), categories: names(categories) }
}

export async function saveProduct(form) {
  const id = unwrap(await supabase.rpc('save_product', { p: productPayload(form) }))
  return getProduct(id)
}

// Sent in chunks so a big file doesn't hit request limits. Each chunk is all-or-nothing.
export async function importProducts(forms, locationId, onProgress) {
  const CHUNK = 500
  let done = 0
  for (let i = 0; i < forms.length; i += CHUNK) {
    const rows = forms.slice(i, i + CHUNK).map(productPayload)
    try {
      done += unwrap(await supabase.rpc('import_products', { p_rows: rows, p_location_id: locationId || null }))
    } catch (e) {
      throw new Error(done ? `${done} products were imported, then it stopped: ${e.message}` : e.message)
    }
    onProgress?.(done)
  }
  return done
}

export async function deleteProduct(id) {
  return unwrap(await supabase.from('products').delete().eq('id', id))
}

// ---------- Stock ----------

// One row per product per store: { product_id, location_id, qty }
export async function listStockLevels() {
  return selectAll(() => supabase.from('stock_levels').select('product_id, location_id, qty').order('product_id').order('location_id'))
}

export async function getProductStock(productId) {
  return unwrap(await supabase.from('stock_levels').select('location_id, qty').eq('product_id', productId))
}

export async function postStockEntry({ kind, locationId, toLocationId, date, note, items }) {
  return unwrap(
    await supabase.rpc('post_stock_entry', {
      p_kind: kind,
      p_location_id: locationId,
      p_to_location_id: kind === 'transfer' ? toLocationId : null,
      p_entry_date: date,
      p_note: note || null,
      p_items: items.map((i) => ({ product_id: i.product_id, cartons: Number(i.cartons) || 0, loose: Number(i.loose) || 0 })),
    }),
  )
}

export async function listStockEntries({ from, to }) {
  return unwrap(
    await supabase
      .from('stock_entries')
      .select(
        `*, location:locations!stock_entries_location_id_fkey(name), to_location:locations!stock_entries_to_location_id_fkey(name),
         creator:profiles(name), stock_moves(qty, location_id, products(name, unit, carton_qty))`,
      )
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_no', { ascending: false }),
  )
}

export async function deleteStockEntry(id) {
  return unwrap(await supabase.from('stock_entries').delete().eq('id', id))
}

// Every movement of one product, oldest first
export async function getProductLedger(productId) {
  return selectAll(() =>
    supabase
      .from('stock_moves')
      .select(
        `id, qty, move_date, kind, created_at, location_id,
         invoices(id, invoice_no, customers(name, city)),
         stock_entries(id, entry_no, note, location_id, to_location_id)`,
      )
      .eq('product_id', productId)
      .order('move_date')
      .order('created_at')
      .order('id'),
  )
}

// ---------- Customers ----------

export async function listCustomers() {
  return selectAll(() => supabase.from('customers').select('*').order('name').order('id'))
}

// { [customer_id]: balance }
export async function listBalances() {
  const rows = await selectAll(() => supabase.from('customer_balances').select('customer_id, balance').order('customer_id'))
  return Object.fromEntries(rows.map((r) => [r.customer_id, Number(r.balance)]))
}

export async function getCustomer(id) {
  return unwrap(await supabase.from('customers').select('*').eq('id', id).single())
}

export async function getCustomerBalance(id) {
  const row = unwrap(await supabase.from('customer_balances').select('balance').eq('customer_id', id).maybeSingle())
  return Number(row?.balance ?? 0)
}

export async function saveCustomer(row, id) {
  if (id) return unwrap(await supabase.from('customers').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('customers').insert(row).select().single())
}

export async function deleteCustomer(id) {
  return unwrap(await supabase.from('customers').delete().eq('id', id))
}

export async function getCustomerLedger(id) {
  return selectAll(() =>
    supabase
      .from('customer_ledger')
      .select('*')
      .eq('customer_id', id)
      .order('entry_date', { ascending: true, nullsFirst: true })
      .order('created_at')
      .order('seq'),
  )
}

// ---------- Receipts ----------

export async function listReceipts({ from, to }) {
  return selectAll(() =>
    supabase
      .from('receipts')
      .select('*, customers(id, name, city), invoices(invoice_no), creator:profiles(name)')
      .gte('receipt_date', from)
      .lte('receipt_date', to)
      .order('receipt_no', { ascending: false }),
  )
}

export async function createReceipt({ customerId, date, amount, method, reference, note }) {
  return unwrap(
    await supabase
      .from('receipts')
      .insert({
        customer_id: customerId,
        receipt_date: date,
        amount: Number(amount),
        method,
        reference: reference?.trim() || null,
        note: note?.trim() || null,
      })
      .select()
      .single(),
  )
}

export async function deleteReceipt(id) {
  return unwrap(await supabase.from('receipts').delete().eq('id', id))
}

// ---------- Invoices ----------

export async function listInvoices({ from, to }) {
  const rows = await selectAll(() =>
    supabase
      .from('invoices')
      .select('id, invoice_no, invoice_date, txn_type, payment_mode, delivery_mode, bilty_no, total, received, created_by, customers(id, name, city), creator:profiles(name)')
      .gte('invoice_date', from)
      .lte('invoice_date', to)
      .order('invoice_no', { ascending: false }),
  )
  return rows.map((r) => ({ ...r, created_by_name: r.creator?.name ?? null }))
}

export async function getInvoice(id) {
  const doc = unwrap(
    await supabase
      .from('invoices')
      .select('*, companies(*), customers(*), invoice_items(*, locations(name)), creator:profiles(name)')
      .eq('id', id)
      .order('sort_order', { referencedTable: 'invoice_items' })
      .single(),
  )
  return { ...doc, items: doc.invoice_items, created_by_name: doc.creator?.name ?? null }
}

// Invoice numbers are unique, so this finds at most one
export async function findInvoiceId(invoiceNo) {
  const row = unwrap(await supabase.from('invoices').select('id').eq('invoice_no', invoiceNo).maybeSingle())
  return row?.id ?? null
}

// Cheque photos live in the private 'cheques' bucket; the invoice keeps the path.
export async function uploadChequeImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
  unwrap(await supabase.storage.from('cheques').upload(path, file, { contentType: file.type }))
  return path
}

export async function getChequeImageUrl(path) {
  return unwrap(await supabase.storage.from('cheques').createSignedUrl(path, 60 * 60)).signedUrl
}

// Returns the new invoice id. A cheque photo is uploaded first, then saved with the invoice.
export async function createInvoice({ customerId, items, date, txnType, paymentMode, deliveryMode, biltyNo, discount, freight, received, notes, chequeFile }) {
  const chequeImage = paymentMode === 'cheque' && chequeFile ? await uploadChequeImage(chequeFile) : null
  return unwrap(
    await supabase.rpc('create_invoice', {
      p_customer_id: customerId,
      p_items: items.map((i) => ({
        product_id: i.product_id,
        location_id: i.location_id,
        cartons: Number(i.cartons) || 0,
        loose: Number(i.loose) || 0,
        unit_price: Number(i.unit_price),
      })),
      p_invoice_date: date,
      p_txn_type: txnType,
      p_payment_mode: paymentMode,
      p_delivery_mode: deliveryMode,
      p_bilty_no: biltyNo || null,
      p_discount: Number(discount) || 0,
      p_freight: Number(freight) || 0,
      p_received: Number(received) || 0,
      p_notes: notes || null,
      p_cheque_image: chequeImage,
    }),
  )
}

// Deleting reverses its stock movements and any payment taken with it
export async function deleteInvoice(id) {
  return unwrap(await supabase.from('invoices').delete().eq('id', id))
}

export async function getPriceHistory(customerId, productId) {
  return unwrap(await supabase.rpc('price_history', { p_customer_id: customerId, p_product_id: productId, p_limit: 5 }))
}

// ---------- Dashboard ----------
// All totals are calculated in the database (get_dashboard in setup.sql).

export async function getDashboard() {
  return unwrap(await supabase.rpc('get_dashboard'))
}

// ---------- Users (admin only) ----------
// Reading uses the profiles table; changes go through the `admin-users` Edge Function,
// because creating users and setting passwords needs the service role key (server only).

export async function getProfile(userId) {
  return unwrap(await supabase.from('profiles').select('name, role, active').eq('id', userId).maybeSingle())
}

export async function listUsers() {
  return unwrap(await supabase.from('profiles').select('*').order('created_at'))
}

async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || error.message)
  }
  return data
}

export const createUser = (user) => adminUsers({ action: 'create', ...user })
export const updateUser = (id, changes) => adminUsers({ action: 'update', id, ...changes })
export const setUserPassword = (id, password) => adminUsers({ action: 'password', id, password })
export const deleteUser = (id) => adminUsers({ action: 'delete', id })
