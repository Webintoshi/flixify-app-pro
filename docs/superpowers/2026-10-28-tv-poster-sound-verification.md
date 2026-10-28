# Poster sound update — 28 October2026

## Authorized scope
User supplied liecio-menu-buttom-pack-190019.mp3 and requested the opening effect, short, on every poster change in the existing nativeTVAPK. Preserve UI/colors/playback/business rules. Existing authorization covers signed compatible APK and homepage/indir publication. No provider stream or unrelated server change.

## Audio
Source SHA25688c99f4e27bd1205aa9723fb6a821235f24c74f32f5f29eb1a8558205b90e07e. Original unchanged. Decode with macOS afconvert, isolate first effect0.126–0.424s, downmixmono44.1kPCM16, retain original gain/pitch,2ms/8ms edge fades. Final0.298005s,26328bytes, SHA2563e96335f0f9e74b2975b274306e0748a7d8314ee819667073086141e0c713bea. Only this clip is bundled in res/raw/poster_move.wav. Preview retained in the task visualization directory android-tv/poster-move.wav.

## Runtime
Activity-owned SoundPool/maxStreams1, sonification attributes, no audio focus request. Early preload, immediate stop/retrigger per distinct scoped page/poster, no debounce or deferred load playback. Rebind/resize/Back sameposter silent; explicit directional exit resets entry. Pause stops current cue, destroy releases. Constructor andclose error paths release viafinally; audiofailure leaves browsing usable.

AOSP ViewRootImpl emits a directional cue during fallback focus navigation. MainActivity consumes only transitions entering/leaving/between cards with native focusSearch/requestFocus; default stock directioncue retained when leaving to normal controls, and normal dispatch elsewhere. Card stock clickdisabled. PlayerActivity/repository/provider code unchanged. Version1.2.1-test.1/code4, samepackage/min23/signature.

## Verification
Six new unit cases: rapidA-B-C-B, scopeidentity/duplicate restoration, pause/dispose, unavailable sample without stale queue, explicit reentry and audio failure. API-only scaffold produced4expected failing assertions beforeimplementation.

Five native sound cases: ordered17rapidposter transitions, unchanged boundary, detail/Back/resize/pause restoration, native directional consumption/reentry,80poster offscreen Down8/Up8 recycling and realSoundPool decodedasset/12accepted rapid play requests. Combined final sound+MainRemote+Responsive25/25, unit27/27; release lint0errors/27warnings,1m11s. First native run's boundary test assumed RIGHT on lastcardstays; actual native focus legitimately reaches toolbar, so final test uses DOWN at bottom. A zero sentinel in directionmapping raised lintWrongConstant; exhaustive validconstant switch repaired it andcomplete targetedsuite passed again.

Independent review identified potential nativepool cleanup on setup/stop failures; finally paths repaired and source rechecked, no remaining important findings. New bounded webwrapper32/32tests independently passed; agent executed all150release-tooltests successfully.

Native tests use offline repository and no customer/provider media. SoundPool decode/play acceptance is automated; actual TV output/volume remains physical-device feedback. Release signing/asset/install/publication acceptance recorded below when verified.

## Signed APK
Frozen source559e5758832e1133380160395f6a0ab5406fac09; assembleRelease14s successful. APK1307370bytes SHA25639899ad62031225c6f390c9887f5f0b7ee84e9d58f1b9c251a5f5f2d83b4a290,1.2.1-test.1/code4/min23/target35, samev1/v2cert158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594asprior1.2.0. Exact298msassetdigestverified inside release; optimizer renames its path tores/mx.wav, with raw/poster_move resourcepresent. No testhooks/fixtures/MP4/nativeABI libs. Installed-r overcode3andcoldlaunchedsuccessfully inemulator. No customer account or provider stream opened.
