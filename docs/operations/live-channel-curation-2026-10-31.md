# Live channel curation — 31 October 2026

The live directory now displays one variant per conservative channel identity. Provider country, language, region, channel numbers and distinct station brands remain separate. Names lose transport, resolution and availability decorations. Compatible FHD is preferred; when absent one compatible alternative remains. Branded TRT 4K and unnumbered BEIN Sport 4K remain distinct stations. Resolution follows provider metadata, not a claim of measured stream quality.

Projection is non-destructive: provider IDs, raw cached rows, access policy, playback engines and backend records remain unchanged. Owner exclusions apply before canonical selection. Existing saved IDs resolve to their selected current channel; removing a favorite deletes only its stored aliases, with account-owned requests. EPG uses the selected provider ID. Web and Android use shared conformance fixtures.

The current metadata preview contains 15,799 eligible rows after the pre-existing information-channel exclusion. It selects 12,680 channels and removes 3,119 duplicate variants from presentation: 1,876 labelled FHD, 10,804 fallback. All eligible aliases are covered; independent country collision review found zero collisions. Turkey contains 805 selected channels (85 FHD). ATV selects provider 89; BEIN Sport 1 selects 283; TRT 1 uses RAW 150 because no FHD label exists. No real streams were opened or availability rescanned.

Validation: 171 web tests, 73 focused Node helper tests, web TypeScript and optimized Next build; 58 contracts tests including 44 policy cases. Native: 95 JVM tests, release lint (0 errors, 38 existing warnings), final Live/Favorites remote category regressions, same-certificate 1.4.3→1.4.4 update with installation time preserved and cold launch. An attempted broader 177-case emulator suite was interrupted by an unresponsive owned VM; it is not counted as passing. The VM was stopped and removed.

Android 1.4.4/code 12 retains package vip.flixify.tv, Android 6 minimum, target 35 and the existing installed signing identity. APK SHA256: 1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f; 1,355,944 bytes. Old 1.4.3 bytes remain available unchanged. No third-party APK scan submission is part of this release.

The guarded publication updates only the website image and static APK/update files. API, worker, database, environment bytes and existing empty registration overrides are protected. Source image 943cae is the explicit rollback target.
