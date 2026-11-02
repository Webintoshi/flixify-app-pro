# Windows installation, responsiveness and player parity

The user reports missing desktop installation, interface and video freezes, and Windows player controls that differ from the accepted native Mac player. Their existing instruction delegates technical decisions and direct implementation; visual review follows implementation. This repair continues the existing native Windows client and does not require another design approval.

## Decisions and scope

- Keep C++20, Qt 6.11.3, libVLC 3.0.24, Windows 10 1809+/11 x64 and per-user NSIS installation. No browser wrapper or dependency upgrade is needed.
- The installer currently creates only a Start Menu shortcut. Create a current-user desktop shortcut by default, resolve the real Windows shell desktop location, repair the application-owned link on upgrade and preserve unrelated same-name links. Exercise the installed shortcut in Windows CI.
- VLC initialization, playback, polling and controls currently execute on the GUI thread. Serialize VLC work on an app-owned single-worker queue, deliver bounded snapshots back to the GUI with session generation checks, and cancel superseded sessions. Preserve the synchronous surface-destruction drain that prevents VLC from using a destroyed native video window.
- Match the existing Mac player: a small close icon at the top, live badge when applicable, white VOD timeline, title and episode/EPG text at bottom left, compact icon tools at bottom right. VOD pause and seeking remain accessible through keyboard/video interaction. Keep all required live, favorite, audio, subtitle, episode, settings and fullscreen controls. Retain the original palette, accessible focus and two-second idle hide.
- Add worker-safe rate and aspect settings matching Mac: rates 0.5, 0.75, 1, 1.25, 1.5 and 2; aspects Otomatik, 16:9 and 4:3.
- Publish a separately identified 1.0.1 test installer only after actual Windows verification. Preserve the 1.0.0 installer and existing Mac/Android downloads. The package remains unsigned; no SmartScreen bypass or warning-free claim is part of this repair.

## Validation

Use synthetic local media and controlled repositories, never customer streams. A blocking fake VLC table must reproduce loss of GUI heartbeat before the fix and prove responsive open/poll/control/cancel behavior afterward. Check late events, rapid content changes and window shutdown. Real Windows tests must also validate physical input, controls, playback codecs, two-second hide, normal exits, desktop shortcut launch, upgrade repair and uninstall preservation. Review the finished player visually against the Mac reference before acceptance.

The local Mac installation issue remains separate and pending the exact macOS warning/user approval. Native Mac source, provider settings, API, worker, database and personal signing identities are out of scope.
