-- =============================================================
-- Rizwan Global Trader - Invoice schema
-- Run this whole file once in: Supabase Dashboard > SQL Editor
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  phone       text,
  email       text,
  ntn         text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Only one company can be the default
create unique index if not exists companies_one_default
  on public.companies (is_default) where is_default;

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sku         text unique,
  unit        text not null default 'pcs',
  price       numeric(12,2) not null default 0 check (price >= 0),
  created_at  timestamptz not null default now()
);

create sequence if not exists public.invoice_no_seq;

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text not null unique,
  company_id    uuid not null references public.companies(id),
  customer_id   uuid not null references public.customers(id),
  invoice_date  date not null default current_date,
  subtotal      numeric(12,2) not null,
  discount      numeric(12,2) not null default 0,
  tax_percent   numeric(5,2)  not null default 0,
  tax_amount    numeric(12,2) not null default 0,
  total         numeric(12,2) not null,
  notes         text,
  created_at    timestamptz not null default now()
);

create table if not exists public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text not null,          -- snapshot, so old invoices don't change
  unit          text not null,
  qty           numeric(12,2) not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  line_total    numeric(12,2) not null,
  sort_order    int not null default 0
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

-- ---------- create_invoice(): one transaction, totals computed on the server ----------
-- p_items: [{ "product_id": "<uuid>", "qty": 2, "unit_price": 150 }, ...]

create or replace function public.create_invoice(
  p_company_id   uuid,
  p_customer_id  uuid,
  p_items        jsonb,
  p_invoice_date date    default current_date,
  p_discount     numeric default 0,
  p_tax_percent  numeric default 0,
  p_notes        text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_subtotal   numeric(12,2);
  v_taxable    numeric(12,2);
  v_tax        numeric(12,2);
  v_inserted   int;
begin
  p_discount    := coalesce(p_discount, 0);
  p_tax_percent := coalesce(p_tax_percent, 0);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice must have at least one item';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) i
    where coalesce((i->>'qty')::numeric, 0) <= 0
       or coalesce((i->>'unit_price')::numeric, -1) < 0
  ) then
    raise exception 'Every item needs qty > 0 and a price of 0 or more';
  end if;

  select coalesce(sum(round((i->>'qty')::numeric * (i->>'unit_price')::numeric, 2)), 0)
    into v_subtotal
    from jsonb_array_elements(p_items) i;

  if p_discount < 0 or p_discount > v_subtotal then
    raise exception 'Discount must be between 0 and the subtotal';
  end if;
  if p_tax_percent < 0 or p_tax_percent > 100 then
    raise exception 'Tax %% must be between 0 and 100';
  end if;

  v_taxable := v_subtotal - p_discount;
  v_tax     := round(v_taxable * p_tax_percent / 100, 2);

  insert into invoices (invoice_no, company_id, customer_id, invoice_date,
                        subtotal, discount, tax_percent, tax_amount, total, notes)
  values ('RGT-INV-' || to_char(coalesce(p_invoice_date, current_date), 'YYMM') || '-' || lpad(nextval('invoice_no_seq')::text, 4, '0'),
          p_company_id, p_customer_id, coalesce(p_invoice_date, current_date),
          v_subtotal, p_discount, p_tax_percent, v_tax, v_taxable + v_tax, p_notes)
  returning id into v_invoice_id;

  insert into invoice_items (invoice_id, product_id, product_name, unit,
                             qty, unit_price, line_total, sort_order)
  select v_invoice_id, p.id, p.name, p.unit,
         (t.i->>'qty')::numeric, (t.i->>'unit_price')::numeric,
         round((t.i->>'qty')::numeric * (t.i->>'unit_price')::numeric, 2),
         t.ord::int
    from jsonb_array_elements(p_items) with ordinality as t(i, ord)
    join products p on p.id = (t.i->>'product_id')::uuid;

  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_items) then
    raise exception 'One or more products were not found';
  end if;

  return v_invoice_id;
end;
$$;

grant execute on function public.create_invoice(uuid, uuid, jsonb, date, numeric, numeric, text)
  to anon, authenticated;

-- ---------- Row Level Security ----------
-- TESTING ONLY: anyone with the anon key can read/write.
-- Before going live, add Supabase Auth and replace these policies.

alter table public.companies     enable row level security;
alter table public.customers     enable row level security;
alter table public.products      enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists "dev full access" on public.companies;
drop policy if exists "dev full access" on public.customers;
drop policy if exists "dev full access" on public.products;
drop policy if exists "dev full access" on public.invoices;
drop policy if exists "dev full access" on public.invoice_items;

