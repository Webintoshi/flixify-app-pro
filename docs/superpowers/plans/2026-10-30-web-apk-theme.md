# Website APK Theme Implementation Plan

**Goal:** Apply the approved homepage/player/live concepts with the exact native APK palette to the existing website, preserving business and playback policies.

**Architecture:** Shared global TV palette, current scoped CSS modules, small existing React composition changes. Existing provider/session/media ownership remains; guarded web-only immutable-image rollout.

**Spec:** `docs/superpowers/specs/2026-10-30-web-apk-theme-design.md`.

- [x] Root: global palette aliases/PWA color and account/anonymous palette alignment without form or business changes.
- [x] Browse worker: shell, actual-artwork cinematic hero, catalogue rails, poster focus/hover and responsive category/search/detail styling.
- [x] Live worker: landscape channel logos and approved live layout, player favorite/guide slots, actual EPG and preserved2second hide tests.
- [x] Root: VOD header/title/timeline/compact controls, actual favorite owner and episode drawer styling; test keyboard close/focus before changing it.
- [x] Release worker: exact final source allowlist, unchanged public tree/APK, pinned current web84942fb5, protected services and bounded compiler/rollback checks.
- [x] Root: appropriate UI/session/policy tests, TypeScript and actual browser desktop/mobile/tablet QA with local fixtures/public QA clip only. Compare accepted concepts and actual final screenshots using view_image; resolve material mismatches.
- [x] Freeze/push verified source, read-only production preflight, candidate build/public-tree/runtime checks, dry run and scoped web rollout.
- [x] Independently verify public screens/APK links and protected services, record acceptance, close owned QA processes/tabs and push final documentation.

Implementation intentionally uses real catalogue content rather than the concept's fictional sample titles or unavailable watch-history rows. Any other material departure needs evidence and resolution before publication.

## Acceptance before release

- Nine rendered React test files:83/83 pass. Existing Node policy checks:82/82 and legacy-adapter checks40/40 pass with their appropriate Node/tsx runners. TypeScript passes.
- Release guards:356/356 pass, including51APK-theme scope/public-tree/layout cases. Runtime manifest20files, tests4files; no native/public/backend/worker/provider-policy edits.
- Actual browser QA used local-only fake provider/account/catalogue/EPG plus official W3C Sintel clip. Film and series playback, seeking, speed, favorites, episode switch, Escape/focus return, LIVE playback, guide and filters checked. Desktop1280, tablet768/1024, mobile320/390 checked for overflow. No customer IPTV line was opened.
- Accepted concept and actual homepage/LIVE/VOD captures visually compared. Real content replaces illustrated samples; unavailable catalogue resume history/backdrops are not fabricated. Hero action remains the existing detail flow.
- Guide pointer activation leaves page scroll anchored; semantic automation activation can itself scroll targets, so direct pointer verification was used. Long hero title descenders and primary-button contrast corrected.

## Live acceptance —2026-10-30

- Deployed frozen application revision: `5f80143868331d37edb56323bddcdabddb8fdefd`.
- Current web tag: `flixify-ops-web:edge-recovery-5f8014386833-20261026`.
- Current web image: `sha256:58b46c80e4579be67f8adfe2666d835f533d616ab57f7ce3ed9ac98215992afd`. This was read from the owned verified candidate artifact for deployment.
- Prior rollback image: `flixify-ops-web:edge-recovery-6491e529c6d0-20261026` / `sha256:84942fb59d00e681d4edef6258693da502dfc988ae9da4c25e50d011c9a2e4e5`.
- Bounded network-disabled compiler and candidate public-tree/config/ancestry checks passed. Dry run, image sync and web-only recreate succeeded; independent postcheck confirms all four services running, protected API/worker/DB exact images and restart counts unchanged (all0). No owned build container remains;15.74GiBfree.
- Public `/`, `/filmler`, `/diziler`, `/canli-tv`, `/favoriler`, `/ayarlar`, `/indir` return200withPWAcolor#07090c. Browsercomputedpalette exactly#07090c/#13171e/#ff3545. Real authenticated home/catalogue and37listedlivechannelbuttons rendered without alerts/overflow; zero video elements on production checks.
- APK1.3.2 remains1321719bytes, SHA256`3472dd34ab96c121310f55ef9380af5cdf14899cf1bfc1ec458411f7bcd36c86`; HTTPRange206.
- Provider items without usable image URLs retain honest title/icon fallback; no invented artwork was added.
- Owned local fixture ServiceWorker unregistered through cleanup UI; QA tab closed and only owned Node/Next processes stopped. Viewport override reset. Public site tab remains as deliverable.
