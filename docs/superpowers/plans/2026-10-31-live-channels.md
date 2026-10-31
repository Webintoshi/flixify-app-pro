# Live availability and startup implementation

**Goal:** Remove confirmed unavailable channels from the published catalog and reduce measured click-to-first-picture latency across web and Android TV.
**Spec:** `docs/superpowers/specs/2026-10-31-live-channel-design.md`

- [x] Map personal catalog and playback paths, existing health limitations, prior source measurements and actual production versions.
- [ ] Establish an idle test line and measure bootstrap, source/manifest/fragment and first frame through the actual HTTPS delivery path.
- [ ] Reproduce the demonstrated delay and add targeted regression tests before its minimal fix.
- [ ] Add a central source-scoped exclusion policy and resumable, sequential, evidence-backed operator scan with safe error classification.
- [ ] Integrate policy into current/cached catalogs, favorites and play selection in web and APK; preserve source/favorite identity and existing UI.
- [ ] Run justified tests and physical-browser media measurements; sign/publish an APK if native code changes, and deploy guarded overlays to the existing services.
- [ ] Report scan coverage and exact removals, first-picture measurements and remaining external limits; clean owned diagnostic streams and access.
