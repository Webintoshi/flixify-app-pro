# Live policy and permanent registration rollout

This release changes only the API image and its registration settings. The existing web, worker, database container, trusted proxy, provider settings, and pre-existing `.env` bytes are guarded.

The builder starts from immutable API `cd45f38ba327…` (`trial-capacity-92aa1fda3c46-20261030`). It recompiles the actual production source and requires byte-identical baseline artifacts before applying the exact reviewed edits to three existing TypeScript files and adding two helpers. Production-only referral, billing, playback code, dependencies, and Fastify 5.12.5 remain in that image. Build/test containers have no network, 1280 MiB memory / 1536 MiB including swap, and require 8 GiB free space. No installation command runs.

Run the offline contracts first:

```sh
python3 coolify/releases/2026-10-31-live-registration/test-builder.py
python3 coolify/releases/2026-10-31-live-registration/test-release-api.py
```

On the production host, use an exact committed revision, then retain its reported immutable candidate ID:

```sh
python3 coolify/releases/2026-10-31-live-registration/build-api.py /path/to/reviewed/repo --revision FULL_COMMIT --build
```

`--verify-existing` independently recompiles and verifies an already built candidate without publishing another image. The builder's default performs read-only preflight.

The release tool also defaults to read-only preflight. Supply the exact current web tag/ID; worker and database pins are fixed:

```sh
python3 coolify/releases/2026-10-31-live-registration/release-api.py /path/to/reviewed/repo --revision FULL_COMMIT --candidate-id sha256:CANDIDATE --protected-web-tag flixify-ops-web:CURRENT_TAG --protected-web-id sha256:CURRENT_WEB
```

Only after the candidate build, focused tests, and isolated PostgreSQL fixture pass, repeat that command with `--apply`. It takes an exclusive host lock, writes a nonsecret fence, stops only the API, and applies both reviewed migrations in one PostgreSQL transaction. The same transaction records two source hashes and a fingerprint covering the resulting tables, columns, constraints, indexes, row security, policies, and grants. Existing unmarked tables or changed proofs stop the release. Replay verifies the marker and schema instead of rerunning the second `CREATE TABLE` migration.

The stable registration key is copied internally from the current API JWT literal and compared with the running container. Coolify stores it as one encrypted service environment variable with literal quoting and a compose reference. The existing JWT remains unchanged. The generated `.env` must equal the original byte sequence followed by exactly one generated key line; the quota changes from 1000 to 2. Nothing prints secret values. After recreation, the API's actual key bytes, quota, narrow trusted proxy, local health response, and protected container identities are checked.

There is deliberately no rollback-to-old-image action: the old API does not maintain the permanent registration ledgers. Any failure after stopping the API leaves it stopped. Use `--resume` only with the same compatible candidate and revision; it revalidates all proofs before continuing. If an old API container has run or been recreated after the fence, recovery stops it and requires explicit ledger reconciliation. Never manually restart the old API after the migration.

The durable host fence is `/data/coolify/services/eupquokyj7qegufqvqkjmuyr/.live-registration-rollout.json`. It contains only identifiers, source/schema hashes, state, and container identity snapshots. Do not remove it to bypass a failed precondition. Existing accounts and assigned packages are retained. Historical real IPs that were never recorded cannot be reconstructed; browser installation IDs also cannot identify physical hardware after storage is cleared.
