alter table public.app_settings
add column if not exists bank_transfer_eft_enabled boolean not null default true,
add column if not exists bank_transfer_eft_details text,
add column if not exists crypto_enabled boolean not null default true,
add column if not exists crypto_details text,
add column if not exists bank_card_enabled boolean not null default true,
add column if not exists bank_card_details text;
