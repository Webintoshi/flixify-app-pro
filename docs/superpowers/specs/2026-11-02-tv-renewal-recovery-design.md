# Android TV expired-access recovery

The reported APK leaves an inactive account on Home with “İzleme erişimin şu anda açık değil.” and only “Tekrar dene”. Native catalog callbacks treat INELIGIBLE as a generic content error; initial welcome completion and resume refresh can also load catalogs before account access is resolved. The user wants package choices instead of this dead end. Existing instructions delegate implementation choices and authorize updating the current product.

## Decision and scope

A redirect to Account would expose the existing website link but still hide the available terms. Opening a browser automatically would interrupt TV navigation. Implement native package choices using the existing Android theme, followed by an explicit website handoff. The screen shows the existing 1/6/12-month packages and one/two simultaneous-user selection. Prices and sale availability come from the existing public catalog; no new subscription, trial or discount rules are introduced.

Keep the existing dark cinematic background, typography and visible remote focus. Three term cards compare the actual purchase choices; a restrained existing red accent marks the selected action. Compact layouts scroll vertically instead of clipping controls. Design dials: energy 2, rhythm 1, motion 1. No invented content totals or new visual assets.

## Account authority

Resolve the authenticated account before loading an inactive user's catalog. Preserve `/me` status, subscription, assignment, deadline, access-history and trial state sufficiently to distinguish expired/no-plan, blocked, provisioning and service failure. Confirmed expired/no-plan accounts enter package recovery directly. Blocked accounts retain support/account handling. Active subscriptions with an unavailable provider or unassigned link must not be labelled expired or told that buying another package fixes service. They retain an explicit package-navigation option alongside the correct status/retry action.

HTTP 401 remains authentication; generic provider 403 is not proof of expiry. Network, malformed and server failures retain retry and the last authoritative state. Access refresh must be scoped to account/lifecycle independently of catalog rendering generation. Old-account callbacks cannot reopen a screen or overwrite a newer status. Inactive navigation never starts a catalog retry loop or authorizes cached playback.

## Package and payment flow

Fetch `/admin/packages/public` without a provider lease. Recognize the six existing canonical package slugs, active status, term and bounded valid price labels. Display loading, retry and unavailable states honestly. Preserve first-user welcome campaign eligibility and its separate monthly offer; expiration never grants a fresh discount.

A selected regular package opens only `https://flixify.vip/paketler?users=1|2&plan=<canonical-slug>&from=android_tv`. No account code, token or provider credential enters an Intent or URL. Existing welcome links remain separate. If no TV browser exists, provide the existing phone/same-account instructions. Returning from payment re-fetches authoritative access; an Intent return or Stripe completion alone never unlocks viewing.

The web page validates the selected plan and user count, then focuses its existing purchase control once after catalog loading. Unknown, inactive, mismatched or arbitrary values are ignored. It never starts checkout automatically, changes prices, changes offer eligibility or overrides subsequent user choices.

## Delivery

Publish APK 1.4.9/code17 with the same installed signer and Firebase configuration. Retain all old installers and the entire existing web/API/worker/database configuration. Only the accepted new APK, TV manifest/download descriptor and narrow web plan-focus changes are published through a new guarded web-only release profile. No provider stream or real payment is opened during verification. Use offline repository/UI fixtures, emulator remote navigation, a browser-Intent interceptor, and controlled activation responses.
