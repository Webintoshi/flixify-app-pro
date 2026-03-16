create extension if not exists pg_trgm;

alter table public.users
add column if not exists code_suffix text;

create index if not exists idx_live_channels_group_lookup
on public.live_channels(user_id, snapshot_version, group_title, order_index);

create index if not exists idx_movies_group_lookup
on public.movies(user_id, snapshot_version, group_title, order_index);

create index if not exists idx_series_group_lookup
on public.series(user_id, snapshot_version, group_title, order_index);

create index if not exists idx_live_channels_title_trgm
on public.live_channels using gin (lower(title) gin_trgm_ops);

create index if not exists idx_movies_title_trgm
on public.movies using gin (lower(title) gin_trgm_ops);

create index if not exists idx_series_title_trgm
on public.series using gin (lower(title) gin_trgm_ops);
