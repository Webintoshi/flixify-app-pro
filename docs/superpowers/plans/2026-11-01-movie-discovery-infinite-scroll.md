# Movie discovery and infinite scroll implementation plan

> For agentic workers: use subagent-driven development for independent curation and infinite-scroll work. Root owns integration review, browser validation and guarded deployment.

**Goal:** Restyle `/filmler` using the existing homepage design, with four ordered film collections and automatic continuation throughout consumer catalogs.

**Architecture:** Reuse the account-owned provider snapshot, existing poster cards, direct-play links and homepage components. Build pure editorial collection selection separately from acquisition; append the remaining catalog in a vertical archive. A shared scoped observer replaces both actual load-more buttons, including the responsive nested live-channel list.

**Stack:** Existing React 19 / Next.js 15, TypeScript, CSS Modules and Vitest. No new dependency.

**Spec:** User confirmed `/filmler` (not `/paketler`). Ordered sections: 2026 films; Marvel collection headed Çok İzlenenler; action films with artwork; fantasy films in the Harry Potter style. No movie Günün Seçkisi. All consumer load-more pagination becomes infinite scrolling.

## Constraints

- Preserve Flixify colors, typography, homepage poster behavior, account rules and payment flows.
- Use actual catalog records only. No invented watch counts or external catalog titles.
- Preserve search/category filters, favorites and direct playback behavior.
- Existing Android TV catalog already scrolls naturally; no APK rebuild is necessary.
- Preserve API, worker, DB identity, environment files, registration fence and APK bytes.
- Build from exact current web image b0def99; compile only the reviewed web leaf allowlist.

## Tasks

- [x] Add pure movie collection matching, release-year validation, artwork selection and identity deduplication, with meaningful regression tests.
- [x] Integrate full owned personal catalog and bounded/cancelled legacy metadata acquisition; reuse the homepage 2026 hero and existing rails.
- [x] Retain all films through a vertical paginated archive. Keep series discovery while making its continuation grow vertically.
- [x] Add scoped infinite-scroll hook: synchronous page latch, confirmed progress, owner reset, stale callback rejection, visibility/modal pause, responsive root and unsupported-observer fallback.
- [x] Integrate consumer catalogs and live list; retain explicit error retry and terminal-page detection. Preserve hover detail actions.
- [x] Run selector, rendered lifecycle, pagination/root and existing catalog/search/payment regression tests. Check web TypeScript.
- [x] Validate desktop/mobile in the browser with isolated fixture data; verify four sections, filters, continuing scroll, loading/error/end states and no horizontal page overflow. Do not start a real provider stream.
- [ ] Measure independent source fingerprints for exact runtime leaves, build one guarded web candidate, publish and verify live browser results. Preserve all unrelated runtime and public files.

## Review focus

- A visible sentinel must not drain a horizontal rail without increasing page height.
- Requested page is not confirmed progress; duplicate observer callbacks must not skip pages.
- Account, policy, kind and filter changes must not append stale records.
- Empty/duplicate responses and stale totals must reach a terminal state; failures must not loop.
- Live desktop and mobile scroll roots differ. Artwork failure must remove/refill curated items without affecting the full archive.
