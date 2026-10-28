# Poster Sound Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** Play the user's short opening sound on every distinct TV poster transition and publish the update.
**Architecture:** Activity-owned PosterFocusSound lifecycle and one preloaded native SoundPool; scoped identity dedupe at poster focus hook. Poster-only directional handling prevents duplicate OS cue.
**Tech Stack:** Java Views/API23+, SoundPool, PCM WAV.
**Spec:** docs/superpowers/specs/2026-10-28-tv-poster-sound-design.md

## Global Constraints
- Original audio unchanged; extracted298ms clip only.
- No new dependency, provider stream, player/business/palette change.
- Same package/signature; code4/version1.2.1-test.1, immutable download.

## Review Focus
- Rapid remote repeats must each trigger with no queued audio.
- Rebind/resize/restored sameposter must remain silent.
- Native default beep must not double custom cue.
- Late load/pause/destruction must never play.
- Audio initialization failure must leave navigation usable.

### Task1: Sound and integration
- [x] Extract asset and write behavior tests; observe RED.
- [x] Implement PosterFocusSound and wire MainActivity focus/lifecycle/directional boundary.
- [x] Verify unit, real SoundPool and remote integration, browse regressions/lint.

### Task2: Publish
- [x] Review, freeze, assemble and check signature/asset/version/install.
- [ ] Update descriptor+APK, bounded guarded web-only deployment.
- [ ] Verify public hash/MIME/range and actual browser links; keep short preview.
