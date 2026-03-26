import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

Rectangle {
    id: root

    property var controller: null
    property var movieData: null
    property Component videoSurfaceComponent: null
    property string titleText: ""
    property string subtitleText: ""
    property string artworkUrl: ""
    property color accentColor: "#ff2432"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property bool compactWindow: false
    property bool windowIsFullscreen: false
    property bool audioMenuOpen: false
    property bool controlsVisible: true
    property bool draggingSeek: false
    property real pendingSeekSeconds: 0

    signal closeRequested()
    signal toggleWindowFullscreenRequested()

    readonly property real gap: compactWindow ? 14 : 18
    readonly property real headerHeight: compactWindow ? 90 : 98
    readonly property real viewportHeight: Math.max(compactWindow ? 340 : 420, Math.min(compactWindow ? 460 : 620, width * 0.54))
    readonly property bool surfaceActive: controller && controller.activeContentKind === "movie"
    readonly property bool posterReady: posterImage.status === Image.Ready && artworkUrl.length > 0
    readonly property bool playbackStarted: controller && (controller.state === "playing" || controller.state === "buffering" || controller.positionSeconds > 0 || controller.durationSeconds > 0)
    readonly property bool posterVisible: posterReady && !playbackStarted
    readonly property bool showCenterState: controller && (controller.state === "opening" || controller.state === "resolving" || controller.state === "error") && !playbackStarted
    readonly property bool keepControlsVisible: audioMenuOpen || seekSlider.pressed || volumeSlider.pressed
    readonly property var audioTrackItems: controller && controller.audioTracks ? controller.audioTracks : []
    readonly property int volumePercent: Math.round(((controller && controller.muted) ? 0 : (controller ? controller.volume : 1)) * 100)
    readonly property bool overlayWindowActive: viewport.visible && viewport.width > 1 && viewport.height > 1
    readonly property real currentPosition: draggingSeek ? pendingSeekSeconds : (controller ? controller.positionSeconds : 0)
    readonly property real progressMaximum: Math.max(1, controller ? controller.durationSeconds : 0)
    readonly property string stateText: !controller
                                        ? "Hazır"
                                        : controller.state === "playing"
                                          ? "Oynuyor"
                                          : controller.state === "buffering"
                                            ? "Buffer"
                                            : controller.state === "error"
                                              ? "Hata"
                                              : controller.state === "opening" || controller.state === "resolving"
                                                ? "Hazırlanıyor"
                                                : "Hazır"

    color: windowIsFullscreen ? "#000000" : "#090c13"
    radius: windowIsFullscreen ? 0 : 28
    border.width: windowIsFullscreen ? 0 : 1
    border.color: "#16ffffff"
    clip: true
    implicitHeight: headerHeight + gap + viewportHeight

    function monogram(value) {
        const parts = (value || "").toString().trim().split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < parts.length; index += 1) {
            output += (parts[index][0] || "").toUpperCase()
        }
        return output.length ? output : "FX"
    }

    function formatClock(seconds) {
        const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const remainingSeconds = totalSeconds % 60
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
        }
        return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    }

    function currentAudioIndex() {
        const tracks = audioTrackItems
        for (let index = 0; index < tracks.length; index += 1) {
            if (tracks[index].id === controller.selectedAudioTrackId) {
                return index
            }
        }
        return -1
    }

    function showControls() {
        controlsVisible = true
        if (overlayWindowActive && !keepControlsVisible) {
            controlsHideTimer.restart()
        } else {
            controlsHideTimer.stop()
        }
        scheduleOverlaySync()
    }

    function scheduleOverlaySync() {
        overlayGeometrySyncTimer.restart()
    }

    function syncOverlayWindowGeometry() {
        if (!overlayWindow) {
            return
        }

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

    function refreshSurfaceBinding() {
        if (videoSurfaceLoader.item) {
            videoSurfaceLoader.item.controller = root.controller
            videoSurfaceLoader.item.slotIndex = 0
            if (videoSurfaceLoader.item.syncSurfaceBinding) {
                videoSurfaceLoader.item.syncSurfaceBinding()
            }
        }
        if (root.controller && root.controller.refreshVideoLayout) {
            root.controller.refreshVideoLayout()
        }
    }

    function headerButtonFill(button, accent) {
        if (!button.enabled) return "#28131a24"
        if (accent) return button.down ? "#d71320" : button.hovered ? "#ef2a37" : root.accentColor
        if (button.down) return "#283243"
        if (button.hovered) return "#212b3b"
        return "#18212d"
    }

    component HeaderButton: Button {
        id: headerButton
        property bool accent: false
        hoverEnabled: true
        focusPolicy: Qt.NoFocus
        implicitHeight: 44
        leftPadding: 18
        rightPadding: 18

        background: Rectangle {
            radius: 16
            color: root.headerButtonFill(headerButton, headerButton.accent)
            border.width: headerButton.accent ? 0 : 1
            border.color: headerButton.accent ? "transparent" : "#24ffffff"
        }

        contentItem: Text {
            text: headerButton.text
            color: "#ffffff"
            font.pixelSize: 14
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component OverlayButton: Button {
        id: overlayButton
        property bool accent: false
        hoverEnabled: true
        focusPolicy: Qt.NoFocus
        implicitHeight: 42
        leftPadding: 16
        rightPadding: 16

        background: Rectangle {
            radius: 16
            color: overlayButton.accent
                   ? (overlayButton.down ? "#d71320" : overlayButton.hovered ? "#ef2a37" : root.accentColor)
                   : (overlayButton.down ? "#af111721" : overlayButton.hovered ? "#97141b27" : "#7d0d131c")
            border.width: overlayButton.accent ? 0 : 1
            border.color: overlayButton.accent ? "transparent" : "#2effffff"
        }

        contentItem: Text {
            text: overlayButton.text
            color: "#ffffff"
            font.pixelSize: 13
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    onAudioMenuOpenChanged: {
        if (audioTrackItems.length === 0) {
            audioMenuOpen = false
            return
        }
        showControls()
    }

    onWindowIsFullscreenChanged: {
        showControls()
        scheduleOverlaySync()
    }

    onPlaybackStartedChanged: {
        showControls()
        scheduleOverlaySync()
    }

    Rectangle {
        id: headerCard
        width: parent.width
        height: root.headerHeight
        radius: root.windowIsFullscreen ? 0 : 28
        color: "#0a0e15"
        border.width: root.windowIsFullscreen ? 0 : 1
        border.color: "#18ffffff"

        RowLayout {
            anchors.fill: parent
            anchors.margins: compactWindow ? 16 : 18
            spacing: 16

            Rectangle {
                Layout.preferredWidth: compactWindow ? 58 : 64
                Layout.preferredHeight: compactWindow ? 58 : 64
                radius: 20
                color: "#101722"
                border.width: 1
                border.color: "#1effffff"
                clip: true

                Image {
                    anchors.fill: parent
                    anchors.margins: 1
                    source: root.artworkUrl
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    cache: true
                    visible: root.posterReady
                }

                Text {
                    anchors.centerIn: parent
                    visible: !root.posterReady
                    text: root.monogram(root.titleText)
                    color: root.textPrimary
                    font.pixelSize: 22
                    font.bold: true
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 4

                Text {
                    text: root.titleText.length ? root.titleText : "Film seçin"
                    color: root.textPrimary
                    font.pixelSize: compactWindow ? 24 : 30
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }

                Text {
                    text: root.subtitleText.length ? root.subtitleText : "Film"
                    color: root.textMuted
                    font.pixelSize: 13
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
            }

            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                Layout.preferredWidth: headerStateText.implicitWidth + 24
                Layout.preferredHeight: 34
                radius: 17
                color: root.controller && root.controller.state === "error" ? "#35161c" : "#141c27"
                border.width: 1
                border.color: root.controller && root.controller.state === "error" ? "#44ff7d86" : "#24ffffff"

                Text {
                    id: headerStateText
                    anchors.centerIn: parent
                    text: root.stateText
                    color: root.textPrimary
                    font.pixelSize: 12
                    font.bold: true
                }
            }

            HeaderButton {
                text: root.windowIsFullscreen ? "Pencereli" : "Tam Ekran"
                onClicked: root.toggleWindowFullscreenRequested()
            }

            HeaderButton {
                text: "Kapat"
                onClicked: root.closeRequested()
            }
        }
    }

    Rectangle {
        id: viewport
        y: headerCard.height + root.gap
        width: parent.width
        height: root.viewportHeight
        radius: root.windowIsFullscreen ? 0 : 28
        color: "#000000"
        border.width: root.windowIsFullscreen ? 0 : 1
        border.color: "#18ffffff"
        clip: true
        onXChanged: root.scheduleOverlaySync()
        onYChanged: root.scheduleOverlaySync()
        onWidthChanged: root.scheduleOverlaySync()
        onHeightChanged: root.scheduleOverlaySync()
        onVisibleChanged: root.scheduleOverlaySync()

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#2ce50914" }
                GradientStop { position: 0.46; color: "#183364c7" }
                GradientStop { position: 1.0; color: "#f0060910" }
            }
            visible: !root.playbackStarted
        }

        Image {
            id: posterImage
            anchors.fill: parent
            anchors.margins: root.windowIsFullscreen ? 0 : 1
            source: root.artworkUrl
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            cache: true
            visible: root.posterVisible
        }

        Loader {
            id: videoSurfaceLoader
            anchors.fill: parent
            active: root.surfaceActive
            visible: active
            sourceComponent: root.videoSurfaceComponent

            onLoaded: {
                if (item) {
                    item.controller = root.controller
                    item.slotIndex = 0
                    if (item.syncSurfaceBinding) {
                        item.syncSurfaceBinding()
                    }
                }
                root.scheduleOverlaySync()
            }
        }

        Connections {
            target: videoSurfaceLoader.item

            function onPointerActivity() {
                root.showControls()
            }
        }

        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            acceptedButtons: Qt.LeftButton
            onEntered: root.showControls()
            onPositionChanged: root.showControls()
            onPressed: root.showControls()
            onDoubleClicked: {
                root.showControls()
                root.toggleWindowFullscreenRequested()
            }
            onClicked: {
                root.audioMenuOpen = false
                root.showControls()
            }
        }

        Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.margins: 18
            width: filmBadgeText.implicitWidth + 24
            height: 34
            radius: 17
            color: "#cc0d121c"
            border.width: 1
            border.color: "#24ffffff"
            visible: !root.playbackStarted

            Text {
                id: filmBadgeText
                anchors.centerIn: parent
                text: "Film Oynatıcı"
                color: root.textPrimary
                font.pixelSize: 12
                font.bold: true
            }
        }

        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width - 56, compactWindow ? 340 : 420)
            height: compactWindow ? 184 : 204
            radius: 24
            color: "#df0c111a"
            border.width: 1
            border.color: "#2effffff"
            visible: root.showCenterState

            Column {
                anchors.fill: parent
                anchors.margins: 20
                spacing: 10

                Text {
                    text: root.controller && root.controller.state === "error" ? "Film kaynağı açılamadı" : "Film hazırlanıyor"
                    color: root.textPrimary
                    font.pixelSize: 24
                    font.bold: true
                }

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: root.controller && root.controller.lastError.length
                          ? root.controller.lastError
                          : "Native VOD kaynağı açılıyor. İlk kare geldikten sonra poster otomatik gizlenecek."
                    color: root.controller && root.controller.state === "error" ? "#ffb2b8" : root.textMuted
                    font.pixelSize: 14
                }

                Row {
                    spacing: 10

                    HeaderButton {
                        text: "Tekrar Dene"
                        accent: true
                        visible: root.controller && root.controller.state === "error"
                        onClicked: if (root.controller) root.controller.retryCurrent()
                    }

                    HeaderButton {
                        text: "Kapat"
                        onClicked: root.closeRequested()
                    }
                }
            }
        }
    }

    Connections {
        target: root.Window.window
        ignoreUnknownSignals: true

        function onXChanged() { root.scheduleOverlaySync() }
        function onYChanged() { root.scheduleOverlaySync() }
        function onWidthChanged() { root.scheduleOverlaySync() }
        function onHeightChanged() { root.scheduleOverlaySync() }
        function onVisibilityChanged() { root.scheduleOverlaySync() }
        function onVisibleChanged() { root.scheduleOverlaySync() }
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

        onVisibleChanged: {
            if (!visible) {
                root.audioMenuOpen = false
            }
        }

        Item {
            anchors.fill: parent

            MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton
                onEntered: root.showControls()
                onPositionChanged: root.showControls()
                onPressed: root.showControls()
                onDoubleClicked: {
                    root.showControls()
                    root.toggleWindowFullscreenRequested()
                }
                onClicked: {
                    root.audioMenuOpen = false
                    root.showControls()
                }
            }

            Rectangle {
                anchors.fill: parent
                color: "#00000000"
            }

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 180
                visible: root.controlsVisible
                color: "#00000000"

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 132
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: "#00000000" }
                        GradientStop { position: 1.0; color: "#d7000000" }
                    }
                }
            }

            Rectangle {
                id: audioMenuPanel
                anchors.right: bottomBar.right
                anchors.bottom: bottomBar.top
                anchors.bottomMargin: 10
                width: 240
                radius: 18
                color: "#c90d131c"
                border.width: 1
                border.color: "#2effffff"
                visible: root.controlsVisible && root.audioMenuOpen && root.audioTrackItems.length > 0

                Column {
                    anchors.fill: parent
                    anchors.margins: 10
                    spacing: 8

                    Repeater {
                        model: root.audioTrackItems

                        Rectangle {
                            required property var modelData
                            width: parent.width
                            height: 42
                            radius: 12
                            color: root.controller && root.controller.selectedAudioTrackId === modelData.id ? "#1b2634" : audioTrackMouse.containsMouse ? "#141d29" : "#0c121a"
                            border.width: 1
                            border.color: root.controller && root.controller.selectedAudioTrackId === modelData.id ? "#7cb6ff" : "#1affffff"

                            Text {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: 14
                                anchors.rightMargin: 14
                                text: (modelData.title || modelData.language || "Ses parçası").toString()
                                color: "#f7f8fb"
                                font.pixelSize: 13
                                elide: Text.ElideRight
                            }

                            MouseArea {
                                id: audioTrackMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (root.controller) {
                                        root.controller.selectAudioTrack(modelData.id)
                                    }
                                    root.audioMenuOpen = false
                                    root.showControls()
                                }
                            }
                        }
                    }
                }
            }

            Rectangle {
                id: bottomBar
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.leftMargin: root.windowIsFullscreen ? 24 : 18
                anchors.rightMargin: root.windowIsFullscreen ? 24 : 18
                anchors.bottomMargin: root.windowIsFullscreen ? 24 : 18
                height: root.compactWindow ? 102 : 112
                radius: 24
                color: "#bf0a1016"
                border.width: 1
                border.color: "#2effffff"
                visible: root.controlsVisible

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: root.compactWindow ? 14 : 16
                    spacing: 12

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 12

                        Text {
                            text: root.formatClock(root.currentPosition)
                            color: root.textPrimary
                            font.pixelSize: 13
                            font.bold: true
                        }

                        Slider {
                            id: seekSlider
                            Layout.fillWidth: true
                            from: 0
                            to: root.progressMaximum
                            value: root.draggingSeek ? root.pendingSeekSeconds : (root.controller ? root.controller.positionSeconds : 0)
                            enabled: root.controller && root.controller.durationSeconds > 0

                            onMoved: {
                                root.draggingSeek = true
                                root.pendingSeekSeconds = value
                                root.showControls()
                            }

                            onPressedChanged: {
                                root.showControls()
                                if (pressed) {
                                    root.draggingSeek = true
                                    root.pendingSeekSeconds = value
                                    return
                                }
                                if (root.controller) {
                                    root.controller.seekTo(value)
                                }
                                root.draggingSeek = false
                            }

                            background: Rectangle {
                                x: seekSlider.leftPadding
                                y: seekSlider.topPadding + seekSlider.availableHeight / 2 - height / 2
                                width: seekSlider.availableWidth
                                height: 6
                                radius: 3
                                color: "#22ffffff"

                                Rectangle {
                                    width: seekSlider.visualPosition * parent.width
                                    height: parent.height
                                    radius: 3
                                    color: root.accentColor
                                }
                            }

                            handle: Rectangle {
                                x: seekSlider.leftPadding + seekSlider.visualPosition * (seekSlider.availableWidth - width)
                                y: seekSlider.topPadding + seekSlider.availableHeight / 2 - height / 2
                                width: 16
                                height: 16
                                radius: 8
                                color: "#ffffff"
                                border.width: 1
                                border.color: "#44ffffff"
                            }
                        }

                        Text {
                            text: root.formatClock(root.controller ? root.controller.durationSeconds : 0)
                            color: root.textMuted
                            font.pixelSize: 13
                            font.bold: true
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        OverlayButton {
                            text: root.controller && root.controller.paused ? "Play" : "Pause"
                            accent: true
                            enabled: root.controller !== null
                            onClicked: if (root.controller) root.controller.togglePause()
                        }

                        OverlayButton {
                            text: root.controller && (root.controller.muted || root.controller.volume <= 0) ? "Ses Aç" : "Sessiz"
                            enabled: root.controller !== null
                            onClicked: if (root.controller) root.controller.toggleMuted()
                        }

                        Slider {
                            id: volumeSlider
                            Layout.preferredWidth: root.compactWindow ? 120 : 160
                            from: 0
                            to: 1
                            value: root.controller && root.controller.muted ? 0 : (root.controller ? root.controller.volume : 1)
                            stepSize: 0.01
                            enabled: root.controller !== null

                            onMoved: {
                                if (root.controller) {
                                    root.controller.setVolume(value)
                                }
                                root.showControls()
                            }

                            onPressedChanged: root.showControls()

                            background: Rectangle {
                                x: volumeSlider.leftPadding
                                y: volumeSlider.topPadding + volumeSlider.availableHeight / 2 - height / 2
                                width: volumeSlider.availableWidth
                                height: 6
                                radius: 3
                                color: "#22ffffff"

                                Rectangle {
                                    width: volumeSlider.visualPosition * parent.width
                                    height: parent.height
                                    radius: 3
                                    color: root.accentColor
                                }
                            }

                            handle: Rectangle {
                                x: volumeSlider.leftPadding + volumeSlider.visualPosition * (volumeSlider.availableWidth - width)
                                y: volumeSlider.topPadding + volumeSlider.availableHeight / 2 - height / 2
                                width: 16
                                height: 16
                                radius: 8
                                color: "#ffffff"
                                border.width: 1
                                border.color: "#44ffffff"
                            }
                        }

                        Rectangle {
                            Layout.preferredWidth: 68
                            Layout.preferredHeight: 38
                            radius: 19
                            color: "#6b151d28"
                            border.width: 1
                            border.color: "#24ffffff"

                            Text {
                                anchors.centerIn: parent
                                text: `${root.volumePercent}%`
                                color: root.textPrimary
                                font.pixelSize: 12
                                font.bold: true
                            }
                        }

                        Item {
                            Layout.fillWidth: true
                        }

                        OverlayButton {
                            text: "Dil"
                            visible: root.audioTrackItems.length > 0
                            enabled: visible
                            onClicked: {
                                root.audioMenuOpen = !root.audioMenuOpen
                                root.showControls()
                            }
                        }

                        OverlayButton {
                            text: root.windowIsFullscreen ? "Pencereli" : "Tam Ekran"
                            onClicked: root.toggleWindowFullscreenRequested()
                        }

                        OverlayButton {
                            text: "Kapat"
                            onClicked: root.closeRequested()
                        }
                    }
                }
            }
        }
    }

    Timer {
        id: controlsHideTimer
        interval: 3000
        repeat: false
        onTriggered: {
            if (!root.keepControlsVisible) {
                root.controlsVisible = false
                root.scheduleOverlaySync()
            }
        }
    }

    Timer {
        id: overlayGeometrySyncTimer
        interval: 0
        repeat: false
        onTriggered: root.syncOverlayWindowGeometry()
    }

    Connections {
        target: root.controller

        function onVolumeChanged() {
            root.showControls()
        }

        function onMutedChanged() {
            root.showControls()
        }

        function onStateChanged() {
            if (root.controller && root.controller.state === "playing") {
                root.draggingSeek = false
            }
            root.showControls()
        }
    }
}
