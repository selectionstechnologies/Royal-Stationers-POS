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
