-- =============================================================
-- Royal Stationers - database setup
-- Run this whole file ONCE on a NEW Supabase project:
--   Supabase Dashboard > SQL Editor > New query > paste > Run
--
-- Rules:
--   * Stock is never stored on the product. Every change is a row in
--     stock_moves (+ in, - out), per store location. Stock = sum(qty).
--   * Quantities are in the product's unit (Pc, Box, ...). Cartons are
--     only a way of entering/showing them: qty = cartons * carton_qty + loose.
--   * Customer balance = opening balance + sales - returns - receipts.
-- =============================================================

-- Helpers that must not be callable through the API live here
create schema if not exists private;
revoke all on schema private from public;

-- ---------- Business profile (shown on prints) ----------
create table public.companies (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  address               text,
  phone                 text,
  email                 text,
  ntn                   text,
  strn                  text,
  allow_negative_stock  boolean not null default false,
  is_default            boolean not null default false,
  created_at            timestamptz not null default now()
);
create unique index companies_one_default on public.companies (is_default) where is_default;

-- ---------- Users ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null,
  role        text not null default 'cashier' check (role in ('admin', 'cashier')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- New auth users get a profile. The very first user becomes admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data->>'role' = 'admin'
           or not exists (select 1 from public.profiles where role = 'admin')
         then 'admin' else 'cashier' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin') $$;

-- ---------- Product lookups ("Company" = maker, e.g. China, Dollar, Piano) ----------
create table public.product_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  created_at  timestamptz not null default now()
);
create unique index product_companies_name_unique on public.product_companies (lower(name));

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  created_at  timestamptz not null default now()
);
create unique index brands_name_unique on public.brands (lower(name));

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  created_at  timestamptz not null default now()
);
create unique index categories_name_unique on public.categories (lower(name));

-- ---------- Products ----------
create sequence public.product_code_seq;

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  name                text not null check (trim(name) <> ''),
  product_company_id  uuid references public.product_companies(id) on delete set null,
  brand_id            uuid references public.brands(id) on delete set null,
  category_id         uuid references public.categories(id) on delete set null,
  unit                text not null default 'Pc',
  carton_qty          integer not null default 1 check (carton_qty >= 1),   -- units in one carton
  inner_qty           integer not null default 0 check (inner_qty >= 0),    -- units in one inner pack
  cbm                 numeric(10,4) not null default 0 check (cbm >= 0),    -- per carton
  reorder_level       numeric(12,2) not null default 0 check (reorder_level >= 0),
  price               numeric(12,2) not null default 0 check (price >= 0),
  min_price           numeric(12,2) not null default 0 check (min_price >= 0),
  max_price           numeric(12,2) not null default 0 check (max_price >= 0), -- 0 = no maximum
  description         text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  check (max_price = 0 or max_price >= min_price)
);
create unique index products_code_unique on public.products (lower(trim(code)));
create unique index products_name_unique on public.products (lower(regexp_replace(trim(name), '\s+', ' ', 'g')));

-- Blank code -> next free 6-digit number (000001, 000002, ...)
create or replace function private.product_default_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or trim(new.code) = '' then
    loop
      new.code := lpad(nextval('public.product_code_seq')::text, 6, '0');
      exit when not exists (select 1 from public.products where lower(trim(code)) = lower(new.code));
    end loop;
  end if;
  new.code := trim(new.code);
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  return new;
end;
$$;

create trigger products_default_code
  before insert or update on public.products
  for each row execute function private.product_default_code();

-- ---------- Store locations ----------
create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index locations_name_unique on public.locations (lower(trim(name)));

-- ---------- Customers ----------
create sequence public.customer_code_seq;

create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  code             integer not null unique default nextval('public.customer_code_seq'),
  name             text not null check (trim(name) <> ''),
  city             text,
  phone            text,
  phone2           text,
  contact_person   text,
  address          text,
  ntn              text,
  opening_balance  numeric(14,2) not null default 0,  -- + = customer owes us
  credit_limit     numeric(14,2) not null default 0 check (credit_limit >= 0), -- 0 = no limit
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
-- Same name is allowed in different cities ("Imran" in DG Khan and in Multan)
create unique index customers_name_city_unique on public.customers (lower(trim(name)), lower(trim(coalesce(city, ''))));

