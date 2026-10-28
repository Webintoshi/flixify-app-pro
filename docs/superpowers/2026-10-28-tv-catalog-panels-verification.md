# Android TV search and category panels — 28 October 2026

## Scope and implementation
Modernize the existing native TV APK using its approved cinematic design and unchanged palette. Search is a draft-only native editor with a 120ms local preview, total result count and up to three sample titles. Ara commits; cancel/Back restores the opener. Category side panel uses a virtualized ListView, local Turkish-aware finder, matching content counts and persistent selected mark. Existing query AND category semantics and account/source boundaries remain.

MainActivity owns dialog dismissal and captures page, catalog, generation and source before accepting edits. IME/display resize does not rebuild the active editor; pending layout updates run after dismissal. Filtered Home hero now uses a matching result. Logout/exit confirmations retain their existing safe focus. Search/category/refresh toolbar has quiet native icons and focus surfaces.

No dependency, provider, playback, registration, API, bot or server routing change. Palette constants and the exact poster_move.wav asset are retained. API23+, universal APK, version1.3.0-test.1/code5, existing package/signing key.

## Local verification
Four data cases observed RED on a scaffold and GREEN after implementation: Turkish query/category intersection, category counting/dedup/missing category merge, immutable capped preview, empty/uncategorized input. Six new native panel cases cover draft/cancel/reopen/commit, filtered hero, category finder/count/selection, 560x320 usable resize with action fully visible, actual TV IME visibility/Done, stale source and 600 virtualized categories.

Actual native screenshots use offline catalog/account fixtures and only public Flixify marketing artwork, with no customer media. QA found background text bleeding through the initial translucent gradient; panel highlight is now composited over the existing opaque palette surface. Small windows hide optional headings/extra examples and reduce vertical padding. Capture recipe asserts that Ara is fully visible before moving focus. Temporary gallery source is removed from tracked sources and retained under ignored task work files.

Independent source review and guarded release wrapper review are complete; final acceptance and publication details follow after verification.

Final combined suite:31/31 native cases (new panels + MainRemote + Responsive + PosterSound),31/31 unit cases, release lint0errors/27warnings;84seconds. A final scope-visibility threshold change from300to320dp then passed all6panel cases and release lint again,29seconds. It closes a narrow300–308dp action-visibility gap found in independent review. Root also reran all32new release-wrapper tests successfully; audit agent independently ran the broader182release tests.

Actual screenshots inspected at1920x1080/density320/font1.0,1280x720/density320/font1.3 and1920x1080/density240/font1.0. The last configuration reports native1920x1080root/density1.5 and category bounds1314,0,570x1080, respecting the right36px inset. A first capture caught a transient window animation; the settled frame was recaptured and inspected. An attempted3840override still produced a1920physical capture and is not claimed as4K verification. Final artwork is a public marketing fixture, not a customer library. Captures remain in the task visualization directory android-tv/catalog/{normal,compact,spacious}.

Signed APK and production acceptance are pending below.
