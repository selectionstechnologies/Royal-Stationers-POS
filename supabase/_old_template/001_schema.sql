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
