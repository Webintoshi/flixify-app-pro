# Proxy-free movie catalog correction

These scripts record the 2026-10-13 correction to the existing Coolify
service. They do not create provider lines or backups. The two build scripts
start from the exact preceding API images and verify source hashes. The sync
scripts update only the API image in Coolify; they do not restart containers.

Final running image: `flixify-api:proxy-free-movies-v2-20261013`.

The retired `VOD_PROXY_URLS` setting was cleared in Coolify. Its runtime count
is zero. Browser movie and series catalog requests both returned HTTP 200.
Safe movie and series details returned HTTP 200. An adult movie from the
current snapshot returned HTTP 404 for detail, playback, and favorite creation.
The account-library suite passed 22 tests after its existing repository mock
was extended in a temporary test mount.

The active server still receives `403 FORCED_COUNTRY` from the provider for
direct media requests. Catalog success does not establish film or series
playback. The three-hour direct-URL guard remains in place until an allowed
provider path and expiration behavior are verified.
