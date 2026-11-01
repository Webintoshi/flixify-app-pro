# Live source repair — 1 November 2026

The owner reported eleven Turkish stations failing and requested complete TRT 4K removal. A fresh owned-line catalogue contained 15,800 provider rows. The line was active with zero of one connections before sequential measurements. Original entry requests used the approved viewer location; the provider-issued HTTPS redirect was decoded in the existing bounded Türkiye bridge. No streams ran in parallel.

The main reproducible failure was codec compatibility, not universal HTTP unavailability. TRT 1 source 150 decoded H264/MP2, but the production website received audio/mpeg and deliberately stopped before a picture. Other affected sources likewise used MP2. Channel 111 also took14.38 seconds for its first decoded frame and later timed out. No HTTP-unavailable evidence was invented.

## Applied central source selection

| Station | Selected provider ID | Measured video/audio | Browser click to picture |
| --- | --- | --- | --- |
| TRT 1 |141|H264/AAC,1920×1080,50fps|1018.6ms|
| Kanal D |138|H264/AAC,1920×1080,50fps|1360.1ms|
| NOW |139|H264/AAC,1920×1080,50fps|1437.5ms|
| 360 |144|H264/AAC,1920×1080,50fps|1334.9ms|
| Kanal 7 |147|H264/AAC,1920×1080,50fps|1721ms|
| Beyaz TV |142|H264/AAC,1920×1080,50fps|1353.9ms|
| DMAX |258|H264/AAC,1280×720,50fps|1669.7ms|

Provider quality labels did not reliably describe the media: selected entries labelled4K actually decoded as1080p. DMAX uses the working AAC720p alternative because inspected1080p copies use MP2. Website measurements used its existing requestVideoFrameCallback instrumentation, with readyState4, progressing time, positive dimensions and no media error. These are bounded observations in one browser, not a universal three-second SLA or long-term stability guarantee. No physical Android TV measurement was made.

Existing migration 202610310003 supports truthful owner-requested source removal. One guarded transaction inserted 26 origin-scoped owner rows, with null HTTP-failure/control fields, preserving the original information channel 1256041 exclusion and all other data. Rejected IDs:

81,102,105,106,109,111,114,117,118,130,131,149,150,152,155,158,161,162,163,166,168,171,172,176,191,259.

TRT 4K 81/149 is removed; TRT 1 variant 141 remains. NOWTV and Kanal360 duplicate aliases are also suppressed. Current curation selects all seven measured winners, total visible 12680→12677, Turkey 805→802. Other removed IDs were hidden variants rather than 26 distinct stations. Current web and installed APK 1.4.4 consume the same revisioned exclusion policy, so no APK/release/container restart was required. Open sessions need a policy refresh or application reopen. Raw provider metadata remains intact.

Plan SHA256: 49c5c22d3561d4021431f88b36ea9669f10454a5f2f2fe3e8916e807488a6581. Independent review checked final catalogue/codec hashes, winner observations and actual shared curation. Protected web/API/worker/DB identities, environment bytes and permanent registration fence were identical before/after. Payments and provider accounts were unchanged.

## Unresolved provider sources

TLC 257, Teve2 (129/159/173), tv100 234 and Flash Haber 225 still supply MP2 in all inspected Turkish alternatives; tv100 175 timed out twice. Explicit HLS checks for 257/129/234/225 also returned MP2 and did not solve browser audio compatibility. Unrelated foreign-language channels were not substituted, and no unverified feed was promoted. These four need a compatible H264/AAC provider source or a separately implemented authenticated audio-conversion path; they are not claimed fixed.

The new isolated codec helper reports upstream codec/resolution/FPS plus real video/audio decode evidence through a 15 second bounded process. It does not produce exclusion proof. Nine offline tests passed. All owned test streams were closed, provider active connections returned to 0, and the transient decoder units were absent after verification.

One existing favorite referenced old source118. Its current origin/source-version eligibility could not be verified using the real account context under a read-only session, so its stored row was left untouched. No account library rows were updated or deleted. A favorite tied to an explicitly retired source may need re-adding to the new source.
