import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

Item {
    id: root
    property var controller: null
    property var movieData: null
    property Component videoSurfaceComponent: null
    property string contentKind: "movie"
    property string titleText: ""
    property string subtitleText: ""
    property string artworkUrl: ""
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property bool compactWindow: false
    property bool windowIsFullscreen: false
    property bool controlsVisible: true
    property double seekPreviewSeconds: 0
    signal closeRequested()
    signal toggleWindowFullscreenRequested()
    readonly property string contentLabel: contentKind === "episode" ? "Bölüm" : "Film"
    readonly property bool surfaceActive: controller && controller.activeContentKind === contentKind
    readonly property bool playbackStarted: controller && (controller.state === "playing" || controller.state === "paused" || controller.state === "buffering" || controller.state === "ended" || controller.positionSeconds > 0 || controller.durationSeconds > 0)
    readonly property bool posterVisible: posterImage.status === Image.Ready && artworkUrl.length > 0 && !playbackStarted
    readonly property bool showStatusOverlay: controller && (controller.state === "opening" || controller.state === "resolving" || controller.state === "error")
    readonly property bool keepControlsVisible: timelineSlider.pressed || volumeSlider.pressed
    readonly property bool autoHideEnabled: playbackStarted && controller && !controller.paused && !showStatusOverlay && !keepControlsVisible
    readonly property bool overlayChromeVisible: controlsVisible || keepControlsVisible || !playbackStarted || (controller && controller.state === "error")
    readonly property int volumePercent: Math.round(((controller && controller.muted) ? 0 : (controller ? controller.volume : 1)) * 100)
    readonly property bool overlayWindowActive: visible
                                              && viewport.visible
                                              && viewport.width > 1
                                              && viewport.height > 1
                                              && root.Window.window
                                              && root.Window.window.visible
                                              && root.Window.window.active
                                              && Qt.application.state === Qt.ApplicationActive
    readonly property string playbackStateText: !controller ? "" : controller.state === "paused" ? "DURAKLATILDI" : controller.state === "buffering" ? "YÜKLENİYOR" : controller.state === "opening" || controller.state === "resolving" ? "HAZIRLANIYOR" : controller.state === "error" ? "HATA" : controller.state === "ended" ? "BİTTİ" : ""
    readonly property bool playbackPausedVisual: !controller || controller.paused || controller.state === "paused" || controller.state === "stopped" || controller.state === "ended" || controller.state === "idle" || controller.state === "error"
    focus: true

    function formatClock(totalSeconds) {
        if (totalSeconds <= 0 || !isFinite(totalSeconds)) return "00:00"
        const roundedSeconds = Math.max(0, Math.floor(totalSeconds))
        const hours = Math.floor(roundedSeconds / 3600)
        const minutes = Math.floor((roundedSeconds % 3600) / 60)
        const seconds = roundedSeconds % 60
        const minuteText = (minutes < 10 ? "0" : "") + minutes
        const secondText = (seconds < 10 ? "0" : "") + seconds
        if (hours > 0) return hours + ":" + minuteText + ":" + secondText
        return minuteText + ":" + secondText
    }

    function secondaryFill(button, active) {
        if (!button.enabled) return "#3610161f"
        if (button.down) return active ? "#8be50914" : "#7a1b2634"
        if (button.hovered) return active ? "#b2e50914" : "#96212e40"
        return active ? "#8fe50914" : "#6b131c28"
    }

    function secondaryBorder(button, active) {
        if (!button.enabled) return "#16ffffff"
        if (active) return "#8dffffff"
        return button.hovered ? "#52ffffff" : "#26ffffff"
    }

    function accentFill(button) {
        if (!button.enabled) return "#7a481316"
        if (button.down) return "#cbcf0914"
        if (button.hovered) return "#e7ff2432"
        return "#dce50914"
    }

    component PlayerIcon: Item {
        id: iconRoot
        property string name: "play"
        property color strokeColor: "#ffffff"
        implicitWidth: 20
        implicitHeight: 20
        onNameChanged: canvas.requestPaint()
        onStrokeColorChanged: canvas.requestPaint()
        onWidthChanged: canvas.requestPaint()
        onHeightChanged: canvas.requestPaint()

        Canvas {
            id: canvas
            anchors.fill: parent
            antialiasing: true

            onPaint: {
                const ctx = getContext("2d")
                ctx.reset()
                ctx.clearRect(0, 0, width, height)
                ctx.strokeStyle = iconRoot.strokeColor
                ctx.fillStyle = iconRoot.strokeColor
                ctx.lineWidth = Math.max(1.8, width * 0.1)
                ctx.lineCap = "round"
                ctx.lineJoin = "round"

                if (iconRoot.name === "play") {
                    ctx.beginPath()
                    ctx.moveTo(width * 0.3, height * 0.2)
                    ctx.lineTo(width * 0.78, height * 0.5)
                    ctx.lineTo(width * 0.3, height * 0.8)
                    ctx.closePath()
                    ctx.fill()
                    return
                }

                if (iconRoot.name === "pause") {
                    const barWidth = width * 0.18
                    ctx.fillRect(width * 0.25, height * 0.2, barWidth, height * 0.6)
                    ctx.fillRect(width * 0.57, height * 0.2, barWidth, height * 0.6)
                    return
                }

                if (iconRoot.name === "volume") {
                    ctx.beginPath()
                    ctx.moveTo(width * 0.2, height * 0.4)
                    ctx.lineTo(width * 0.36, height * 0.4)
                    ctx.lineTo(width * 0.55, height * 0.22)
                    ctx.lineTo(width * 0.55, height * 0.78)
                    ctx.lineTo(width * 0.36, height * 0.6)
                    ctx.lineTo(width * 0.2, height * 0.6)
                    ctx.closePath()
                    ctx.fill()
                    ctx.beginPath()
                    ctx.arc(width * 0.56, height * 0.5, width * 0.18, -0.75, 0.75)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.arc(width * 0.56, height * 0.5, width * 0.28, -0.75, 0.75)
                    ctx.stroke()
                    return
                }

                if (iconRoot.name === "muted") {
                    ctx.beginPath()
                    ctx.moveTo(width * 0.2, height * 0.4)
                    ctx.lineTo(width * 0.36, height * 0.4)
                    ctx.lineTo(width * 0.55, height * 0.22)
                    ctx.lineTo(width * 0.55, height * 0.78)
                    ctx.lineTo(width * 0.36, height * 0.6)
                    ctx.lineTo(width * 0.2, height * 0.6)
                    ctx.closePath()
                    ctx.fill()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.68, height * 0.3)
                    ctx.lineTo(width * 0.9, height * 0.7)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.9, height * 0.3)
                    ctx.lineTo(width * 0.68, height * 0.7)
                    ctx.stroke()
                    return
                }

                if (iconRoot.name === "fullscreen") {
                    ctx.beginPath()
                    ctx.moveTo(width * 0.18, height * 0.38)
                    ctx.lineTo(width * 0.18, height * 0.18)
                    ctx.lineTo(width * 0.38, height * 0.18)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.62, height * 0.18)
                    ctx.lineTo(width * 0.82, height * 0.18)
                    ctx.lineTo(width * 0.82, height * 0.38)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.18, height * 0.62)
                    ctx.lineTo(width * 0.18, height * 0.82)
                    ctx.lineTo(width * 0.38, height * 0.82)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.62, height * 0.82)
                    ctx.lineTo(width * 0.82, height * 0.82)
                    ctx.lineTo(width * 0.82, height * 0.62)
                    ctx.stroke()
                    return
                }

                if (iconRoot.name === "fullscreen-exit") {
                    ctx.beginPath()
                    ctx.moveTo(width * 0.18, height * 0.32)
                    ctx.lineTo(width * 0.38, height * 0.32)
                    ctx.lineTo(width * 0.38, height * 0.18)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.62, height * 0.18)
                    ctx.lineTo(width * 0.62, height * 0.32)
                    ctx.lineTo(width * 0.82, height * 0.32)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.18, height * 0.68)
                    ctx.lineTo(width * 0.38, height * 0.68)
                    ctx.lineTo(width * 0.38, height * 0.82)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.62, height * 0.82)
                    ctx.lineTo(width * 0.62, height * 0.68)
                    ctx.lineTo(width * 0.82, height * 0.68)
                    ctx.stroke()
                    return
                }

                if (iconRoot.name === "close") {
                    ctx.beginPath()
                    ctx.moveTo(width * 0.24, height * 0.24)
                    ctx.lineTo(width * 0.76, height * 0.76)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.76, height * 0.24)
                    ctx.lineTo(width * 0.24, height * 0.76)
                    ctx.stroke()
                }
            }
        }
    }

    function showControls() {
        controlsVisible = true
        if (autoHideEnabled) controlsHideTimer.restart()
        else controlsHideTimer.stop()
        overlayGeometrySyncTimer.restart()
    }

    function togglePlayback() {
        if (!controller) {
            return
        }

        if (playbackPausedVisual) {
            controller.resume()
        } else {
            controller.pause()
        }

        showControls()
    }

    function syncOverlayWindowGeometry() {
        const hostWindow = root.Window.window
        if (!hostWindow || !overlayWindowActive) {
            overlayWindow.visible = false
            return
        }
        const topLeft = viewport.mapToGlobal(0, 0)
        overlayWindow.x = Math.round(topLeft.x)
        overlayWindow.y = Math.round(topLeft.y)
        overlayWindow.width = Math.max(1, Math.round(viewport.width))
        overlayWindow.height = Math.max(1, Math.round(viewport.height))
        overlayWindow.visible = true
    }

    Keys.onPressed: function(event) {
        if (!controller) return
        if (event.key === Qt.Key_Space) { controller.togglePause(); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_Left) { controller.seekBy(-10); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_Right) { controller.seekBy(10); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_Up) { controller.setVolume(Math.min(1, controller.volume + 0.05)); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_Down) { controller.setVolume(Math.max(0, controller.volume - 0.05)); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_M) { controller.toggleMuted(); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_F || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { root.toggleWindowFullscreenRequested(); showControls(); event.accepted = true; return }
        if (event.key === Qt.Key_Escape) {
            if (root.windowIsFullscreen) root.toggleWindowFullscreenRequested()
            else root.closeRequested()
            event.accepted = true
        }
    }

    Component.onCompleted: { forceActiveFocus(); showControls() }
    Component.onDestruction: {
        controlsHideTimer.stop()
        overlayGeometrySyncTimer.stop()
        if (overlayWindow) {
            overlayWindow.visible = false
        }
    }
    onVisibleChanged: {
        if (visible) {
            forceActiveFocus()
            showControls()
        } else {
            controlsHideTimer.stop()
            overlayGeometrySyncTimer.stop()
            overlayWindow.visible = false
            if (controller && controller.activeContentKind === contentKind && controller.state !== "idle") {
                controller.stop()
            }
        }
    }
    onOverlayWindowActiveChanged: {
        if (!overlayWindow) {
            return
        }
        if (!overlayWindowActive) {
            controlsHideTimer.stop()
            overlayGeometrySyncTimer.stop()
            overlayWindow.visible = false
            return
        }
        overlayGeometrySyncTimer.restart()
    }
    onWindowIsFullscreenChanged: { showControls(); if (controller && controller.refreshVideoLayout) controller.refreshVideoLayout() }
    onKeepControlsVisibleChanged: { if (keepControlsVisible) { controlsHideTimer.stop(); controlsVisible = true } else showControls() }
    onPlaybackStartedChanged: showControls()
    onAutoHideEnabledChanged: {
        if (autoHideEnabled) {
            controlsHideTimer.restart()
        } else {
            controlsHideTimer.stop()
            controlsVisible = true
        }
    }

    Connections {
        target: root.controller
        ignoreUnknownSignals: true

        function onPausedChanged() {
            if (!root.controller) {
                return
            }
            root.controlsVisible = true
            if (root.controller.paused) {
                controlsHideTimer.stop()
            } else if (root.autoHideEnabled) {
                controlsHideTimer.restart()
            }
            overlayGeometrySyncTimer.restart()
        }

        function onStateChanged() {
            if (!root.controller) {
                return
            }
            if (root.controller.state === "playing") {
                root.showControls()
                return
            }
            if (root.controller.state === "paused" ||
                root.controller.state === "stopped" ||
                root.controller.state === "ended" ||
                root.controller.state === "error") {
                root.controlsVisible = true
                controlsHideTimer.stop()
                overlayGeometrySyncTimer.restart()
            }
        }
    }

    Connections {
        target: root.Window.window
        ignoreUnknownSignals: true

        function onActiveChanged() {
            if (!root.Window.window || !root.Window.window.active) {
                controlsHideTimer.stop()
                overlayGeometrySyncTimer.stop()
                if (overlayWindow) {
                    overlayWindow.visible = false
                }
                return
            }
            overlayGeometrySyncTimer.restart()
        }
    }

    Rectangle { anchors.fill: parent; color: "#05070b" }

    Item {
        anchors.fill: parent
        anchors.margins: root.windowIsFullscreen ? 0 : (root.compactWindow ? 18 : 26)

        Rectangle {
            id: viewport
            anchors.fill: parent
            radius: root.windowIsFullscreen ? 0 : 30
            color: "#000000"
            border.width: root.windowIsFullscreen ? 0 : 1
            border.color: "#1cffffff"
            clip: true
            onXChanged: overlayGeometrySyncTimer.restart()
            onYChanged: overlayGeometrySyncTimer.restart()
            onWidthChanged: overlayGeometrySyncTimer.restart()
            onHeightChanged: overlayGeometrySyncTimer.restart()
            onVisibleChanged: overlayGeometrySyncTimer.restart()

            Loader {
                id: videoSurfaceLoader
                anchors.fill: parent
                active: root.surfaceActive
                visible: active
                sourceComponent: root.videoSurfaceComponent
                onLoaded: {
                    if (!item) return
                    item.controller = root.controller
                    item.slotIndex = 0
                    if (item.syncSurfaceBinding) item.syncSurfaceBinding()
                }
            }

            MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton
                onEntered: root.showControls()
                onPositionChanged: root.showControls()
                onPressed: root.showControls()
                onDoubleClicked: { root.toggleWindowFullscreenRequested(); root.showControls() }
                onClicked: {
                    if (root.controller && root.playbackStarted && !root.showStatusOverlay) {
                        root.togglePlayback()
                    }
                }
            }

            Image {
                id: posterImage
                anchors.fill: parent
                source: root.artworkUrl
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                cache: true
                visible: root.posterVisible
            }
        }
    }

    Window {
        id: overlayWindow
        transientParent: root.Window.window
        flags: Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.NoDropShadowWindowHint
        modality: Qt.NonModal
        color: "transparent"
        visible: false
        width: 1
        height: 1

        Item {
            anchors.fill: parent

            MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton
                onEntered: root.showControls()
                onPositionChanged: root.showControls()
                onPressed: root.showControls()
                onDoubleClicked: { root.toggleWindowFullscreenRequested(); root.showControls() }
                onClicked: {
                    if (root.controller && root.playbackStarted && !root.showStatusOverlay) {
                        root.togglePlayback()
                    }
                }
            }

            Rectangle {
                anchors.centerIn: parent
                width: Math.min(parent.width - 64, root.compactWindow ? 360 : 460)
                height: root.compactWindow ? 170 : 186
                radius: 24
                color: "#d0121720"
                border.width: 1
                border.color: root.controller && root.controller.state === "error" ? "#34ff7d86" : "#2effffff"
                visible: root.showStatusOverlay && !root.playbackStarted
                Column {
                    anchors.fill: parent
                    anchors.margins: 22
                    spacing: 12
                    BusyIndicator { running: root.controller && root.controller.state !== "error"; visible: running }
                    Text { text: root.controller && root.controller.state === "error" ? `${root.contentLabel} açılamadı` : `${root.contentLabel} hazırlanıyor`; color: root.textPrimary; font.pixelSize: 24; font.bold: true }
                    Text {
                        width: parent.width
                        wrapMode: Text.WordWrap
                        text: root.controller && root.controller.lastError.length ? root.controller.lastError : `${root.contentLabel} bağlanıyor. İlk kare geldiğinde oynatıcı aktif hale gelir.`
                        color: root.controller && root.controller.state === "error" ? "#ffd2d7" : root.textMuted
                        font.pixelSize: 13
                    }
                }
            }

            Rectangle {
                anchors.top: parent.top
                anchors.right: parent.right
                anchors.topMargin: root.windowIsFullscreen ? 18 : 14
                anchors.rightMargin: root.windowIsFullscreen ? 18 : 14
                width: 56
                height: 56
                radius: 28
                color: root.windowIsFullscreen ? "#82101822" : "#a1101822"
                border.width: 1
                border.color: "#26ffffff"
                opacity: root.overlayChromeVisible ? 1.0 : 0.0
                visible: opacity > 0.0
                z: 3
                Behavior on opacity { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

                RoundButton {
                    id: closeButton
                    anchors.fill: parent
                    anchors.margins: 5
                    flat: true
                    focusPolicy: Qt.NoFocus
                    hoverEnabled: true
                    onClicked: root.closeRequested()
                    background: Rectangle {
                        radius: width / 2
                        color: closeButton.down ? "#44ff2432" : (closeButton.hovered ? "#2fff2432" : "transparent")
                    }
                    contentItem: PlayerIcon {
                        name: "close"
                        strokeColor: "#ffffff"
                        anchors.centerIn: parent
                    }
                }
            }

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.leftMargin: root.windowIsFullscreen ? 18 : 14
                anchors.rightMargin: root.windowIsFullscreen ? 18 : 14
                anchors.bottomMargin: root.windowIsFullscreen ? 18 : 14
                height: 94
                radius: 26
                color: root.windowIsFullscreen ? "#82101822" : "#a1101822"
                border.width: 1
                border.color: "#26ffffff"
                opacity: root.overlayChromeVisible ? 1.0 : 0.0
                visible: opacity > 0.0
                Behavior on opacity { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

                ColumnLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 16
                    anchors.rightMargin: 16
                    anchors.topMargin: 14
                    anchors.bottomMargin: 14
                    spacing: 10

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 12
                        Text { text: root.formatClock(timelineSlider.pressed ? root.seekPreviewSeconds : (root.controller ? root.controller.positionSeconds : 0)); color: root.textPrimary; font.pixelSize: 13; font.bold: true }
                        Slider {
                            id: timelineSlider
                            Layout.fillWidth: true
                            from: 0
                            to: Math.max(1, root.controller ? root.controller.durationSeconds : 0)
                            value: pressed ? root.seekPreviewSeconds : (root.controller ? root.controller.positionSeconds : 0)
                            enabled: root.controller && root.controller.durationSeconds > 0
                            onPressedChanged: { root.showControls(); if (pressed) root.seekPreviewSeconds = root.controller ? root.controller.positionSeconds : 0; else if (root.controller) root.controller.seekTo(root.seekPreviewSeconds) }
                            onMoved: { root.seekPreviewSeconds = value; root.showControls() }
                            background: Rectangle {
                                x: timelineSlider.leftPadding
                                y: timelineSlider.topPadding + timelineSlider.availableHeight / 2 - height / 2
                                width: timelineSlider.availableWidth
                                height: 6
                                radius: 3
                                color: "#2bffffff"
                                Rectangle { width: timelineSlider.visualPosition * parent.width; height: parent.height; radius: 3; color: "#ff2432" }
                            }
                            handle: Rectangle {
                                x: timelineSlider.leftPadding + timelineSlider.visualPosition * (timelineSlider.availableWidth - width)
                                y: timelineSlider.topPadding + timelineSlider.availableHeight / 2 - height / 2
                                implicitWidth: 18
                                implicitHeight: 18
                                radius: 9
                                color: "#ffffff"
                                border.width: 2
                                border.color: "#ff2432"
                            }
                        }
                        Text { text: root.formatClock(root.controller ? root.controller.durationSeconds : 0); color: root.textPrimary; font.pixelSize: 13; font.bold: true }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        RoundButton {
                            id: playPauseButton
                            enabled: root.controller && root.controller.state !== "idle" && root.controller.state !== "opening"
                            focusPolicy: Qt.NoFocus
                            hoverEnabled: true
                            implicitWidth: 46
                            implicitHeight: 46
                            flat: true
                            onClicked: root.togglePlayback()
                            background: Rectangle {
                                radius: width / 2
                                color: root.accentFill(playPauseButton)
                            }
                            contentItem: Item {
                                anchors.fill: parent

                                PlayerIcon {
                                    visible: root.playbackPausedVisual
                                    name: "play"
                                    strokeColor: "#ffffff"
                                    anchors.centerIn: parent
                                }

                                PlayerIcon {
                                    visible: !root.playbackPausedVisual
                                    name: "pause"
                                    strokeColor: "#ffffff"
                                    anchors.centerIn: parent
                                }
                            }
                        }

                        RoundButton {
                            id: muteButton
                            enabled: root.controller
                            focusPolicy: Qt.NoFocus
                            hoverEnabled: true
                            implicitWidth: 46
                            implicitHeight: 46
                            flat: true
                            onClicked: {
                                if (root.controller) {
                                    root.controller.toggleMuted()
                                }
                                root.showControls()
                            }
                            background: Rectangle {
                                radius: width / 2
                                color: root.secondaryFill(muteButton, false)
                                border.width: 1
                                border.color: root.secondaryBorder(muteButton, false)
                            }
                            contentItem: PlayerIcon {
                                name: root.controller && (root.controller.muted || root.controller.volume <= 0) ? "muted" : "volume"
                                strokeColor: "#ffffff"
                                anchors.centerIn: parent
                            }
                        }

                        Slider {
                            id: volumeSlider
                            Layout.preferredWidth: root.windowIsFullscreen ? 190 : 160
                            from: 0
                            to: 1
                            value: root.controller && root.controller.muted ? 0 : (root.controller ? root.controller.volume : 1)
                            enabled: root.controller
                            onMoved: { if (root.controller) root.controller.setVolume(value); root.showControls() }
                            onPressedChanged: root.showControls()
                            background: Rectangle {
                                x: volumeSlider.leftPadding
                                y: volumeSlider.topPadding + volumeSlider.availableHeight / 2 - height / 2
                                width: volumeSlider.availableWidth
                                height: 6
                                radius: 3
                                color: "#2bffffff"
                                Rectangle { width: volumeSlider.visualPosition * parent.width; height: parent.height; radius: 3; color: "#ff2432" }
                            }
                            handle: Rectangle {
                                x: volumeSlider.leftPadding + volumeSlider.visualPosition * (volumeSlider.availableWidth - width)
                                y: volumeSlider.topPadding + volumeSlider.availableHeight / 2 - height / 2
                                implicitWidth: 18
                                implicitHeight: 18
                                radius: 9
                                color: "#ffffff"
                                border.width: 2
                                border.color: "#ff2432"
                            }
                        }

                        Rectangle {
                            Layout.preferredWidth: 64
                            Layout.preferredHeight: 36
                            radius: 18
                            color: "#72111a25"
                            border.width: 1
                            border.color: "#24ffffff"
                            Text { anchors.centerIn: parent; text: root.volumePercent + "%"; color: root.textPrimary; font.pixelSize: 12; font.bold: true }
                        }

                        Item { Layout.fillWidth: true }

                        RoundButton {
                            id: fullscreenButton
                            focusPolicy: Qt.NoFocus
                            hoverEnabled: true
                            implicitWidth: 46
                            implicitHeight: 46
                            flat: true
                            onClicked: { root.toggleWindowFullscreenRequested(); root.showControls() }
                            background: Rectangle {
                                radius: width / 2
                                color: root.secondaryFill(fullscreenButton, false)
                                border.width: 1
                                border.color: root.secondaryBorder(fullscreenButton, false)
                            }
                            contentItem: PlayerIcon {
                                name: root.windowIsFullscreen ? "fullscreen-exit" : "fullscreen"
                                strokeColor: "#ffffff"
                                anchors.centerIn: parent
                            }
                        }
                    }
                }
            }
        }
    }

    Connections {
        target: root.Window.window
        ignoreUnknownSignals: true
        function onXChanged() { overlayGeometrySyncTimer.restart() }
        function onYChanged() { overlayGeometrySyncTimer.restart() }
        function onWidthChanged() { overlayGeometrySyncTimer.restart() }
        function onHeightChanged() { overlayGeometrySyncTimer.restart() }
        function onVisibilityChanged() { overlayGeometrySyncTimer.restart() }
        function onVisibleChanged() { overlayGeometrySyncTimer.restart() }
    }

    Timer { id: overlayGeometrySyncTimer; interval: 16; repeat: false; onTriggered: root.syncOverlayWindowGeometry() }
    Timer {
        id: controlsHideTimer
        interval: 3000
        repeat: false
        onTriggered: {
            if (root.autoHideEnabled) {
                root.controlsVisible = false
                overlayGeometrySyncTimer.restart()
            }
        }
    }
}
