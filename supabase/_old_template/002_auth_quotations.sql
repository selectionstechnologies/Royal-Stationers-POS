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
