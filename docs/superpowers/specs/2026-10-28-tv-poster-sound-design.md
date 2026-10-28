# Poster navigation sound

User supplies liecio-menu-buttom-pack-190019.mp3 and requests its opening sound, short, on every poster change in the existing Android TV app. No unanswered product choice: proceed within existing APK publication authorization.

Use first isolated effect0.126–0.424s,298ms, original gain/pitch, mono44.1kPCM16 WAV,2ms attack/8ms tail fade. Resource poster_move.wav is26328bytes; SHA3e96335f0f9e74b2975b274306e0748a7d8314ee819667073086141e0c713bea. Original source remains unchanged.

Activity-owned preloaded SoundPool, maxStreams1, sonification attributes, no audio focus request. Every distinct scoped poster focus transition triggers immediately; no time debounce, stop/retrigger previous sample, no queued sound on late load. Preserve identity across rebind/resize/Back; sameposter automatic restoration produces none. Explicit directional exit to toolbar resets entry feedback, so the next user entry gets a cue. Pause stops feedback; destroy releases once. No player/control/login/rail custom sound. Preserve TV colors and playback/data policies.

AOSP ViewRootImpl currently emits native directional effects directly after fallback focus navigation; card.setSoundEffectsEnabled(false) alone does not suppress that route. Consume only directional transitions entering/leaving/between poster cards through native focusSearch/requestFocus, preventing fallback's second cue. Play existing native directional effect when leaving poster to a normal control. Keep normal dispatch for other controls/dialogs. Native card click effect off.

Tests: ordered rapidA-B-C-B, no duplicate same scoped identity afterrestore, scope change, inactive/closed/late-load behavior, native sample loads/accepted stream, actual Dpad path and boundaries, default navigation preserved outsidecards. API23+ and existing package/signature. Version1.2.1-test.1/code4. Publish immutable APK viaexistinghomepage/indir, guarded web-only update preservingAPI/worker/DB.

References: Android SoundPool https://developer.android.com/reference/android/media/SoundPool?authuser=0 ; AOSP ViewRootImpl https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/view/ViewRootImpl.java .
