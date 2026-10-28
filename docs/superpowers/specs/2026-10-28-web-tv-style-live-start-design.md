# Web TV style and live startup

The user requests faster live channel opening and the website's presentation to match the existing Android TV application they explicitly approved. This is an adaptation of that accepted design, not a new site or a new visual concept. Continue directly under the existing implementation/publication authorization.

## Intent and constraints

- Existing website, repository, branch and deployment; no separate preview hosting.
- Preserve each existing web surface's exact palette variables. Native geometry/materials are the reference; native accent must not replace the web accent.
- Preserve registration, login, subscriptions, favorites, series/episode semantics and provider routing.
- Keep the live website's useful player-left/channel-directory-right arrangement; mobile stacks naturally.
- No new dependencies, provider requests from the server, cancelled relays, credentials, API/worker/DB/server changes.
- Avoid disruptive tests against customer streams. Measure deterministic local playback startup and request counts; accurately distinguish this from real-provider first-frame latency.

## Agreed design direction

Use the native app's open artwork layout, quiet glass capsules, icon-and-label desktop rail, restrained outlines, strong visible keyboard focus, large titles and round unobtrusive tools. Keep expanding poster previews. Category selection becomes a usable side drawer with finder, counts and selected check; search becomes a focused panel with a local preview. Adapt touch, pointer and keyboard inputs for the web rather than emulating TV key handling on desktop. Preserve scroll/focus ownership, safe-area padding and reduced motion. Account and anonymous landing surfaces adopt the same geometry without changing their workflows or claims.

Considered approaches: a separate new web shell would duplicate established behavior; CSS-only changes would leave the currently unused category component invisible. Selected: adapt the existing AppShell, integrate real catalog panels and restyle isolated route modules. Existing accepted Android TV screenshots and components are the production reference; no generated replacement concept is needed.

## Live investigation and fix boundaries

Read-only tracing found each personal live selection refreshes bootstrap and forces the entire live catalog download; LiveVideo then requests playback a second time on its initial start. Android retains fresh entitlement validation while reusing the source-scoped live catalog. Adopt that verified distinction for web, retain refreshed data on reconnect, and invalidate on account/source/expiry changes.

The current web watchdog can recover after eight seconds before any first frame; native distinguishes a thirty-second initial preparation allowance from twelve-second established stalls. Add the same distinction using observed media progress and test timers/cancellation. Check browser-native HLS before loading an unnecessary JS engine. Do not shrink buffers without evidence.

## Verification and delivery

Meaningful regression tests for duplicate startup I/O, eligibility/source changes, first-frame grace and established recovery; existing session/player regressions. Real rendered home/catalog/search/categories/live/account/landing at desktop/tablet/mobile, keyboard dismissal/focus return and poster hover. Offline fixture API only on a private local QA origin, never bundled or deployed. TypeScript, bounded web compilation, independent review, exact web-only runtime allowlist, protected API/worker/DB identities, fresh disk floor and public browser/HTTP checks. No unsupported claim of provider-wide startup time.
