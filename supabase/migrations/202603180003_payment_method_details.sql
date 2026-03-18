alter table public.app_settings
add column if not exists bank_transfer_recipient_name text,
add column if not exists bank_transfer_iban text,
add column if not exists bank_transfer_bank_name text,
add column if not exists crypto_wallet_usdt_trc20 text,
add column if not exists crypto_wallet_tron text,
add column if not exists crypto_wallet_sol text,
add column if not exists crypto_wallet_btc text,
add column if not exists crypto_wallet_usdc text;
