# WhatsApp-only new registrations

API source44ff and WEB source6e444af are pinned. API changes come only from the actual-image three-file recipe; the complete local server/repository are never overlaid. Only two frozen WEB files remove anonymous signup fallback. Contracts, dependencies, downloads, OTP UI, settings, existing account-code login, sessions, packages and trials stay outside the source changes.

The additive migration creates two nullable users columns and validated constraints, with no defaults or historical backfill. Existing `users.created_at` remains the registration date. Original method/platform are written only for a newly created phone account, never for later binding or login. Historical unknown provenance remains unknown.

All candidate builds are network-isolated and reuse pinned88 compiler/snapshot guards plus673's post-compile `.next/cache` removal. CPU/memory/PID limits remain. Both candidates and their preserved-source proofs must pass before schema/cutover. API smoke in isolated demo mode checks410 legacy signup and401 valid missing-code login. Live checks send only empty bodies for410 signup/400 login validation and GET phone status; they never try real registration, OTP or a syntactically valid account code.

```sh
python3 coolify/releases/2026-11-08-whatsapp-only/build.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --manifest coolify/releases/2026-11-08-whatsapp-only/manifest.json --work-dir FRESH_PRIVATE_DIRECTORY --build
python3 coolify/releases/2026-11-08-whatsapp-only/release.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --manifest coolify/releases/2026-11-08-whatsapp-only/manifest.json --api-proof BUILD_DIRECTORY/api-proof.json --web-proof BUILD_DIRECTORY/ops-web-proof.json
```

Defaults are application-read-only. Run `--schema`, `--apply`, then `--recreate`: one bounded additive migration, two image-tag metadata changes, API health/policy validation, then WEB. Every environment row and exact `.env` bytes are protected. The metadata transaction writes only API/WEB tags and generated compose; no environment file is generated. Worker/DB/bot and other project containers are checked before and after. The bot's raw source/inode/mode/owner are protected too.

There is no old-API rollback: restoring44ff would reopen anonymous signup. `--rollback-web` retains the closed API and restores only the prior WEB. If the new API is unhealthy, stop and repair a policy-closed candidate. Never drop provenance columns or restore anonymous signup as recovery.

After API and WEB are running, root constructs a private bot candidate with the exact reviewed renderer patch. The live bot is raw SHA8146bbfe48be7ac4c053d348d9963181a8715dd2164afb8caaf8e78f0a704a4d, including CRLF; candidate is7053b1c96b62417f8db532871bfca2d28630ec20c8850566d7d26f2649000d70. Neither complete private script belongs in Git.

```sh
python3 coolify/releases/2026-11-08-whatsapp-only/bot-release.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --candidate PRIVATE_CANDIDATE.mjs --api-proof BUILD_DIRECTORY/api-proof.json --web-proof BUILD_DIRECTORY/ops-web-proof.json
```

Default runs the frozen bot helper's isolated syntax/factory checks only. Append `--apply` after preflight; an optional `--probe-image-id sha256:FULL_ID` must match the live bot's Node version. Only the exact existing bot restarts. Its inode, owner/mode, administrators, state, notification journal/cutoff/acknowledgements and other services remain protected. No synthetic Telegram message is sent. Successful bot restart updates only its explicitly authorized lifecycle/source checkpoint in the policy journal, so later WEB-only rollback remains possible. A verified automatic restore records its new lifecycle too; a foreign change is never adopted.

The bot wrapper uses the mature registration notifier deployment helper by verified Git digest. It does not execute or import the full private bot for preflight. A failed script write is restored through the held inode; original bytes live only in helper memory. Normal bot polling may process its existing pending notifications after restart.

Local tests and syntax are necessary but not live-deployment evidence. Root must validate actual-image patching, read-only PHP preview, migration, image identities, live closed-signup response, existing login behavior and bot heartbeat/journal.
