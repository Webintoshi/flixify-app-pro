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
- [ ] Freeze/push verified source, read-only production preflight, candidate build/public-tree/runtime checks, dry run and scoped web rollout.
- [ ] Independently verify public screens/APK links and protected services, record acceptance, close owned QA processes/tabs and push final documentation.

Implementation intentionally uses real catalogue content rather than the concept's fictional sample titles or unavailable watch-history rows. Any other material departure needs evidence and resolution before publication.

## Acceptance before release

- Nine rendered React test files:83/83 pass. Existing Node policy checks:82/82 and legacy-adapter checks40/40 pass with their appropriate Node/tsx runners. TypeScript passes.
- Release guards:356/356 pass, including51APK-theme scope/public-tree/layout cases. Runtime manifest20files, tests4files; no native/public/backend/worker/provider-policy edits.
- Actual browser QA used local-only fake provider/account/catalogue/EPG plus official W3C Sintel clip. Film and series playback, seeking, speed, favorites, episode switch, Escape/focus return, LIVE playback, guide and filters checked. Desktop1280, tablet768/1024, mobile320/390 checked for overflow. No customer IPTV line was opened.
- Accepted concept and actual homepage/LIVE/VOD captures visually compared. Real content replaces illustrated samples; unavailable catalogue resume history/backdrops are not fabricated. Hero action remains the existing detail flow.
- Guide pointer activation leaves page scroll anchored; semantic automation activation can itself scroll targets, so direct pointer verification was used. Long hero title descenders and primary-button contrast corrected.
