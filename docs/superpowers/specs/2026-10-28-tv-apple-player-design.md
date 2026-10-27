# Apple TV reference for Flixify native TV

The user rejects the oversized permanent text tile player and explicitly requests web research and a close Apple TV UI adaptation. Design choice and implementation are already delegated; continue directly.

## Reference
Apple official tvOS 26 player demo, viewed at 4/6/8 seconds: https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/ . Explicit player guide: https://support.apple.com/en-euro/guide/tv/atvb7944597f/26/tvos/26 . Android controls: https://developer.android.com/training/tv/playback/controls .

## Presentation
Native full-screen video. Bottom chrome uses a shallow transparent scrim, small episode line above large left title, compact circular subtitle/audio/next icons right, a thin real focusable seek track, elapsed/remaining labels, and a small lower transport capsule. No screen-wide weighted text action tiles. Turkish accessibility descriptions and a single focused-action caption remain readable. Focus changes paint only, never geometry. Next episode countdown is a compact right card above chrome, not a full-width row. Track choice is a native compact right-side glass panel with real remote focus and dismiss restoration.

Apple layout is the reference; transport icons replace Apple's Info/InSight pills because those specific features are not available in Flixify. Do not add nonfunctional Apple features or claim Apple runtime Liquid Glass; API23-compatible translucent native gradients approximate the visual language. Keep Flixify exact base colors #07090C #13171E #FF3545 #F5F6F8 #A7B0BE.

## Behavior and scope
D-pad center toggles playback while chrome hidden; up/down reveal without pausing; left/right skip 10 seconds (live zap). Explicit traversal reaches all visible icons, timeline and countdown. Controls hide after 2000 ms playing, stay during pause/options/countdown. Preserve actual ENDED five-second successor policy, cancellation, access/source/cutoff, release-before-next, warm live cache and first-frame watchdog. Native Java/API23+, no new dependencies, same package/signature. Browse rail/hero/artwork receives related restrained presentation refinement; account/signup/business logic unchanged.

## Verification
Use fixture accounts/engines and official local sample only, never customer/provider streams. Verify compact stable geometry, initial/560x320 layouts, visible/hidden actions, focus traversal and panel return, center toggle, two-second hide, continuation, then all existing tests and lint. Inspect actual native screenshots at normal/compact/large sizes before signing. Bump versionCode and publish compatible immutable APK through existing homepage download route; web-only deployment must preserve API/worker/DB.
