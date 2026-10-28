# TV Catalog Panels Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to execute inline with independent UIhelper agent.

**Goal:** Modernize search/categories in the existing native TV app and publish compatibleAPK.
**Architecture:** Pure localfilterdata + focused nativeCatalogDialogs presentation; Main owns state/lifecycle/validation.
**Tech Stack:** JavaViews/API23+, existing ListView/IME; no deps.
**Spec:** docs/superpowers/specs/2026-10-28-tv-catalog-panels-design.md

## Global Constraints
- Exact existingpalette and queryANDcategory semantics.
- No provider/realstream/registration/player/backend changes.
- Existing poster sound remains on actualposter transitions only.
- API23/samepackage/signature/code5/version1.3.0-test.1.

## Review Focus
- Draft must survive IME and displayresize without silentcommit.
- Cancel restores opener and sourcechange rejects stalecommit.
- Selectedmark independent of navigationfocus; longcategories virtualized.
- Preview/countmatches actualfilteredcatalog forTurkishtext.
- Narrow/short/font1.3 UI keeps everycontrolreachable.

### Task1: Local data and UI
- [x] Write and observeRED count/intersection/Turkish/dedup unitcases.
- [x] Implement localdata and CatalogDialogs helper; integrate snapshotguardedMain actions/resize ownership.
- [x] Update toolbar search/filter affordances while retaining labels/focusgraph.
- [x] Verify native draft/IME/cancel/focus/selected/longlist/stale/responsive behavior and existingbrowse/poster-sound suites.

### Task2: Visual and delivery
- [x] Capture actualnative search/categories and activefilters atthree sizes; inspect/fix.
- [x] Independentreview, finaltests/lint, freeze/sign/install,verifyAPK.
- [ ] Update descriptor+immutableAPK, guarded web-onlydeploy, publichash/range/browserlinks verification.
