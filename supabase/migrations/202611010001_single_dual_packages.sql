begin;

set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.packages in share row exclusive mode;

insert into public.packages (slug, title, duration, duration_months, price_label, is_active)
values
  ('1-ay', '1 Ay · Tek Kullanıcı', '1m', 1, '250 ₺', true),
  ('6-ay', '6 Ay · Tek Kullanıcı', '6m', 6, '699 ₺', true),
  ('12-ay', '12 Ay · Tek Kullanıcı', '12m', 12, '999 ₺', true),
  ('1-ay-2-kullanici', '1 Ay · Çift Kullanıcı', '1m', 1, '399 ₺', true),
  ('6-ay-2-kullanici', '6 Ay · Çift Kullanıcı', '6m', 6, '999 ₺', true),
  ('12-ay-2-kullanici', '12 Ay · Çift Kullanıcı', '12m', 12, '1.399 ₺', true)
on conflict (slug) do update
set title = excluded.title,
    duration = excluded.duration,
    duration_months = excluded.duration_months,
    price_label = excluded.price_label,
    is_active = excluded.is_active
where (packages.title, packages.duration, packages.duration_months, packages.price_label, packages.is_active)
  is distinct from (excluded.title, excluded.duration, excluded.duration_months, excluded.price_label, excluded.is_active);

-- Retain the row and its payment/subscription foreign keys; only retire new sales.
update public.packages
set is_active = false
where slug = '3-ay' and is_active = true;

commit;
