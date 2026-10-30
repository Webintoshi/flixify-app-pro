# Approved APK-style website

User approved the three generated homepage, web player and live-TV concepts, then explicitly requested implementation and colors matching the native APK. This new color instruction supersedes the earlier website-color lock. Build inside the existing Next.js application and deploy through its existing Coolify service only.

References under the task's generated-images directory: homepage `exec-08175a8d-cf43-4f3b-92e8-04fcc117f398.png`; player `exec-551ca41a-5c91-42f6-bb39-ce6f90ccb137.png`; live `exec-75cc6da3-3fa9-4965-a7ad-1b087e303e40.png`.

Color system comes directly from native TvUi: background#07090c, panel#13171e, accent#ff3545, primary#f5f6f8, muted#a7b0be, primary12%line. Existing semantic success/error colors may retain their meaning. System typography, thin existing glyphs, neutral glass selection, image-led composition and restrained motion remain coherent (energy2/rhythm2/motion1).

Homepage/catalog: quiet190–220px rail with existing navigation; header search/account and compact APK link; seamless large actual-artwork hero, typography on a directional dark edge fade; landscape showcase rails and portrait film/series posters with existing hover/focus expansion. Keep real title/artwork/category information, existing common daily rotation and search/category intersection. There is no catalogue-wide resume feed or backdrop field: do not invent watch history/progress or fictional content. Existing hero/detail action retains its actual meaning, even where the illustrative concept says Oynat.

VOD: full-viewport actual video, discreet top brand/back, title and episode information near the bottom, thin seek line/time labels and compact circular utilities. Mouse/keyboard play, seek, volume, speed, fullscreen, captions and episode selection remain usable. Favorites use the actual parent movie/series owner; no fake track choices. Existing side episode panel uses real season/episode data and series artwork; selected mark and keyboard close/focus restoration. No autoplay, access/admission, retry/buffer/source/routing changes.

LIVE: preserve player-left/channels-right desktop layout; stack on mobile. Channel logos landscapeFIT_CENTER, not movie posters. Existing tabs, country/category/search, selected channel and recent history continue. Favorite only inside player; actual EPG below and accessible from an in-player guide. No fake football footage/programmes/counts in production, no live seek/DVR controls. Existing2second hide behavior and source/expiry/reconnect logic remain.

Mobile320px+, tablet and desktop must retain safe-area spacing, readable text, keyboard focus, all controls and honest loading/error/empty states. Signup, account creation, payment, provider and subscription rules are unchanged. Native APK and all old public files stay byte-identical. Use offline/local QA media and fixtures only; do not open a customer/provider stream. Backend/worker/database/bot/DNS/proxies stay untouched.