create policy "dev full access" on public.companies     for all to anon, authenticated using (true) with check (true);
create policy "dev full access" on public.customers     for all to anon, authenticated using (true) with check (true);
create policy "dev full access" on public.products      for all to anon, authenticated using (true) with check (true);
create policy "dev full access" on public.invoices      for all to anon, authenticated using (true) with check (true);
create policy "dev full access" on public.invoice_items for all to anon, authenticated using (true) with check (true);

-- =============================================================
-- 002: login-only access, invoice status, quotations
-- Run after 001_schema.sql in: Supabase Dashboard > SQL Editor
-- =============================================================

-- ---------- Invoice status ----------
alter table public.invoices
  add column if not exists status text not null default 'unpaid'
  check (status in ('unpaid', 'paid'));

-- ---------- Quotations ----------
create sequence if not exists public.quotation_no_seq;

create table if not exists public.quotations (
  id              uuid primary key default gen_random_uuid(),
  quotation_no    text not null unique,
  company_id      uuid not null references public.companies(id),
  customer_id     uuid not null references public.customers(id),
  quotation_date  date not null default current_date,
  valid_until     date,
  subtotal        numeric(12,2) not null,
  discount        numeric(12,2) not null default 0,
  tax_percent     numeric(5,2)  not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  total           numeric(12,2) not null,
  notes           text,
  status          text not null default 'open' check (status in ('open', 'converted')),
  invoice_id      uuid references public.invoices(id),
  created_at      timestamptz not null default now()
);

create table if not exists public.quotation_items (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text not null,
  unit          text not null,
  qty           numeric(12,2) not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  line_total    numeric(12,2) not null,
  sort_order    int not null default 0
);

create index if not exists quotation_items_quotation_id_idx on public.quotation_items (quotation_id);

alter table public.invoices
  add column if not exists quotation_id uuid references public.quotations(id);

-- ---------- create_invoice(): now requires a signed-in user ----------
create or replace function public.create_invoice(
  p_company_id   uuid,
  p_customer_id  uuid,
  p_items        jsonb,
  p_invoice_date date    default current_date,
  p_discount     numeric default 0,
  p_tax_percent  numeric default 0,
  p_notes        text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_subtotal numeric(12,2);
  v_taxable  numeric(12,2);
  v_tax      numeric(12,2);
  v_inserted int;
begin
  -- is_active_user() is defined in 004 (resolved when the function runs)
  if not public.is_active_user() then
    raise exception 'Your account is not active';
  end if;

  p_discount    := coalesce(p_discount, 0);
  p_tax_percent := coalesce(p_tax_percent, 0);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) i
    where coalesce((i->>'qty')::numeric, 0) <= 0
       or coalesce((i->>'unit_price')::numeric, -1) < 0
  ) then
    raise exception 'Every item needs qty > 0 and a price of 0 or more';
  end if;

  select coalesce(sum(round((i->>'qty')::numeric * (i->>'unit_price')::numeric, 2)), 0)
    into v_subtotal from jsonb_array_elements(p_items) i;

  if p_discount < 0 or p_discount > v_subtotal then
    raise exception 'Discount must be between 0 and the subtotal';
  end if;
  if p_tax_percent < 0 or p_tax_percent > 100 then
    raise exception 'Tax %% must be between 0 and 100';
  end if;

  v_taxable := v_subtotal - p_discount;
  v_tax     := round(v_taxable * p_tax_percent / 100, 2);

  insert into invoices (invoice_no, company_id, customer_id, invoice_date,
                        subtotal, discount, tax_percent, tax_amount, total, notes)
  values ('RGT-INV-' || to_char(coalesce(p_invoice_date, current_date), 'YYMM') || '-' || lpad(nextval('invoice_no_seq')::text, 4, '0'),
          p_company_id, p_customer_id, coalesce(p_invoice_date, current_date),
          v_subtotal, p_discount, p_tax_percent, v_tax, v_taxable + v_tax, p_notes)
  returning id into v_id;

  insert into invoice_items (invoice_id, product_id, product_name, unit, qty, unit_price, line_total, sort_order)
  select v_id, p.id, p.name, p.unit,
         (t.i->>'qty')::numeric, (t.i->>'unit_price')::numeric,
         round((t.i->>'qty')::numeric * (t.i->>'unit_price')::numeric, 2), t.ord::int
    from jsonb_array_elements(p_items) with ordinality as t(i, ord)
    join products p on p.id = (t.i->>'product_id')::uuid;

  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_items) then
    raise exception 'One or more products were not found';
  end if;

  return v_id;
