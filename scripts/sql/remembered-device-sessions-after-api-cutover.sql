-- Apply only after every API instance accepts nullable remembered-session expiry.
update public.device_sessions set expires_at=null
where revoked_at is null and expires_at>clock_timestamp();