-- ---------- Sale invoices (sale or return) ----------
create sequence public.invoice_no_seq;

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_no     bigint not null unique default nextval('public.invoice_no_seq'),
  company_id     uuid not null references public.companies(id),
  customer_id    uuid not null references public.customers(id),
  invoice_date   date not null default current_date,
  txn_type       text not null default 'sale' check (txn_type in ('sale', 'return')),
  payment_mode   text not null default 'credit' check (payment_mode in ('cash', 'credit')),
  delivery_mode  text not null default 'counter' check (delivery_mode in ('counter', 'bilty', 'delivery')),
  bilty_no       text,
  subtotal       numeric(14,2) not null,
  discount       numeric(14,2) not null default 0,
  freight        numeric(14,2) not null default 0,
  total          numeric(14,2) not null,
  prev_balance   numeric(14,2) not null default 0,  -- customer balance just before this bill (for print)
  received       numeric(14,2) not null default 0,  -- money taken / refunded with this bill
  notes          text,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index invoices_customer_idx on public.invoices (customer_id, invoice_date);
create index invoices_date_idx on public.invoices (invoice_date);

create table public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  product_name  text not null,          -- snapshot, so old invoices don't change
  unit          text not null,
  location_id   uuid not null references public.locations(id),
  carton_qty    integer not null,       -- snapshot
  cartons       numeric(12,2) not null default 0,
  loose         numeric(12,2) not null default 0,
  qty           numeric(12,2) not null check (qty > 0),  -- cartons * carton_qty + loose
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  line_total    numeric(14,2) not null,
  sort_order    integer not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_product_idx on public.invoice_items (product_id);

-- ---------- Receipts (money from customers; negative = refund) ----------
create sequence public.receipt_no_seq;

create table public.receipts (
  id            uuid primary key default gen_random_uuid(),
  receipt_no    bigint not null unique default nextval('public.receipt_no_seq'),
  customer_id   uuid not null references public.customers(id),
  receipt_date  date not null default current_date,
  amount        numeric(14,2) not null check (amount <> 0),
  method        text not null default 'cash' check (method in ('cash', 'bank', 'cheque')),
  reference     text,   -- cheque no. / bank ref
  note          text,
  invoice_id    uuid references public.invoices(id) on delete cascade,  -- set when taken with a bill
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index receipts_customer_idx on public.receipts (customer_id, receipt_date);

-- ---------- Stock entries (Stock In / Out / Transfer / Opening) ----------
create sequence public.stock_entry_no_seq;

create table public.stock_entries (
  id              uuid primary key default gen_random_uuid(),
  entry_no        bigint not null unique default nextval('public.stock_entry_no_seq'),
  kind            text not null check (kind in ('opening', 'in', 'out', 'transfer')),
  entry_date      date not null default current_date,
  location_id     uuid not null references public.locations(id),
  to_location_id  uuid references public.locations(id),
  note            text,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check ((kind = 'transfer') = (to_location_id is not null)),
  check (to_location_id is distinct from location_id)
);

-- The stock ledger. Every stock change in the system is one row here.
create table public.stock_moves (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id),
  location_id     uuid not null references public.locations(id),
  qty             numeric(12,2) not null check (qty <> 0),   -- + in, - out
  move_date       date not null default current_date,
  kind            text not null check (kind in ('opening', 'in', 'out', 'transfer_in', 'transfer_out', 'sale', 'sale_return')),
  stock_entry_id  uuid references public.stock_entries(id) on delete cascade,
  invoice_id      uuid references public.invoices(id) on delete cascade,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(stock_entry_id, invoice_id) = 1)
);
create index stock_moves_product_location_idx on public.stock_moves (product_id, location_id);
create index stock_moves_entry_idx on public.stock_moves (stock_entry_id);
create index stock_moves_invoice_idx on public.stock_moves (invoice_id);

