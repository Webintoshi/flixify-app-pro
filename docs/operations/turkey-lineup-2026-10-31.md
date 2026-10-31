# Turkey website channel lineup — 31 October 2026

TRT 1 and Star TV were present, but alphabetical identity sorting placed them at positions 689 and 600 among Turkish stations. The initial directory renders 36 entries, making them appear missing. No provider channel or access entitlement needed removal or recreation.

The website now orders national channels first, using the current Tivibu national directory as its editorial reference: https://www.tivibu.com.tr/canli-tv/ulusal. Channel numbers differ by platform; this is not a claimed universal LCN. News, sports, children, documentary, music, local, continuous themed and radio groups follow. RAW-group fallback TRT 1 is ranked by station identity, not by its transport group. Existing distinct regional and branded 4K feeds stay distinct.

The same order applies before homepage live-rail slicing and before live catalog search/pagination. The recently watched tab keeps watch order. Search normalizes accents, dotless I and spaces, so bein, trt1 and yesilcam match their actual station/group labels. Structured country metadata prevents ALB: Tring Turkish from being incorrectly classified as Turkey merely because its name includes Turkish.

Actual metadata audit: all 12,680 selected IDs and 15,799 canonical aliases unchanged; all 805 Turkish records retained across 17 actual pages. TRT 1 is now #1 and Star TV #7. Existing NOW/Now TV records remain separate under the accepted provider-selection policy; this patch does not change shared-core deduplication. The separate cross-semantic themed-feed identity audit is recorded in local forensic artifacts for a future policy correction.

This is a four-file website presentation patch. Android/native tree, APK 1.4.4, public update JSON, shared policy, provider data, playback engines, API, worker, database and environment remain unchanged. Guarded source/rollback is the live-curation web image 73a348089680a50ec4b341a6ea1586c2399565fe18ad659e158d3519e436ff9c.
