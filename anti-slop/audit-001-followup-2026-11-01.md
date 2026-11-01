# Windows native usability audit follow-up

The user authorized direct implementation and selected an audit after implementation. The implementation owner proceeded with these two functional usability corrections under that existing Windows quality scope. The approved brand, layout, palette and content hierarchy were retained.

## Findings addressed

1. **R-25/R-39, indicator contrast: fixed in source and rendered locally.** The season and country controls share a small native `ComboBox` subclass with an explicit chevron in existing muted color `#A7B0BE`. Against the existing `#252C36` control background, the contrast checker measures **6.43:1**, above 3:1. The actual local rendered season screenshot shows the chevron clearly. Smoke checks both instantiated indicators; `comboIndicators:true`.
2. **R-32, focused-control keyboard dispatch: RED then GREEN.** The failing production-QML probe recorded focused subtitle Space not opening its menu, focused volume Right remaining at 30, and main-window F affecting background playback. The passing probe records subtitle Space opening the menu, volume Right changing 30→31, and main-window F/right being ignored. Player shortcuts now distinguish focused controls and the exact focused window. Native slider steps are explicit: volume 1, timeline 10 seconds. Surface playback shortcuts remain covered by full native smoke.

Qt's active-window flag includes the transient parent chain, so it cannot identify the exact input window. The bridge uses `QGuiApplication::focusWindow()` identity instead. See [Qt QWindow documentation](https://doc.qt.io/qt-6/qwindow.html#isActive). Native sliders otherwise default to an absolute 0.1 step, which the integer volume conversion rounded away; see [Qt Slider documentation](https://doc.qt.io/qt-6/qml-qtquick-controls-slider.html#stepSize-prop).

## Idle and physical input verification

- Every pointer source now uses one global-coordinate filter, including the native surface. Repeated identical coordinates do not count as renewed movement; actual changed coordinates still do. A direct signal-count regression verifies this: `pointerCoordinateDedupe:true`.
- Focus does not hold controls indefinitely. Open menus and active slider presses retain the existing hold behavior; focus changes caused by controls disappearing do not wake the bar again. The existing two-second player policy and four-second bounded smoke deadline are unchanged.
- Full Windows smoke adds a real desktop `SendInput` center double-click. It uses the actual HWND client coordinates, checks fullscreen inversion and unchanged playback, then leaves the real cursor stationary at the center for the idle test. Rejection or failed dispatch produces an explicit failure with native/QML pointer counts.
- Idle failures now include playing state, position/duration, menu/slider/hold state and native/hover/mouse event counts. A read-only native hold-count getter assists diagnosis.
- The synthetic raw AVI was lengthened by the packaging owner to 60 seconds so verification itself does not mistake its true end for an idle-control regression. Product playback timings were not changed.

## Evidence and current gate

Local build, QML lint and rendered fixture probe pass. Evidence: `work/artifacts/windows-focus-red/smoke.json`, `work/artifacts/windows-focus-green/smoke.json`, and the green `series.png`/`categories.png`. The green report contains `comboIndicators:true`, `pointerCoordinateDedupe:true`, focused-control results and `qmlErrors:[]`.

R-25/R-39 indicator check: **PASS** for the measured existing palette and rendered local control. R-32 focused-control dispatch: **PASS** locally for actual QML key events. Original brand, approved composition, minimum-window, empty and expired state checks remain as recorded in the initial audit.

**Native Windows verification remains required.** The Mac fixture report deliberately remains `catalogOnly:true`, `passed:false`, `localMediaPlaying:false`; native surface Space/timeline results are `null` there. It does not establish codec playback, real Windows hit testing or stationary Windows idle behavior. The fresh Windows artifact must pass these checks before being described as verified. No new aesthetic findings or redesign recommendations were added.

## Accepted Windows verification

Windows run `41348716138`, source `2091b8f675e3ce6dea387c85e1bc2e6ba4746512`, passed compilation, all four test suites, real native video/audio/subtitle checks, physical mouse input, focused keyboard controls, idle hide and all three normal-close child processes. The installed EXE started and exited normally within the unchanged 10-second limit; upgrade and uninstall preserved the test user file. Privacy and dependency reports passed, and the installer remains honestly unsigned TEST. Installer: 70,307,673 bytes, SHA256 `a77def878ffecb6080d2e80a7db491e2745e8be91b239fbf15be308cfa9e5927`. These Windows results replace the earlier pending native gate; they do not certify every physical GPU or screen reader.
