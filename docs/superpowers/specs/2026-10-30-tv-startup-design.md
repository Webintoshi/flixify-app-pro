# Branded Android TV startup

User explicitly requests the existing Flixify logo, Yükleniyor… and spinner over initial loading to avoid blank screens; this clear instruction authorizes implementation/publication without another design choice. Existing native Java/API23+ app, palette/player/remote/access behavior retained.

Use a MainActivity-only launching theme with branded starting-window drawable on API23–30 and platform splash attributes on31+, then a small in-app full-screen overlay over the actual target screen. No separate SplashActivity or new dependency. The wide logo stays unmodified; platform masked icon uses existing square icon. Overlay yields on the first pre-draw of a valid rendered catalog (including empty), login, completed account or error/retry surface. Artwork completion is not a readiness gate. No artificial3–5second wait: actual load determines duration; cache hits proceed immediately. Back exits pending startup, navigation cannot activate hidden controls; underlying focus is retained.

A permanent delay was rejected because it would slow verified warm-cache opens; a separate Activity would duplicate launch/back lifecycle. API-specific theme plus an overlay covers both earliest window and real asynchronous preparation. Pending callbacks/frames must not dismiss a replaced/stopped screen. Completed startup is saved across recreation; subsequent refresh/navigation/player/settings return does not show the overlay.

Release1.4.1/code9 retains package/signer/minAPI23. Immutable APK/new shared download descriptor, update existing staticAndroid manifest. Publish web-only over current38b22d4/image6cbd625... with all existing protected service/disk/cgroup/source/public-tree guards. No provider media tests, backend/bot/edge changes, or unrelated cleanup.
