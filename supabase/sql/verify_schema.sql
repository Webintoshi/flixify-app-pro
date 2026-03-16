select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select slug, title, duration, duration_months
from public.packages
order by duration_months;

select support_whatsapp_url, support_telegram_url, sales_portal_url, hero_title
from public.app_settings;

