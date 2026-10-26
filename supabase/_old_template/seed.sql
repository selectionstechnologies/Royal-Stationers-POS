-- Sample data for flow testing. Run after schema.sql.
-- Edit the company details to your real ones.

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
