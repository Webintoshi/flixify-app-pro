# Supabase SQL Uygulama

Bu projede Supabase schema kurulumu cloud proje uzerinde `Dashboard > SQL Editor` ile yapilir.
Istersen alternatif olarak `SUPABASE_MANAGEMENT_TOKEN` ile Management API uzerinden de SQL
calistirabilirsin.

## Calistirilacak Dosya

- `supabase/migrations/202603130001_init.sql`
- `supabase/migrations/202603130002_lockdown_public_schema.sql`

## Dashboard Adimlari

1. Supabase projesini ac.
2. `Connect` panelinden `Session pooler` URI'yi kopyala ve root `.env` icindeki `DATABASE_URL`
   alanina yaz.
   URI formati Supabase dokumanina gore su sekildedir:
   `postgresql://postgres.<project-ref>:[YOUR_DB_PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. `SQL Editor` ekranina gir.
4. `New query` olustur.
5. `supabase/migrations/202603130001_init.sql` dosyasinin tamamini yapistir.
6. SQL'i calistir.
7. Yeni query acip `supabase/migrations/202603130002_lockdown_public_schema.sql` dosyasini calistir.
8. Ardindan `supabase/sql/verify_schema.sql` ve `supabase/sql/verify_security.sql` dosyalarini calistir.

## Alternatif: Management API

Bir Supabase Personal Access Token varsa:

1. Root `.env` dosyasina `SUPABASE_MANAGEMENT_TOKEN` ekle.
2. Migration calistir:
   `npm run supabase:run-sql -- supabase/migrations/202603130001_init.sql`
3. Guvenlik migration'ini calistir:
   `npm run supabase:run-sql -- supabase/migrations/202603130002_lockdown_public_schema.sql`
4. Dogrulama sorgulari icin:
   `npm run supabase:run-sql -- supabase/sql/verify_schema.sql --read-only`
5. Guvenlik dogrulamasi icin:
   `npm run supabase:run-sql -- supabase/sql/verify_security.sql --read-only`

## Beklenen Sonuc

- Tum public tablolar olusur.
- `packages` tablosunda 4 seed kaydi olur.
- `app_settings` tablosunda 1 seed kaydi olur.
- Tum public tablolarda RLS aktif olur.
- `anon` ve `authenticated` rolleri public tablolara dogrudan erisemez.

## Sonraki Adim

SQL tamamlandiktan sonra Supabase Dashboard uzerinden:

- `Authentication > Users` icinde admin kullanicisini `email + password` ile olustur.
- Project Settings veya API ekranindan `.env` icin su degerleri al:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_JWKS_URL`
  - `DATABASE_URL`
- Ayrica uygulama icin ayri bir `APP_JWT_SECRET` uret.
- Root `.env` icindeki `ADMIN_EMAILS` alanina admin olarak izin verilecek e-posta adreslerini yaz.
