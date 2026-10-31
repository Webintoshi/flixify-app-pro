# Live availability and startup implementation

**Goal:** Remove confirmed unavailable channels from the published catalog and reduce measured click-to-first-picture latency across web and Android TV.
**Spec:** `docs/superpowers/specs/2026-10-31-live-channel-design.md`

- [x] Map personal catalog and playback paths, existing health limitations, prior source measurements and actual production versions.
- [x] Establish an idle owned test line and measure bootstrap, source/manifest/fragment and first frame through the actual HTTPS delivery path.
- [x] Reproduce the demonstrated delay and add targeted regression tests before its minimal fix.
- [x] Add a central source-scoped exclusion policy and resumable, sequential, evidence-backed operator scan with safe error classification.
- [x] Integrate policy into current/cached catalogs, favorites and play selection in web and APK; preserve source/favorite identity and existing UI.
- [x] Run justified tests and physical-browser media measurements; sign/publish an APK if native code changes, and deploy guarded overlays to the existing services.
- [ ] Report scan coverage and exact removals, first-picture measurements and remaining external limits; clean owned diagnostic streams and access.

The first 60-channel cohort decoded 57 channels. Channels 125/145/390 repeatedly timed out in TS, then returned top-level HLS503 while ATV90 returned HLS200 and decoded TS before/after. They remain unverified, with zero automatic exclusions; transient503 is not permanent-unavailability proof. No dedicated maintenance line exists in the inspected 66-line provider list. The user's choice of a dedicated free maintenance trial versus continued use of the one-connection owned line remains pending; no new line was created.

API lifetime registration and policy schema are live at8645860. Native1.4.2/code10 is signed, upgrade-tested and publicly available; website/APK publication4088223 passed bounded compilation and public HTTP contracts. Its first release preflight stopped before mutations because the stable key added to shared`.env` changed the calculated web environment. The reviewed40-test follow-up66b4ed0 isolates that key with explicit empty overrides on non-API services. Website-only recreation and independent acceptance passed; API/worker/database runtimes and`.env` bytes remain unchanged. Actual production click-to-presented-frame observations were2,129.9ms ATV,1,257.1ms Show TV and1,955.1ms beINSPORTS1 FHD. All streams were closed; final provider connections0. These individual samples are not a universal3-second guarantee. Full-catalog scan/cleanup remains pending the dedicated-line decision above.