end;
$$;

-- ---------- create_quotation() ----------
create or replace function public.create_quotation(
  p_company_id     uuid,
  p_customer_id    uuid,
  p_items          jsonb,
  p_quotation_date date    default current_date,
  p_valid_until    date    default null,
  p_discount       numeric default 0,
  p_tax_percent    numeric default 0,
  p_notes          text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_subtotal numeric(12,2);
  v_taxable  numeric(12,2);
  v_tax      numeric(12,2);
  v_inserted int;
begin
  -- is_active_user() is defined in 004 (resolved when the function runs)
  if not public.is_active_user() then
    raise exception 'Your account is not active';
  end if;

  p_discount    := coalesce(p_discount, 0);
  p_tax_percent := coalesce(p_tax_percent, 0);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) i
    where coalesce((i->>'qty')::numeric, 0) <= 0
       or coalesce((i->>'unit_price')::numeric, -1) < 0
  ) then
    raise exception 'Every item needs qty > 0 and a price of 0 or more';
  end if;

  select coalesce(sum(round((i->>'qty')::numeric * (i->>'unit_price')::numeric, 2)), 0)
    into v_subtotal from jsonb_array_elements(p_items) i;

  if p_discount < 0 or p_discount > v_subtotal then
    raise exception 'Discount must be between 0 and the subtotal';
  end if;
  if p_tax_percent < 0 or p_tax_percent > 100 then
    raise exception 'Tax %% must be between 0 and 100';
  end if;

  v_taxable := v_subtotal - p_discount;
  v_tax     := round(v_taxable * p_tax_percent / 100, 2);

  insert into quotations (quotation_no, company_id, customer_id, quotation_date, valid_until,
                          subtotal, discount, tax_percent, tax_amount, total, notes)
  values ('RGT-QT-' || to_char(coalesce(p_quotation_date, current_date), 'YYMM') || '-' || lpad(nextval('quotation_no_seq')::text, 4, '0'),
          p_company_id, p_customer_id, coalesce(p_quotation_date, current_date), p_valid_until,
          v_subtotal, p_discount, p_tax_percent, v_tax, v_taxable + v_tax, p_notes)
  returning id into v_id;

  insert into quotation_items (quotation_id, product_id, product_name, unit, qty, unit_price, line_total, sort_order)
  select v_id, p.id, p.name, p.unit,
         (t.i->>'qty')::numeric, (t.i->>'unit_price')::numeric,
         round((t.i->>'qty')::numeric * (t.i->>'unit_price')::numeric, 2), t.ord::int
    from jsonb_array_elements(p_items) with ordinality as t(i, ord)
    join products p on p.id = (t.i->>'product_id')::uuid;

  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_items) then
    raise exception 'One or more products were not found';
  end if;

  return v_id;
end;
$$;

