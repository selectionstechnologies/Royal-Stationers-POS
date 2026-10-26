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
