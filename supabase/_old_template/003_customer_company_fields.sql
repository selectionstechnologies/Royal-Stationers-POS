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