-- ---------- convert_quotation_to_invoice() ----------
create or replace function public.convert_quotation_to_invoice(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  q    quotations%rowtype;
  v_id uuid;
begin
  -- is_active_user() is defined in 004 (resolved when the function runs)
  if not public.is_active_user() then
    raise exception 'Your account is not active';
  end if;

  select * into q from quotations where id = p_quotation_id for update;
  if not found then
    raise exception 'Quotation not found';
  end if;
  if q.status = 'converted' then
    raise exception 'This quotation is already converted to an invoice';
  end if;

  insert into invoices (invoice_no, company_id, customer_id, invoice_date,
                        subtotal, discount, tax_percent, tax_amount, total, notes, quotation_id)
  values ('RGT-INV-' || to_char(current_date, 'YYMM') || '-' || lpad(nextval('invoice_no_seq')::text, 4, '0'),
          q.company_id, q.customer_id, current_date,
          q.subtotal, q.discount, q.tax_percent, q.tax_amount, q.total, q.notes, q.id)
  returning id into v_id;

  insert into invoice_items (invoice_id, product_id, product_name, unit, qty, unit_price, line_total, sort_order)
  select v_id, product_id, product_name, unit, qty, unit_price, line_total, sort_order
    from quotation_items where quotation_id = q.id;

  update quotations set status = 'converted', invoice_id = v_id where id = q.id;
  return v_id;
end;
$$;

-- Only signed-in users may call these
revoke execute on function public.create_invoice(uuid, uuid, jsonb, date, numeric, numeric, text) from public, anon;
revoke execute on function public.create_quotation(uuid, uuid, jsonb, date, date, numeric, numeric, text) from public, anon;
revoke execute on function public.convert_quotation_to_invoice(uuid) from public, anon;
grant  execute on function public.create_invoice(uuid, uuid, jsonb, date, numeric, numeric, text) to authenticated;
grant  execute on function public.create_quotation(uuid, uuid, jsonb, date, date, numeric, numeric, text) to authenticated;
grant  execute on function public.convert_quotation_to_invoice(uuid) to authenticated;

-- ---------- RLS: signed-in users only (anon key alone can no longer read/write) ----------
alter table public.quotations      enable row level security;
alter table public.quotation_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','customers','products','invoices','invoice_items','quotations','quotation_items']
  loop
    execute format('drop policy if exists "dev full access" on public.%I', t);
    execute format('drop policy if exists "signed-in full access" on public.%I', t);
    execute format('create policy "signed-in full access" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- =============================================================
-- 003: customers are companies - extra fields, mandatory basics
-- Run after 002_auth_quotations.sql
-- =============================================================

alter table public.customers
  add column if not exists contact_person text,
  add column if not exists city           text,
  add column if not exists ntn            text,
  add column if not exists strn           text;

alter table public.companies
  add column if not exists strn text;

-- Mandatory basics for new/edited customers.
-- NOT VALID = existing rows are not checked, but every insert/update is.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_basics_required') then
    alter table public.customers
      add constraint customers_basics_required check (
        nullif(trim(name), '')           is not null and
        nullif(trim(contact_person), '') is not null and
        nullif(trim(phone), '')          is not null and
        nullif(trim(city), '')           is not null and
        nullif(trim(address), '')        is not null
      ) not valid;
  end if;
end $$;

-- =============================================================
-- 004: user roles (admin / cashier), active flag, who-created-what
-- Run after 003. User create/password/delete goes through the
-- `admin-users` Edge Function (supabase/functions/admin-users).
-- =============================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null,
  role        text not null default 'cashier' check (role in ('admin', 'cashier')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- New auth users get a profile automatically (role from app_metadata, default cashier;
-- the first user ever becomes admin so there is always someone who can manage the rest)
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
    -- The very first user becomes admin; after that, default is cashier
    case when new.raw_app_meta_data->>'role' = 'admin'
           or not exists (select 1 from public.profiles where role = 'admin')
         then 'admin' else 'cashier' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users that existed before this migration: the oldest one becomes admin
insert into public.profiles (id, email, name, role)
select u.id, u.email, split_part(u.email, '@', 1),
       case when not exists (select 1 from public.profiles where role = 'admin')
                 and u.id = (select id from auth.users order by created_at limit 1)
            then 'admin' else 'cashier' end
  from auth.users u
on conflict (id) do nothing;

-- ---------- Role helpers (used by policies and functions) ----------
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin') $$;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Who created each document ----------
alter table public.invoices
  add column if not exists created_by uuid default auth.uid() references public.profiles(id) on delete set null;
alter table public.quotations
  add column if not exists created_by uuid default auth.uid() references public.profiles(id) on delete set null;

-- ---------- Policies ----------
-- Everyone active can read. Only admins can change data directly.
-- Cashiers create invoices/quotations through the create_* functions,
-- and may add (not edit/delete) customers.
alter table public.profiles enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','customers','products','invoices','invoice_items','quotations','quotation_items']
  loop
    execute format('drop policy if exists "signed-in full access" on public.%I', t);
    execute format('drop policy if exists "active users read" on public.%I', t);
    execute format('drop policy if exists "admins write" on public.%I', t);
    execute format('create policy "active users read" on public.%I for select to authenticated using (public.is_active_user())', t);
    execute format('create policy "admins write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists "active users add customers" on public.customers;
create policy "active users add customers" on public.customers
  for insert to authenticated with check (public.is_active_user());

drop policy if exists "read own or admin" on public.profiles;
create policy "read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
-- No write policies on profiles: changes go through the admin-users Edge Function (service role).

-- =============================================================
-- 005: product description + stock, no duplicate names / SKUs
-- Run in: Supabase > SQL Editor
-- =============================================================

alter table public.products
  add column if not exists description text,
  add column if not exists stock numeric(12,2) not null default 0 check (stock >= 0);

-- One product per name and per SKU, ignoring case and extra spaces
create unique index if not exists products_name_unique
  on public.products (lower(regexp_replace(trim(name), '\s+', ' ', 'g')));

create unique index if not exists products_sku_unique
  on public.products (lower(trim(sku)))
  where sku is not null and trim(sku) <> '';

-- ---------- Sample data (skipped if a company already exists) ----------
do $seed$ begin if not exists (select 1 from public.companies) then

insert into public.companies (name, address, phone, email, ntn, strn, is_default) values
  ('Rizwan Global Trader', 'Shop #1, Main Market, Lahore', '+92 300 0000000', 'info@rizwanglobal.example', '0000000-0', '00-00-0000-000-00', true);

insert into public.customers (name, contact_person, phone, email, address, city, ntn, strn) values
  ('Ahmed Traders',     'Ahmed Raza', '+92 301 1111111', 'accounts@ahmedtraders.pk', 'Shop 12, Anarkali Bazaar', 'Lahore',    '1234567-1', '03-01-1111-001-11'),
  ('Bilal Enterprises', 'Bilal Khan', '+92 302 2222222', null,                       'Plot 45, Saddar',          'Karachi',   '2345678-2', null),
  ('City Mart',         'Usman Ali',  '+92 303 3333333', 'info@citymart.pk',         'Office 3, Blue Area',      'Islamabad', '3456789-3', '03-02-2222-002-22');

insert into public.products (name, sku, unit, price) values
  ('Basmati Rice 5kg',   'RICE-5',  'bag',   2450),
  ('Cooking Oil 5L',     'OIL-5',   'can',   2950),
  ('Sugar 1kg',          'SUG-1',   'kg',     155),
  ('Tea 950g',           'TEA-950', 'pack',  1650),
  ('Flour 10kg',         'ATA-10',  'bag',   1350);
end if; end $seed$;

-- =============================================================
-- Demo login + 12 months of dummy data for flow testing.
-- Admin:    demo@rizwanglobal.com     /  Demo@12345
-- Cashier:  cashier@rizwanglobal.com  /  Cashier@123
-- Safe to re-run: skips anything that already exists.
-- =============================================================

-- ---------- Demo login users (admin + cashier) ----------
do $user$
declare
  r     record;
  v_uid uuid;
begin
  for r in select * from (values
    ('demo@rizwanglobal.com',    'Demo@12345',  'Rizwan Ahmed', 'admin'),
    ('cashier@rizwanglobal.com', 'Cashier@123', 'Ali Hassan',   'cashier')
  ) as v(email, password, name, role)
  loop
    continue when exists (select 1 from auth.users where email = r.email);
    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      r.email, extensions.crypt(r.password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', r.role),
      jsonb_build_object('name', r.name), now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end $user$;

-- ---------- More customers & products ----------
insert into public.customers (name, contact_person, phone, email, address, city, ntn, strn)
select v.* from (values
  ('Faisal Wholesale',    'Faisal Mehmood', '+92 304 4444444', 'faisal@example.com', '22-B Liberty Market', 'Lahore',     null,        null),
  ('Green Valley Store',  'Imran Shah',     '+92 305 5555555', null,                 'University Road',     'Peshawar',   '4567890-4', null),
  ('Hamza & Sons',        'Hamza Tariq',    '+92 306 6666666', 'hamza@example.com',  'Near Clock Tower',    'Faisalabad', '5678901-5', '03-03-3333-003-33'),
  ('Iqbal General Store', 'Muhammad Iqbal', '+92 307 7777777', null,                 'Main Bazaar, Cantt',  'Rawalpindi', null,        null),
  ('Kashif Distributors', 'Kashif Nawaz',   '+92 308 8888888', 'kashif@example.com', 'Hussain Agahi Road',  'Multan',     '6789012-6', '03-04-4444-004-44')
) as v(name, contact_person, phone, email, address, city, ntn, strn)
where not exists (select 1 from public.customers c where c.name = v.name);

insert into public.products (name, sku, unit, price)
select v.* from (values
  ('Ghee 1kg',          'GHEE-1',   'tin',    620::numeric),
  ('Red Lentils 1kg',   'DAL-1',    'kg',     340::numeric),
  ('Chickpeas 1kg',     'CHANA-1',  'kg',     290::numeric),
  ('Milk Powder 900g',  'MILK-900', 'pack',  1850::numeric),
  ('Salt 800g',         'SALT-800', 'pack',    65::numeric)
) as v(name, sku, unit, price)
where not exists (select 1 from public.products p where p.sku = v.sku);

-- ---------- Invoices (about one every 8 days for a year) & quotations ----------
do $demo$
declare
  v_company  uuid;
  v_cust     uuid[];
  v_inv      uuid;
  v_quo      uuid;
  v_date     date;
  v_sub      numeric(12,2);
  v_disc     numeric(12,2);
  v_taxp     numeric(5,2);
  v_tax      numeric(12,2);
  v_status   text;
  i          int;
begin
  if exists (select 1 from public.invoices) then
    return;  -- already has invoices; don't add demo data on top
  end if;

  select id into v_company from public.companies order by is_default desc, created_at limit 1;
  select array_agg(id) into v_cust from public.customers;

  for i in reverse 44..0 loop
    v_date := current_date - (i * 8) - floor(random() * 4)::int;
    -- older invoices are mostly paid, recent ones about half
    v_status := case
      when v_date < current_date - 45 and random() < 0.9 then 'paid'
      when v_date >= current_date - 45 and random() < 0.5 then 'paid'
      else 'unpaid' end;

    insert into public.invoices (invoice_no, company_id, customer_id, invoice_date,
                                 subtotal, discount, tax_percent, tax_amount, total, status, created_at)
    values ('RGT-INV-' || to_char(v_date, 'YYMM') || '-' || lpad(nextval('public.invoice_no_seq')::text, 4, '0'), v_company,
            v_cust[1 + floor(random() * array_length(v_cust, 1))::int], v_date,
            0, 0, 0, 0, 0, v_status, v_date + time '10:00' + (i || ' minutes')::interval)
    returning id into v_inv;

    insert into public.invoice_items (invoice_id, product_id, product_name, unit, qty, unit_price, line_total, sort_order)
    select v_inv, p.id, p.name, p.unit, 1 + floor(random() * 25), p.price, 0, row_number() over ()
      from (select * from public.products order by random() limit 1 + floor(random() * 4)::int) p;
    update public.invoice_items set line_total = round(qty * unit_price, 2) where invoice_id = v_inv;

    select sum(line_total) into v_sub from public.invoice_items where invoice_id = v_inv;
    v_disc := case when i % 5 = 0 then round(v_sub * 0.05) else 0 end;
    v_taxp := 18;  -- fixed GST
    v_tax  := round((v_sub - v_disc) * v_taxp / 100, 2);

    update public.invoices
       set subtotal = v_sub, discount = v_disc, tax_percent = v_taxp, tax_amount = v_tax, total = v_sub - v_disc + v_tax
     where id = v_inv;
  end loop;

  for i in reverse 6..0 loop
    v_date := current_date - (i * 3);

    insert into public.quotations (quotation_no, company_id, customer_id, quotation_date, valid_until,
                                   subtotal, discount, tax_percent, tax_amount, total, notes, created_at)
    values ('RGT-QT-' || to_char(v_date, 'YYMM') || '-' || lpad(nextval('public.quotation_no_seq')::text, 4, '0'), v_company,
            v_cust[1 + floor(random() * array_length(v_cust, 1))::int], v_date, v_date + 15,
            0, 0, 0, 0, 0, 'Prices valid for 15 days. Delivery within 3 working days.',
            v_date + time '11:00' + (i || ' minutes')::interval)
    returning id into v_quo;

    insert into public.quotation_items (quotation_id, product_id, product_name, unit, qty, unit_price, line_total, sort_order)
    select v_quo, p.id, p.name, p.unit, 5 + floor(random() * 40), p.price, 0, row_number() over ()
      from (select * from public.products order by random() limit 2 + floor(random() * 3)::int) p;
    update public.quotation_items set line_total = round(qty * unit_price, 2) where quotation_id = v_quo;

    select sum(line_total) into v_sub from public.quotation_items where quotation_id = v_quo;
    update public.quotations
       set subtotal = v_sub, tax_percent = 18, tax_amount = round(v_sub * 0.18, 2), total = v_sub + round(v_sub * 0.18, 2)
     where id = v_quo;
  end loop;

  -- Spread demo documents between the two demo users (mostly the cashier)
  update public.invoices   set created_by = case when random() < 0.7 then (select id from public.profiles where email = 'cashier@rizwanglobal.com') else (select id from public.profiles where email = 'demo@rizwanglobal.com') end;
  update public.quotations set created_by = case when random() < 0.6 then (select id from public.profiles where email = 'cashier@rizwanglobal.com') else (select id from public.profiles where email = 'demo@rizwanglobal.com') end;
end $demo$;
