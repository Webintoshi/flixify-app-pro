# Live channel policy implementation plan

> **For agentic workers:** implement the reviewed channel-cleanup subtask under the parent task; the parent owns integration and deployment.

**Goal:** Remove only repeatedly confirmed unavailable provider channels from presentation without destroying provider records, favorite identities or working-channel availability.

**Architecture:** A source-origin-scoped exclusion table supplies an optional bounded bootstrap policy. A sequential operator audit records decoded-frame timing and repeat 404/410 evidence with a healthy control channel; applying the report is a separate explicit action. Transient, authentication, geography and connection-limit errors never create exclusions.

**Tech stack:** Existing TypeScript/PostgreSQL API, Python standard library operator tool, existing ffmpeg executable. No dependencies.

**Contract approved by parent:** `livePolicy: {revision: string, excludedIds: string[]}` attached to the already-authorized provider session. Canonical HTTPS origin, up to 50,000 strict decimal IDs, deterministic revision independent of `sourceVersion`. Query failure returns no new policy and a sanitized warning; consumers preserve their last valid policy.

- [x] Write policy validation, origin isolation, stable revision and sanitized query-failure tests; observe failure before implementation.
- [x] Implement the pure policy builder and database loader; provide the parent with the tiny route hook without editing shared `server.ts`.
- [x] Add a restricted migration recording only repeat hard-unavailable evidence and proof hashes; retain provider/favorite data.
- [x] Write operator tests for sequential probes, healthy controls, repeat hard failures, ignored transient responses, checkpoint identity/resume, proof validation and dry-run SQL application; observe failure before implementation.
- [x] Implement the bounded scanner and separate SQL apply mode, run focused and API suite checks, and report remaining limits to the parent. No live probes or database mutation from this subagent.

Evidence: 26 focused API-policy tests and 20 operator tests pass. New-policy assertion RED was observed after minimal scaffolding; subsequent operator RED cases covered equal User-Agent, single working connection, actual-frame proof, bounded child output, the exclusive line lock, TS-fails/HLS-works protection and event-only protection. Full API suite passed 352/352 after rerunning with the newly required registration guard fixture. Typecheck has the same 79 pre-existing diagnostics and zero in the new policy module after its explicit row annotation. The initial child API invocation lacked `REGISTRATION_GUARD_SECRET` and failed setup; the corrected invocation is the acceptance run. Parent owns route integration, production rollout and real-media validation.

The parent then measured browser TS startup around 1.4–1.6 seconds against a roughly 10.4-second HLS manifest response. The operator therefore prefers TS only for missing provider formats, preserves declared formats, and requires two failures plus same-format healthy controls for each of TS and HLS before producing a global exclusion. Earlier single-format proof is rejected. Event-only names remain proposal-only. This transport guard changes only the operator and its tests, not the API policy format or migration.
