revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;

alter table public.users enable row level security;
alter table public.device_sessions enable row level security;
alter table public.packages enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_m3u_sources enable row level security;
alter table public.m3u_sync_jobs enable row level security;
alter table public.live_channels enable row level security;
alter table public.movies enable row level security;
alter table public.series enable row level security;
alter table public.episodes enable row level security;
alter table public.payment_requests enable row level security;
alter table public.trial_requests enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.app_settings enable row level security;

