alter table public.payment_requests
  add column if not exists payment_method_id text,
  add column if not exists crypto_asset_id text;