-- ---------- Views (security_invoker: the caller's RLS applies) ----------
create view public.stock_levels with (security_invoker = true) as
  select product_id, location_id, sum(qty) as qty
    from public.stock_moves
   group by product_id, location_id;

create view public.product_stock with (security_invoker = true) as
  select p.id as product_id, coalesce(sum(m.qty), 0) as qty
    from public.products p
    left join public.stock_moves m on m.product_id = p.id
   group by p.id;

-- debit = customer owes more, credit = customer owes less.
-- Sort: entry_date (nulls first), created_at, seq (a bill comes before the payment taken with it)
create view public.customer_ledger with (security_invoker = true) as
  select c.id as customer_id, null::date as entry_date, 'opening'::text as kind,
         null::uuid as ref_id, null::bigint as ref_no, 'Opening balance'::text as description,
         greatest(c.opening_balance, 0) as debit, greatest(-c.opening_balance, 0) as credit,
         c.created_at as created_at, 0 as seq
    from public.customers c
   where c.opening_balance <> 0
  union all
  select i.customer_id, i.invoice_date, i.txn_type, i.id, i.invoice_no,
         case when i.txn_type = 'sale' then 'Sale invoice' else 'Sale return' end
           || case when i.bilty_no is not null then ' · Bilty ' || i.bilty_no else '' end,
         case when i.txn_type = 'sale' then i.total else 0 end,
         case when i.txn_type = 'return' then i.total else 0 end,
         i.created_at, 1
    from public.invoices i
  union all
  select r.customer_id, r.receipt_date, 'receipt', r.id, r.receipt_no,
         case when r.amount > 0 then 'Receipt' else 'Refund' end || ' (' || r.method || ')'
           || case when r.reference is not null then ' · ' || r.reference else '' end
           || case when r.note is not null then ' · ' || r.note else '' end,
         greatest(-r.amount, 0), greatest(r.amount, 0),
         r.created_at, 2
    from public.receipts r;

create view public.customer_balances with (security_invoker = true) as
  select customer_id, sum(debit - credit) as balance
    from public.customer_ledger
   group by customer_id;

-- ---------- Private helpers ----------

-- p_items -> rows. Keys: product_id, location_id, cartons, loose, unit_price
create or replace function private.parse_lines(p_items jsonb)
returns table (ord int, product_id uuid, location_id uuid, cartons numeric, loose numeric, unit_price numeric)
language sql immutable as $$
  select t.ord::int,
         nullif(t.i->>'product_id', '')::uuid,
         nullif(t.i->>'location_id', '')::uuid,
         coalesce(nullif(t.i->>'cartons', '')::numeric, 0),
         coalesce(nullif(t.i->>'loose', '')::numeric, 0),
         nullif(t.i->>'unit_price', '')::numeric
    from jsonb_array_elements(p_items) with ordinality as t(i, ord)
$$;

-- Finds a lookup row by name (any case), creating it when missing. Blank name -> null.
create or replace function private.lookup_id(p_table regclass, p_name text)
returns uuid language plpgsql as $$
declare
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_id   uuid;
begin
  if v_name is null then return null; end if;
  execute format('select id from %s where lower(name) = lower($1)', p_table) into v_id using v_name;
  if v_id is null then
    execute format('insert into %s (name) values ($1) returning id', p_table) into v_id using v_name;
  end if;
  return v_id;
end;
$$;

create or replace function private.num(p jsonb, k text, dflt numeric default 0)
returns numeric language sql immutable as $$
  select coalesce(nullif(trim(p->>k), '')::numeric, dflt)
$$;

-- Lines that would take a store below zero, e.g. "Tape 1262 at 2nd Floor (available 30, needed 36)"
create or replace function private.stock_shortages(p_need jsonb)
returns text language sql stable as $$
  with need as (
    select (n->>'product_id')::uuid as product_id, (n->>'location_id')::uuid as location_id, sum((n->>'qty')::numeric) as qty
      from jsonb_array_elements(p_need) n
     group by 1, 2
  )
  select string_agg(format('%s at %s (available %s, needed %s)', p.name, l.name,
                           trim_scale(coalesce(s.qty, 0)), trim_scale(need.qty)), '; ' order by p.name)
    from need
    join public.products p on p.id = need.product_id
    join public.locations l on l.id = need.location_id
    left join lateral (
      select sum(m.qty) as qty from public.stock_moves m
       where m.product_id = need.product_id and m.location_id = need.location_id
    ) s on true
   where coalesce(s.qty, 0) < need.qty
$$;

-- ---------- save_product(): create / edit, company-brand-category by name ----------
-- p: { id?, code, name, company, brand, category, unit, carton_qty, inner_qty, cbm,
--      reorder_level, price, min_price, max_price, description, active }
create or replace function public.save_product(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change products';
  end if;

  if v_id is null then
    insert into products (code, name, product_company_id, brand_id, category_id, unit, carton_qty, inner_qty,
                          cbm, reorder_level, price, min_price, max_price, description, active)
    values (nullif(trim(p->>'code'), ''), p->>'name',
            private.lookup_id('public.product_companies', p->>'company'),
            private.lookup_id('public.brands', p->>'brand'),
            private.lookup_id('public.categories', p->>'category'),
            coalesce(nullif(trim(p->>'unit'), ''), 'Pc'),
            private.num(p, 'carton_qty', 1), private.num(p, 'inner_qty'), private.num(p, 'cbm'),
            private.num(p, 'reorder_level'), private.num(p, 'price'), private.num(p, 'min_price'), private.num(p, 'max_price'),
            nullif(trim(p->>'description'), ''), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update products set
      code               = coalesce(nullif(trim(p->>'code'), ''), code),
      name               = p->>'name',
      product_company_id = private.lookup_id('public.product_companies', p->>'company'),
      brand_id           = private.lookup_id('public.brands', p->>'brand'),
      category_id        = private.lookup_id('public.categories', p->>'category'),
      unit               = coalesce(nullif(trim(p->>'unit'), ''), unit),
      carton_qty         = private.num(p, 'carton_qty', 1),
      inner_qty          = private.num(p, 'inner_qty'),
      cbm                = private.num(p, 'cbm'),
      reorder_level      = private.num(p, 'reorder_level'),
      price              = private.num(p, 'price'),
      min_price          = private.num(p, 'min_price'),
      max_price          = private.num(p, 'max_price'),
      description        = nullif(trim(p->>'description'), ''),
      active             = coalesce((p->>'active')::boolean, active)
    where id = v_id;
    if not found then
      raise exception 'Product not found';
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------- import_products(): many products at once, optional opening stock ----------
-- Each row is a save_product() payload plus optional "stock" (opening qty in the product's unit).
-- Rows with stock need p_location_id. All rows succeed or none do.
create or replace function public.import_products(p_rows jsonb, p_location_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_id    uuid;
  v_stock numeric;
  v_entry uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can import products';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to import';
  end if;
  if p_location_id is not null and not exists (select 1 from locations where id = p_location_id) then
    raise exception 'Store location not found';
  end if;

  for r in select value as row, ordinality as n from jsonb_array_elements(p_rows) with ordinality loop
    begin
      v_id := public.save_product(r.row - 'id');
    exception when unique_violation then
      raise exception 'Row %: "%" - a product with this name or code already exists', r.n, r.row->>'name';
    end;

    v_stock := private.num(r.row, 'stock');
    if v_stock <> 0 then
      if p_location_id is null then
        raise exception 'Choose a store for the opening stock';
      end if;
      if v_entry is null then
        insert into stock_entries (kind, location_id, note, created_by)
        values ('opening', p_location_id, 'Opening stock (product import)', auth.uid())
        returning id into v_entry;
      end if;
      insert into stock_moves (product_id, location_id, qty, kind, stock_entry_id, created_by)
      values (v_id, p_location_id, v_stock, 'opening', v_entry, auth.uid());
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- post_stock_entry(): Opening / Stock In / Stock Out / Transfer ----------
-- p_items: [{ "product_id": "...", "cartons": 2, "loose": 5 }, ...]
create or replace function public.post_stock_entry(
  p_kind            text,
  p_location_id     uuid,
  p_items           jsonb,
  p_to_location_id  uuid default null,
  p_entry_date      date default current_date,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_date  date := coalesce(p_entry_date, current_date);
  v_bad   text;
  v_need  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can post stock entries';
  end if;
  if p_kind not in ('opening', 'in', 'out', 'transfer') then
    raise exception 'Unknown entry type';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;
  if not exists (select 1 from locations where id = p_location_id) then
    raise exception 'Choose a store';
  end if;
  if p_kind = 'transfer' and (p_to_location_id is null or p_to_location_id = p_location_id
                              or not exists (select 1 from locations where id = p_to_location_id)) then
    raise exception 'Choose a different store to transfer to';
  end if;

  if exists (select 1 from private.parse_lines(p_items) x left join products p on p.id = x.product_id where p.id is null) then
    raise exception 'One or more products were not found';
  end if;
  if exists (select 1 from private.parse_lines(p_items) x where x.cartons < 0 or x.loose < 0) then
    raise exception 'Cartons and loose cannot be negative';
  end if;
  select string_agg(p.name, ', ') into v_bad
    from private.parse_lines(p_items) x join products p on p.id = x.product_id
   where x.cartons * p.carton_qty + x.loose <= 0;
  if v_bad is not null then
    raise exception 'Enter a quantity for: %', v_bad;
  end if;

  -- Lock the products so two entries can't both pass the stock check
  perform 1 from products where id in (select product_id from private.parse_lines(p_items)) order by id for update;

  if p_kind in ('out', 'transfer') and not coalesce((select allow_negative_stock from companies order by is_default desc, created_at limit 1), false) then
    select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'location_id', p_location_id, 'qty', x.cartons * p.carton_qty + x.loose))
      into v_need
      from private.parse_lines(p_items) x join products p on p.id = x.product_id;
    v_bad := private.stock_shortages(v_need);
    if v_bad is not null then
      raise exception 'Not enough stock: %', v_bad;
    end if;
  end if;

  insert into stock_entries (kind, entry_date, location_id, to_location_id, note, created_by)
  values (p_kind, v_date, p_location_id, case when p_kind = 'transfer' then p_to_location_id end,
          nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into stock_moves (product_id, location_id, qty, move_date, kind, stock_entry_id, created_by)
  select x.product_id, p_location_id,
         case when p_kind in ('out', 'transfer') then -1 else 1 end * (x.cartons * p.carton_qty + x.loose),
         v_date,
         case p_kind when 'transfer' then 'transfer_out' else p_kind end,
         v_id, auth.uid()
    from private.parse_lines(p_items) x join products p on p.id = x.product_id;

  if p_kind = 'transfer' then
    insert into stock_moves (product_id, location_id, qty, move_date, kind, stock_entry_id, created_by)
    select x.product_id, p_to_location_id, x.cartons * p.carton_qty + x.loose, v_date, 'transfer_in', v_id, auth.uid()
      from private.parse_lines(p_items) x join products p on p.id = x.product_id;
  end if;

  return v_id;
end;
$$;

-- ---------- create_invoice(): sale or return, stock + account in one transaction ----------
-- p_items: [{ "product_id": "...", "location_id": "...", "cartons": 2, "loose": 0, "unit_price": 450 }, ...]
create or replace function public.create_invoice(
  p_customer_id    uuid,
  p_items          jsonb,
  p_invoice_date   date    default current_date,
  p_txn_type       text    default 'sale',
  p_payment_mode   text    default 'credit',
  p_delivery_mode  text    default 'counter',
  p_bilty_no       text    default null,
  p_discount       numeric default 0,
  p_freight        numeric default 0,
  p_received       numeric default 0,
  p_notes          text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company   companies%rowtype;
  v_date      date := coalesce(p_invoice_date, current_date);
  v_id        uuid;
  v_no        bigint;
  v_subtotal  numeric(14,2);
  v_total     numeric(14,2);
  v_prev      numeric(14,2);
  v_bad       text;
  v_need      jsonb;
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active';
  end if;
  if p_txn_type not in ('sale', 'return') then
    raise exception 'Unknown transaction type';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;

  select * into v_company from companies order by is_default desc, created_at limit 1;
  if not found then
    raise exception 'Add your business details in Settings first';
  end if;

  -- Lock the customer (balance snapshot) and the products (stock check)
  perform 1 from customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;
  perform 1 from products where id in (select product_id from private.parse_lines(p_items)) order by id for update;

  if exists (select 1 from private.parse_lines(p_items) x left join products p on p.id = x.product_id where p.id is null) then
    raise exception 'One or more products were not found';
  end if;
  if exists (select 1 from private.parse_lines(p_items) x left join locations l on l.id = x.location_id where l.id is null) then
    raise exception 'Choose a store for every item';
  end if;
  if exists (select 1 from private.parse_lines(p_items) x
              where x.cartons < 0 or x.loose < 0 or x.unit_price is null or x.unit_price < 0) then
    raise exception 'Cartons and loose cannot be negative, and every item needs a rate';
  end if;
  select string_agg(p.name, ', ') into v_bad
    from private.parse_lines(p_items) x join products p on p.id = x.product_id
   where x.cartons * p.carton_qty + x.loose <= 0;
  if v_bad is not null then
    raise exception 'Enter a quantity for: %', v_bad;
  end if;

  -- Rate below the minimum price: only an administrator may do that
  if p_txn_type = 'sale' and not public.is_admin() then
    select string_agg(format('%s (min %s)', p.name, trim_scale(p.min_price)), ', ') into v_bad
      from private.parse_lines(p_items) x join products p on p.id = x.product_id
     where p.min_price > 0 and x.unit_price < p.min_price;
    if v_bad is not null then
      raise exception 'Rate is below the minimum price for: %. Ask an administrator.', v_bad;
    end if;
  end if;

  if p_txn_type = 'sale' and not v_company.allow_negative_stock then
    select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'location_id', x.location_id, 'qty', x.cartons * p.carton_qty + x.loose))
      into v_need
      from private.parse_lines(p_items) x join products p on p.id = x.product_id;
    v_bad := private.stock_shortages(v_need);
    if v_bad is not null then
      raise exception 'Not enough stock: %', v_bad;
    end if;
  end if;

  select coalesce(sum(round((x.cartons * p.carton_qty + x.loose) * x.unit_price, 2)), 0) into v_subtotal
    from private.parse_lines(p_items) x join products p on p.id = x.product_id;

  p_discount := coalesce(p_discount, 0);
  p_freight  := coalesce(p_freight, 0);
  p_received := coalesce(p_received, 0);
  if p_discount < 0 or p_discount > v_subtotal then
    raise exception 'Discount must be between 0 and the bill amount';
  end if;
  if p_freight < 0 then
    raise exception 'Freight cannot be negative';
  end if;
  if p_received < 0 then
    raise exception 'Amount received cannot be negative';
  end if;
  v_total := v_subtotal - p_discount + p_freight;

  select coalesce(sum(debit - credit), 0) into v_prev from customer_ledger where customer_id = p_customer_id;

  insert into invoices (company_id, customer_id, invoice_date, txn_type, payment_mode, delivery_mode, bilty_no,
                        subtotal, discount, freight, total, prev_balance, received, notes, created_by)
  values (v_company.id, p_customer_id, v_date, p_txn_type, p_payment_mode, p_delivery_mode, nullif(trim(p_bilty_no), ''),
          v_subtotal, p_discount, p_freight, v_total, v_prev, p_received, nullif(trim(p_notes), ''), auth.uid())
  returning id, invoice_no into v_id, v_no;

  insert into invoice_items (invoice_id, product_id, product_name, unit, location_id, carton_qty,
                             cartons, loose, qty, unit_price, line_total, sort_order)
  select v_id, p.id, p.name, p.unit, x.location_id, p.carton_qty,
         x.cartons, x.loose, x.cartons * p.carton_qty + x.loose, x.unit_price,
         round((x.cartons * p.carton_qty + x.loose) * x.unit_price, 2), x.ord
    from private.parse_lines(p_items) x join products p on p.id = x.product_id;

  insert into stock_moves (product_id, location_id, qty, move_date, kind, invoice_id, created_by)
  select product_id, location_id,
         case when p_txn_type = 'sale' then -qty else qty end,
         v_date,
         case when p_txn_type = 'sale' then 'sale' else 'sale_return' end,
         v_id, auth.uid()
    from invoice_items where invoice_id = v_id;

  if p_received > 0 then
    insert into receipts (customer_id, receipt_date, amount, method, note, invoice_id, created_by)
    values (p_customer_id, v_date,
            case when p_txn_type = 'sale' then p_received else -p_received end,
            'cash',
            case when p_txn_type = 'sale' then 'With invoice #' else 'Refund for return #' end || v_no,
            v_id, auth.uid());
  end if;

  return v_id;
end;
$$;

-- ---------- price_history(): last sales of a product to a customer ----------
create or replace function public.price_history(p_customer_id uuid, p_product_id uuid, p_limit integer default 5)
returns table (invoice_id uuid, invoice_no bigint, invoice_date date, txn_type text,
               cartons numeric, loose numeric, qty numeric, unit_price numeric)
language sql stable security invoker set search_path = public as $$
  select i.id, i.invoice_no, i.invoice_date, i.txn_type, it.cartons, it.loose, it.qty, it.unit_price
    from invoice_items it
    join invoices i on i.id = it.invoice_id
   where i.customer_id = p_customer_id and it.product_id = p_product_id
   order by i.invoice_date desc, i.created_at desc
   limit coalesce(p_limit, 5)
$$;

-- ---------- get_dashboard(): every dashboard number in one call ----------
create or replace function public.get_dashboard()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with
  month0 as (select date_trunc('month', current_date)::date as d),
  inv as (
    select i.*, case when i.txn_type = 'return' then -i.total else i.total end as net
      from invoices i
     where i.invoice_date >= ((select d from month0) - interval '11 months')::date
  ),
  recent30 as (select * from inv where invoice_date > current_date - 30),
  stock as (select product_id, location_id, qty from stock_levels),
  bal as (select b.customer_id, b.balance from customer_balances b)
  select jsonb_build_object(
    'today_sales',  (select coalesce(sum(net), 0) from inv where invoice_date = current_date),
    'today_count',  (select count(*) from inv where invoice_date = current_date and txn_type = 'sale'),
    'month_sales',  (select coalesce(sum(net), 0) from inv where invoice_date >= (select d from month0)),
    'month_count',  (select count(*) from inv where invoice_date >= (select d from month0) and txn_type = 'sale'),
    -- last month, same days (1st .. today's day number) for a fair comparison
    'last_month_to_date', (select coalesce(sum(net), 0) from inv
                            where invoice_date >= ((select d from month0) - interval '1 month')::date
                              and invoice_date <= (current_date - interval '1 month')::date),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('key', to_char(m, 'YYYY-MM'), 'total', coalesce(s.total, 0), 'count', coalesce(s.cnt, 0)) order by m), '[]'::jsonb)
                 from generate_series((select d from month0) - interval '11 months', (select d from month0), interval '1 month') m
                 left join (select date_trunc('month', invoice_date)::date as mm, sum(net) as total,
                                   count(*) filter (where txn_type = 'sale') as cnt
                              from inv group by 1) s on s.mm = m::date),
    'received_today', (select coalesce(sum(amount), 0) from receipts where receipt_date = current_date),
    'receivable',       (select coalesce(sum(balance), 0) from bal where balance > 0),
    'receivable_count', (select count(*) from bal where balance > 0),
    'top_receivables', (select coalesce(jsonb_agg(x order by x.balance desc), '[]'::jsonb) from (
                          select c.id, c.code, c.name, c.city, b.balance
                            from bal b join customers c on c.id = b.customer_id
                           where b.balance > 0 order by b.balance desc limit 6) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                       select it.product_name as name, sum(case when r.txn_type = 'return' then -it.line_total else it.line_total end) as total
                         from invoice_items it join recent30 r on r.id = it.invoice_id
                        group by it.product_name order by 2 desc limit 5) x),
    'top_customers', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                        select c.name || coalesce(' (' || c.city || ')', '') as name, sum(r.net) as total
                          from recent30 r join customers c on c.id = r.customer_id
                         group by c.id, c.name, c.city order by 2 desc limit 5) x),
    'low_stock_count', (select count(*) from products p join product_stock s on s.product_id = p.id
                         where p.active and p.reorder_level > 0 and s.qty <= p.reorder_level),
    'low_stock', (select coalesce(jsonb_agg(x order by x.short desc), '[]'::jsonb) from (
                    select p.id, p.code, p.name, p.unit, p.carton_qty, p.reorder_level, s.qty, p.reorder_level - s.qty as short
                      from products p join product_stock s on s.product_id = p.id
                     where p.active and p.reorder_level > 0 and s.qty <= p.reorder_level
                     order by p.reorder_level - s.qty desc limit 8) x),
    'negative_count', (select count(*) from stock where qty < 0),
    'locations', (select coalesce(jsonb_agg(x order by x.sort_order, x.name), '[]'::jsonb) from (
                    select l.id, l.name, l.sort_order,
                           count(s.product_id) filter (where s.qty > 0) as items,
                           count(s.product_id) filter (where s.qty < 0) as negative
                      from locations l left join stock s on s.location_id = l.id
                     where l.active group by l.id) x),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select i.id, i.invoice_no, i.invoice_date, i.txn_type, i.payment_mode, i.total, i.created_at,
                        c.name as customer_name, c.city as customer_city, pr.name as created_by_name
                   from invoices i join customers c on c.id = i.customer_id
                   left join profiles pr on pr.id = i.created_by
                  order by i.created_at desc limit 8) x),
    'mine', jsonb_build_object(
      'today',       (select coalesce(sum(net), 0) from inv where created_by = auth.uid() and invoice_date = current_date),
      'today_count', (select count(*) from inv where created_by = auth.uid() and invoice_date = current_date and txn_type = 'sale'),
      'month',       (select coalesce(sum(net), 0) from inv where created_by = auth.uid() and invoice_date >= (select d from month0)),
      'month_count', (select count(*) from inv where created_by = auth.uid() and invoice_date >= (select d from month0) and txn_type = 'sale'),
      'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                   select i.id, i.invoice_no, i.invoice_date, i.txn_type, i.payment_mode, i.total, i.created_at,
                          c.name as customer_name, c.city as customer_city
                     from invoices i join customers c on c.id = i.customer_id
                    where i.created_by = auth.uid()
                    order by i.created_at desc limit 8) x)
    ),
    'counts', jsonb_build_object(
      'customers', (select count(*) from customers where active),
      'products',  (select count(*) from products where active)
    )
  )
