# Embedded Checkout API and SDK correction

The adapters retain the reviewed package compiler and image transaction. Runtime scope is exactly two API leaves (`stripe-billing-routes.ts` and `stripe-billing-api.ts`) and one existing website component (`components/ui/package-checkout.tsx`). The API permits only four literal `embedded` → `embedded_page` replacements. The website permits only the SDK method and script URL replacements. Other source, dependencies, public files/APKs, environments, registration fence and database remain protected. The website compiler validates generated Next artifacts; it does not claim byte reproduction of nondeterministic Next build output. The API still reproduces the immutable source's original compiled bundle before overlaying the two leaves.

Run `python3 coolify/releases/2026-11-01-packages/test-embedded.py` offline. Build both candidates before publishing; the build preflight requires the original published packages images to remain live. Replace `REVISION` below with the exact committed 40-character payload revision. Both tags use its first 12 characters.

```sh
python3 coolify/releases/2026-11-01-packages/build-web-embedded.py /path/to/checkout --revision REVISION --protected-api-tag flixify-api:packages-8fa66d103053-20261101 --protected-api-id sha256:4771d67755e1e5aef3e55eb53e27574ca70fdbab777ac8703a0543c224bb026b --source-untouched-sha256 6608d5e01ad2f1015681cb5444cb7ed083619832698917e6af9dcaa9a9ad853c --source-untouched-files 18259 --build
python3 coolify/releases/2026-11-01-packages/build-api-embedded.py /path/to/checkout --service api --revision REVISION --source-pin /tmp/flixify-packages-source-pins/embedded-api-source-pin.json --build
```

Omit `--build` for read-only preflight; use `--verify-existing` for a candidate already built. API verification repeats the original bundle reproduction, bounded overlay compilation and offline candidate billing regressions. Both builders retain the 8 GiB disk floor and 1280/1536 MiB network-isolated compiler.

Publish the website first, then the API. Supply the exact independently verified candidate IDs. Every release is read-only without an action flag. Run read-only preflight, then `--apply` (image metadata only), then `--recreate` (only the selected service). `--rollback` restores only that service's original packages image. Both transactions retain the existing exclusive release lock and original completed registration fence with API ID `249006…`; the hotfix source API `4771…` does not replace that proof.

```sh
python3 coolify/releases/2026-11-01-packages/release-web-embedded.py --revision REVISION --candidate-id WEB_CANDIDATE_ID --protected-api-tag flixify-api:packages-8fa66d103053-20261101 --protected-api-id sha256:4771d67755e1e5aef3e55eb53e27574ca70fdbab777ac8703a0543c224bb026b
python3 coolify/releases/2026-11-01-packages/release-api-embedded.py --service api --revision REVISION --candidate-id API_CANDIDATE_ID --protected-web-tag flixify-ops-web:embedded-page-REVISION12-20261101 --protected-web-id WEB_CANDIDATE_ID
```

API release requires the same-revision website correction with exact tag/ID, current website base label and immutable layer ancestry. Current worker `9db57cd7…` remains pinned through both transactions. There are no schema, provider, financial-record or environment mutations in these tools.
