# Third-party runtime notices

Flixify Pro dynamically links Qt 6.11.3 and libVLC 3.0.24. The Windows package includes the compiler redistributable dependencies deployed by Qt, Qt Quick/QML plugins, Qt Multimedia and its media dependencies, and the VLC codec plugins. System Windows DLLs remain operating-system components.

The `Qt/` directory contains original license, copyright, notice and attribution files copied from the exact Qt 6.11.3 source archives used for this runtime. The `VLC/` directory preserves the upstream VLC notices and COPYING files from the official 3.0.24 Windows distribution. The `Microsoft/` directory carries the original Visual Studio redistributable license when deployed. `provenance.json` lists download URLs and independently checked SHA256 digests; `dependencies.lock.json` records the committed pins.

Qt source is available from [the official Qt 6.11.3 submodules](https://download.qt.io/official_releases/qt/6.11/6.11.3/submodules/). VLC source is available from [the official VLC 3.0.24 release](https://download.videolan.org/pub/videolan/vlc/3.0.24/). The application loads the bundled Qt and VLC shared libraries dynamically; these shared libraries may be replaced with compatible builds under the applicable licenses. Original third-party copyrights and attribution remain in their upstream notices, including any upstream author names and contact addresses.

NSIS 3.11 builds the installer. Its original license is included under `NSIS/`. This application has no automatic unsigned updater. Distribution of the initial artifact is explicitly labeled TEST and unsigned.
