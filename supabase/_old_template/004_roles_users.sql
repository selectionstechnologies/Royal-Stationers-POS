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
