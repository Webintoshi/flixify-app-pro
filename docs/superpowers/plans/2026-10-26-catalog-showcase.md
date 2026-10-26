# Ortak günlük vitrin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Film/dizi önerilerini bütün uygun kişisel katalogdan, herkese ortak günlük ve çeşitli bir seçkiyle sunmak.

**Architecture:** Saf bir seçim modülü, mevcut CatalogPage içinde kaynakla sınırlı ham katalog/sıralama önbelleği ve mevcut MediaRail bileşenleri. API, worker ve sağlayıcı protokolü değiştirilmez.

**Tech Stack:** Mevcut Next/React/TypeScript; Vitest + gerçek React DOM/LinkeDOM test düzeni; mevcut korumalı Coolify web dağıtımı.

**Spec:** `docs/superpowers/specs/2026-10-26-catalog-showcase-design.md`

## Global Constraints

- Kişiselleştirme yok; Europe/Istanbul günlük ortak seçim.
- Kişisel kaydın kaynak sürümü sıralama tuzuna girmez; hesap/kaynak asenkron sahipliği korunur.
- Arama, kategori, favoriler, renkler, erişim/süre, oynatma ve canlı TV davranışı değişmez.
- Yeni bağımlılık/sağlayıcı isteği yok; gerçek yayın açılmaz.
- Son canlı kaynak web3690cd1/b859dd670ab3583857d6efd8955d8f525017ce55; API/worker/DB ve tüm geri dönüş imajları korunur.

## Review Focus

- Aynı içerik farklı kaynak sürümlerinde farklı kişisel ID taşır: sıralama sağlayıcı kimlikleriyle aynı olmalı.
- Kalabalık tek kategori ve küçük/boş kataloglar: çeşitlilik, eksiksiz sıralama ve güvenli boş görünüm.
- Gün değişirken detay/arama veya sayfa2 açıktır: görünen liste zıplamaz, sonraki güvenli görünüm yeni günü alır.
- Hesap/kaynak değişiminden sonra eski katalog yanıtı gelir: eski afiş/kimlik görünmez.
- Başlık kopyaları ve engellenmiş kayıtlar: satırlar ayrışık kalır, arama/kategori veri kaybetmez.

## Task 1: Saf günlük seçici

**Files:** Create `apps/ops-web/app/platform/catalog-showcase.ts`; test `catalog-showcase.test.ts`.

**Interfaces:**
- `showcaseDayKey(now?: number): string`
- `orderShowcaseCatalog(items: readonly MediaItem[], kind: Kind, dayKey: string): MediaItem[]`
- `selectShowcaseHero(items: readonly MediaItem[], dayKey: string, limit?: number): MediaItem[]`
- `buildShowcaseRails(items: readonly MediaItem[], kind: Kind, excluded?: ReadonlySet<string>): { primary: MediaItem[]; categories: [string, MediaItem[]][]; other: MediaItem[] }`
- Hero exclusions use existing `itemKey`; canonical provider identity is internal to ordering. Original item objects/references remain unchanged.

- [x] Write failing tests for common identity despite sourceVersion, order-independent input, Istanbul midnight/day rotation, mixed prefix, four category cap, unavailable exclusions, disjoint rails and preserved full multiset.
- [x] Run focused Vitest file and observe failures before implementation.
- [x] Implement deterministic hash/group rotation, balanced first12, up to4 category blocks12 each and complete remaining order. Build visible rails with a shared used identity/title set. Select5 poster-bearing hero candidates without false popularity metadata.
- [x] Run selector tests; include50k synthetic input sanity without network.
- [x] Review and commit only helper/tests.

## Task 2: CatalogPage integration

**Files:** Modify `apps/ops-web/app/platform/catalog.tsx`; create `catalog-showcase-ui.test.tsx`.

**Interfaces:** Consumes Task1; preserves `pagePersonalCatalog(items,page,search,group)` and existing MediaRail/Detail props.

- [x] Write failing rendered tests: late-source response isolation, common sourceVersion ranking, loaded-page stability/uniqueness, unchanged search/category/favorites, date change without extra provider fetch, no hero/row duplicates.
- [x] Cache one raw personal catalog promise per account/provider/kind with failure eviction. Cache daily ordering separately. Use raw data for search/category and ordered data only for unfiltered discovery before48-item slicing.
- [x] Reuse existing cards/rails; main12 and category rails share exclusions. Overview hero excludes its candidates from movie/series rows; live rows remain unchanged. Replace unverified GÜNDEMDE copy with GÜNÜN SEÇKİSİ.
- [x] Keep day stable during search/filter/page>1/detail. Recheck day at safe first-page visibility/focus and a cleaned-up timer, with no provider refetch.
- [x] Run focused selector/rendered tests, existing personal integration tests and web TypeScript; independently review lifecycle and performance.
- [x] Commit reviewed runtime/UI tests.

## Task 3: Web-only release

**Files:** Add a thin showcase builder/release adapter beside `coolify/releases/2026-10-26-edge-recovery/`; append existing verification report.

- [x] Derive the exact runtime manifest and commit; pin running source3690cd1 and protected worker9b5d plus API/actual DB.
- [x] Run focused guard tests and source preflight. Build using existing1280MiB RAM/1536MiB total cgroup limits,8GiB free-space gate, restored Next config and no webpack cache.
- [x] Apply/recreate only web with preservation guards. Verify exact new container HTTP and public page health, without media playback.
- [x] Clean only this build's newly created reclaimable ancestor cache IDs after exact preview matching; retain every image/volume; verify actual disk/containers.
- [x] Record final immutable IDs/verification/limitations and push. Explain daily common selection and one optional page reload to the user.