$$;

-- ---------- Function permissions: signed-in users only ----------
revoke execute on function public.save_product(jsonb) from public, anon;
revoke execute on function public.import_products(jsonb, uuid) from public, anon;
revoke execute on function public.post_stock_entry(text, uuid, jsonb, uuid, date, text) from public, anon;
revoke execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text) from public, anon;
revoke execute on function public.price_history(uuid, uuid, integer) from public, anon;
revoke execute on function public.get_dashboard() from public, anon;
grant execute on function public.save_product(jsonb) to authenticated;
grant execute on function public.import_products(jsonb, uuid) to authenticated;
grant execute on function public.post_stock_entry(text, uuid, jsonb, uuid, date, text) to authenticated;
grant execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.price_history(uuid, uuid, integer) to authenticated;
grant execute on function public.get_dashboard() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Row Level Security ----------
-- Everyone active can read everything. Only admins change master data.
-- Invoices, stock and receipts are written by the functions above;
-- admins may delete them (stock and account reverse automatically).
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.product_companies  enable row level security;
alter table public.brands             enable row level security;
alter table public.categories         enable row level security;
alter table public.products           enable row level security;
alter table public.locations          enable row level security;
alter table public.customers          enable row level security;
alter table public.invoices           enable row level security;
alter table public.invoice_items      enable row level security;
alter table public.receipts           enable row level security;
alter table public.stock_entries      enable row level security;
alter table public.stock_moves        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','product_companies','brands','categories','products','locations','customers',
                           'invoices','invoice_items','receipts','stock_entries','stock_moves']
  loop
    execute format('create policy "active users read" on public.%I for select to authenticated using (public.is_active_user())', t);
  end loop;

  foreach t in array array['companies','product_companies','brands','categories','products','locations','customers']
  loop
    execute format('create policy "admins write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;

  foreach t in array array['invoices','receipts','stock_entries']
  loop
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Cashiers may add customers (without an opening balance) and take payments
create policy "active users add customers" on public.customers
  for insert to authenticated with check (public.is_active_user() and opening_balance = 0);

create policy "active users add receipts" on public.receipts
  for insert to authenticated with check (public.is_active_user() and invoice_id is null and created_by = auth.uid());

create policy "read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
-- No write policies on profiles: changes go through the admin-users Edge Function (service role).

-- ---------- Starting data ----------
insert into public.companies (name, is_default) values ('Royal Stationers', true);

insert into public.locations (name, sort_order) values
  ('2nd Floor', 1), ('3rd Floor', 2), ('4th Floor', 3), ('First Floor', 4),
  ('Bahl Store', 5), ('Basement', 6), ('Racks', 7);

-- Walk-in customer for counter sales
insert into public.customers (name, city) values ('Counter Customer', 'Walk-in');

-- To continue numbering after the old software, e.g. next invoice = 14138:
--   select setval('public.invoice_no_seq', 14137);
