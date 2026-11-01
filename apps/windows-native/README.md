# Flixify Pro for Windows

Dedicated Qt Quick / native libVLC client for Windows 10 1809+ and Windows 11 x64. The initial distribution is an **unsigned TEST build**, with an installer for the current user and a portable diagnostic ZIP. No personal signing certificate or automatic public release is configured.

The current provider-session API, viewer-device catalog/media requests, DPAPI session storage, source-scoped library and absolute expiry policies live in this client. The old `viewer-native-qt` client and its workflow remain separate.

## Build

Use MSVC 2022 x64 toolset 14.44, CMake 3.31.6, Ninja 1.11.1.3 and Qt 6.11.3 `msvc2022_64`. All official Qt/VLC/NSIS downloads and SHA256 pins are recorded in `scripts/dependencies.lock.json`. Qt Multimedia supplies the existing navigation sound; VLC supplies video playback and codecs.

In a 64-bit MSVC developer PowerShell:

```powershell
python -m pip install --require-hashes --no-deps --only-binary=:all: -r scripts/build-tools-windows.txt
python scripts/provision.py --root C:/flixify
# Provisioning reports the Qt prefix and runtime paths. Set QT_ROOT accordingly.
$env:QT_ROOT = 'C:/flixify/Qt/6.11.3/msvc2022_64'
$env:PATH = "$env:QT_ROOT/bin;$env:PATH"
cmake -S . -B C:/flixify/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON "-DCMAKE_PREFIX_PATH=$env:QT_ROOT"
cmake --build C:/flixify/build --parallel 2
ctest --test-dir C:/flixify/build --output-on-failure --no-tests=error
```

Production target: `FlixifyWindows` (output `Flixify Pro.exe`). Test targets: `catalog_test`, `repository_test`, `player_policy_test`, `ui_smoke`. The first three plus packaging policy tests run through CTest. `ui_smoke` needs the deployed Qt/VLC runtime and runs separately during packaging.

For macOS development-only UI review, point `QT_ROOT` at a Qt 6.10+ desktop SDK and use `cmake --preset local-qa`, `cmake --build --preset local-qa`, and `ctest --preset local-qa`. This does not produce or validate a Windows package. Qt Multimedia is optional for local compilation, but is included and required by the Windows package input set.

## Package and evidence

The `Windows native TEST package` GitHub workflow runs on `windows-2022` after a push to `codex/windows-native-20261101`, or manually. It uses pinned action commits, verified official archives, a neutral `C:/flixify` source/build path, two compile jobs, bounded downloads and disk checks. It never creates a GitHub release.

Packaging deploys Qt/QML/compiler libraries, the full VLC plugin tree and upstream notices. `qt.conf` keeps Qt plugin discovery in the package; VLC loads only its bundled `libvlc.dll`, `libvlccore.dll` and `plugins/` tree. A separately installed VLC is unnecessary. Production binaries contain no bundled account or fixture switch; loopback fixtures belong to test executables.

The package gate requires:

- Passing catalog, repository, player-policy and packaging checks.
- A rendered fixture session with home/live/search/series/account/player PNGs and explicit successful local-media playback proof.
- AMD64 PE import closure against bundled libraries and Windows system DLLs.
- An owned-content privacy scan, no debug symbols, and preserved upstream license/provenance files.
- A real NSIS installer, successful silent install, matching installed executable, a visible application window, normal shutdown, and upgrade/uninstall checks preserving an extra user-created file.
- Versioned TEST EXE/portable ZIP, SHA256SUMS and machine-readable proof reports.

Uninstall removes only the generated list of shipped files and empty app directories; additional user-created files remain.

The portable ZIP includes the same runtime and diagnostic screenshots/reports. Fixture media, test executables, temporary profiles and build caches are excluded. `verify_install.ps1` checks that the installer is unsigned and records that status honestly. Windows may show SmartScreen or unknown-publisher warnings; this project makes no warning-free claim.

The workflow fails when compilation, deployment, smoke evidence, dependencies, privacy checks, installer or hashes are incomplete. A failed run may upload diagnostic logs, but cannot upload a verified package artifact.

## Smoke harness contract

```text
ui_smoke.exe --output <proof-directory> --media <local-file>
```

The harness writes `smoke.json` with boolean `passed`, `localMediaPlaying` and `fixtureHttp`, all true only after the associated checks, plus nonempty rendered `home.png`, `live.png`, `search.png`, `series.png`, `account.png` and `player.png`. Packaging generates an original 20-second moving AVI test pattern locally; no production account, provider content or remote test movie is used.

Original website favicon is copied verbatim to `resources/app.ico`. Original wordmark, app image and poster navigation sound are embedded under `/brand/`. See `CONTRACT.md` for app/QML interfaces and `licenses/` for distribution notices.
