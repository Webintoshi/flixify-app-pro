# Android TV direct playback and channel artwork

User direction: retain the approved cinematic Android TV theme, show live logos horizontally, open playback directly from any card, and put favorites in the player. This is a targeted correction to the existing native Java app; package, account rules, provider routing, color constants, poster cue and decoder settings stay unchanged.

Live cards use a landscape logo area with FIT_CENTER and breathing room, including live items in Favorites. Movie/series artwork keeps the existing portrait treatment. Mixed Favorites give live cards a compact full-width row with16:9 logo on the left and title on the right, so GridLayoutManager cannot stretch artwork to match a portrait neighbor. Existing virtualized grids, focus sound and return focus remain.

Card OK launches PlayerActivity immediately. LIVE/MOVIE go through the existing playback authorization. SERIES resolves its verified scoped episode list inside the player, choosing the latest available saved episode, otherwise first unwatched episode, otherwise the first episode for replay. No extra detail/watch confirmation. A compact episode panel in the player retains season and episode selection.

The player gets a heart action using the existing repository favorites API. Episodes favorite the parent series. Saving cannot recreate the engine, bypass access checks or accept callbacks for a prior account/item. Returning to Favorites reloads it and restores a sensible nearby focus if the removed card disappeared. Existing two-second control hiding remains.

Approach: change existing native activities/repository instead of a parallel screen or web wrapper; this preserves the tested remote and playback lifecycle. The user gave concrete corrections and previously delegated design details, so no additional design approval loop is needed.

Design read: television catalog for remote users, existing cinematic visual language, ENERGY2/RHYTHM2/MOTION1. Wider live cards communicate logo identity; the heart and episode icons match existing compact player tools. No palette or decorative additions.

Verification: real Android emulator remote actions with offline scoped fixtures, repository selection tests, measured compact layouts, existing playback/next-episode regression suite, optimized build and same signing certificate. No customer/provider stream is opened. Publish a compatible immutable APK1.3.1-test.1/code6 from the existing website download descriptor. Pending reviewed website changes may share one guarded web-only publication; API/worker/DB remain pinned.
