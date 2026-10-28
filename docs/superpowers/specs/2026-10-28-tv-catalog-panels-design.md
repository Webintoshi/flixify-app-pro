# TV search and categories modernization

User asks for modern search and categories in the current Android TV app after approving Apple-style UI and poster sound. Continue directly within delegated design/publication scope. Preserve exact palette, existing query AND category semantics, native TV keyboard, account/playback rules and poster sound. No new site, backend or provider queries.

Search: floating center glass panel, section eyebrow and large title, native rounded editor with search/clear affordance, local debounced result count and up to3sample titles, compact Ara/Vazgeç actions. No draft commit until explicit submit. EditTextDown→Ara, IME_SEARCH submits; Back first dismisses keyboard then overlay. Category: right floatingglass panel, local category finder, virtualized list with quietidle rows, focuscapsule, persistentselectedcheck andper-querycounts, longlabels2lines/ellipsis. Selectedlistinitialfocus, firstrowUp→filter, filterDown→list. Preserve controls/tags accessibility.

API23 JavaViews/no newdeps. Panels must fit normal,560x320 and largefont layouts and remain reachable underIMEresize. Defer Main shellrebuild while overlayvisible; preserve editor/draft. Dialog callbacks capture Page, Catalog,generation,scope and reject stale commit. Dismiss clears onlyownedreference; Cancel restores opener afterstablelayout, Submit follows filteredcatalog. Dialog ownership remains ActivityonStopdismissed. No private/provider/client secrets in screenshots/tests.

Data: local CatalogFilterData matches Turkish lowercase substring with currentcategory; counts all matching titles percategory and allitems, merges/dedupes providercategories plus missingitemcategoryIDs, immutable preview/options. No credential/network work.

References: https://developer.android.com/design/ui/tv/guides/styles/focus-system ; https://developer.android.com/design/ui/tv/guides/components/lists ; https://developer.android.com/design/ui/tv/samples/jet-stream . Use native gradients to approximate glass; no proprietary Apple renderer claim.

Delivery: meaningful data/nativeIME/focus/cancel/stale/longlist/responsive tests; actualnative screenshots; same-signature version1.3.0-test.1/code5; existing homepage/indir immutableAPK with guardedweb-onlydeploy.
