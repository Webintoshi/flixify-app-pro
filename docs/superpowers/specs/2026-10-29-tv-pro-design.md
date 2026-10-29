# Flixify Pro stable release

The user requested one surgical change to the approved native player: remove the redundant on-screen play/pause, rewind, fast-forward and Back controls from movie and series playback. The remote already supplies those actions. All other player tools, timeline, times, theme, live controls, playback/access rules and automatic continuation must remain.

Hide the complete obsolete transport row for MOVIE, SERIES and EPISODE, including its four focusable actions, so no empty bar remains. Preserve the existing LIVE row. Route VOD focus to its enabled timeline, otherwise the player root so OK still toggles even while paused with an unknown duration. Up from that root reaches the enabled utilities and Down returns. Remote OK on timeline/root toggles playback; OK on a utility keeps that utility's action. Countdown, failure and dialog-return focus must never target a hidden action. Existing remote media keys and seek behavior remain.

Publish the same package `vip.flixify.tv` as **Flixify Pro**, version **1.3.2**, code **7**, using its existing signing certificate for installation over code6. Remove test wording from the launcher and existing download surfaces. Add one immutable `flixify-pro-1.3.2.apk`; preserve every old public file. No Play Store submission or signing-key change.

The direct implementation above follows the user's exact request. Removing transport for LIVE would violate scope; merely deleting icons without repairing focus would break remote operation. Existing design direction is retained: cinematic dark player, original palette, quiet controls (energy1/rhythm1/motion1 for this overlay). Removing a redundant row gives the video more space; no new colors, typefaces, graphics or animations are introduced.

Deploy only the existing website's download descriptor and exact test-wording replacements with the new APK. Preserve API/worker/database images and configuration. Verify with offline instrumentation and actual signed upgrade; never open a customer/provider stream.
