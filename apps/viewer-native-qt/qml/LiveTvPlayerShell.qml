import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

Rectangle {
    id: root

    property var channelData: null
    property var controller: null
    property Component videoSurfaceComponent: null
    property bool fullscreen: false
    property bool playerActive: false
    property int filteredCount: 0
    property bool audioMenuOpen: false
    property bool controlsVisible: true
    property bool useOverlayWindow: Qt.platform.os !== "android"

    signal toggleFullscreenRequested()

    readonly property bool hasChannel: channelData !== null
    readonly property bool playbackAllowed: hasChannel && channelData.playbackAllowed !== false
    readonly property bool showEmptyState: filteredCount === 0
    readonly property bool showBlockedState: hasChannel && !playbackAllowed
    readonly property bool showVideoSurface: playerActive && hasChannel && playbackAllowed
    readonly property bool keepControlsVisible: audioMenuOpen || overlayVolumeSlider.pressed
    readonly property var audioTrackItems: controller && controller.audioTracks ? controller.audioTracks : []
    readonly property int volumePercent: Math.round(((controller && controller.muted) ? 0 : (controller ? controller.volume : 1)) * 100)
    readonly property var overlayWindowObject: useOverlayWindow ? overlayWindowLoader.item : null
    readonly property bool overlayWindowActive: showVideoSurface
                                              && viewport.visible
                                              && viewport.width > 1
                                              && viewport.height > 1
                                              && root.Window.window
                                              && root.Window.window.visible
                                              && root.Window.window.active
                                              && Qt.application.state === Qt.ApplicationActive
    readonly property string stateText: !controller
                                        ? "HAZIR"
                                        : controller.state === "playing"
                                          ? "YAYINDA"
                                          : controller.state === "buffering"
                                            ? "BUFFER"
                                            : controller.state === "error"
                                              ? "HATA"
                                              : controller.state === "opening" || controller.state === "resolving"
                                                ? "BAGLANIYOR"
                                                : "HAZIR"

    color: fullscreen ? "#000000" : "#090c13"
    radius: fullscreen ? 0 : 10
    border.width: 0
    border.color: "#14ffffff"
    clip: true

    onAudioMenuOpenChanged: {
        if (audioTrackItems.length === 0) {
            audioMenuOpen = false
            return
        }
        showControls()
    }

    onShowVideoSurfaceChanged: {
        if (!showVideoSurface) {
            controlsHideTimer.stop()
            overlayGeometrySyncTimer.stop()
            controlsVisible = true
            audioMenuOpen = false
            if (root.overlayWindowObject) {
                root.overlayWindowObject.visible = false
            }
            return
        }
        showControls()
        scheduleOverlaySync()
    }

    onKeepControlsVisibleChanged: {
        if (keepControlsVisible) {
            controlsHideTimer.stop()
            controlsVisible = true
            return
        }
        if (showVideoSurface) {
            controlsHideTimer.restart()
        }
    }

    onVisibleChanged: {
        if (!visible) {
            controlsHideTimer.stop()
            overlayGeometrySyncTimer.stop()
            audioMenuOpen = false
            if (root.overlayWindowObject) {
                root.overlayWindowObject.visible = false
            }
        }
    }

    onOverlayWindowActiveChanged: {
        if (!root.useOverlayWindow) {
            return
        }
        if (!root.overlayWindowObject) {
            return
        }
        if (!overlayWindowActive) {
            overlayGeometrySyncTimer.stop()
            audioMenuOpen = false
            root.overlayWindowObject.visible = false
            return
        }
        scheduleOverlaySync()
    }

    Component.onDestruction: {
        controlsHideTimer.stop()
        overlayGeometrySyncTimer.stop()
        if (root.overlayWindowObject) {
            root.overlayWindowObject.visible = false
        }
    }

    function secondaryFill(button, active) {
        if (!button.enabled) return "#42091019"
        if (button.down) return "#96182231"
        if (button.hovered) return "#7d141d29"
        return active ? "#7d111925" : "#640c121a"
    }

    function secondaryBorder(button, active) {
        if (!button.enabled) return "#12ffffff"
        if (active) return "#7affffff"
        return button.hovered ? "#54ffffff" : "#2effffff"
    }

    function accentFill(button) {
        if (!button.enabled) return "#7a4a1318"
        return button.down ? "#f0c40711" : button.hovered ? "#ebf21c28" : "#dce50914"
    }

    function accentTextColor(button) {
        return button.enabled ? "#ffffff" : "#bbd0d8"
    }

    function showControls() {
        controlsVisible = true
        if (showVideoSurface && !keepControlsVisible) {
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
        if (!root.useOverlayWindow) {
            return
        }
        if (!root.overlayWindowObject) {
            return
        }

        const hostWindow = root.Window.window
        if (!hostWindow || !overlayWindowActive) {
            root.overlayWindowObject.visible = false
            return
        }

        const topLeft = viewport.mapToGlobal(0, 0)
        root.overlayWindowObject.x = Math.round(topLeft.x)
        root.overlayWindowObject.y = Math.round(topLeft.y)
        root.overlayWindowObject.width = Math.max(1, Math.round(viewport.width))
        root.overlayWindowObject.height = Math.max(1, Math.round(viewport.height))
        root.overlayWindowObject.visible = true
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

    Rectangle {
        id: viewport
        anchors.fill: parent
        anchors.margins: fullscreen ? 0 : 0
        radius: fullscreen ? 0 : 8
        color: "#000000"
        border.width: 0
        border.color: "#12ffffff"
        clip: true
        onXChanged: root.scheduleOverlaySync()
        onYChanged: root.scheduleOverlaySync()
        onWidthChanged: root.scheduleOverlaySync()
        onHeightChanged: root.scheduleOverlaySync()
        onVisibleChanged: root.scheduleOverlaySync()

        Loader {
            id: videoSurfaceLoader
            anchors.fill: parent
            active: root.showVideoSurface
            sourceComponent: root.videoSurfaceComponent

            onLoaded: {
                if (item) {
                    item.controller = root.controller
                    item.slotIndex = 0
                    if (item.syncSurfaceBinding) {
                        item.syncSurfaceBinding()
                    }
                }
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
                root.toggleFullscreenRequested()
            }
            onClicked: {
                root.audioMenuOpen = false
                root.showControls()
            }
        }

        Rectangle {
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.margins: 18
            width: liveStateLabel.implicitWidth + 24
            height: 34
            radius: 17
            color: "#cc0d121c"
            border.width: 1
            border.color: "#24ffffff"
            visible: root.showVideoSurface && root.controller && root.controller.state !== "playing" && !root.controller.lastError.length

            Text {
                id: liveStateLabel
                anchors.centerIn: parent
                text: root.stateText
                color: "#f7f8fb"
                font.pixelSize: 12
                font.bold: true
            }
        }

        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 18
            width: Math.min(parent.width - 40, liveErrorLabel.implicitWidth + 32)
            height: liveErrorLabel.implicitHeight + 18
            radius: 18
            color: root.controller && root.controller.state === "error" ? "#d120070b" : "#c9151a22"
            border.width: 1
            border.color: root.controller && root.controller.state === "error" ? "#28ff7d86" : "#307cb6ff"
            visible: root.controller && root.controller.lastError.length > 0 && root.hasChannel

            Text {
                id: liveErrorLabel
                anchors.centerIn: parent
                width: parent.width - 24
                text: root.controller ? root.controller.lastError : ""
                color: root.controller && root.controller.state === "error" ? "#ffd5da" : "#d5e6ff"
                font.pixelSize: 12
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }
        }

        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.62, 420)
            spacing: 12
            visible: root.showEmptyState

            Text {
                width: parent.width
                text: "Filtreye uyan kanal bulunamadi"
                color: "#f7f8fb"
                font.pixelSize: 28
                font.family: "Space Grotesk"
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }

            Text {
                width: parent.width
                text: "Aramayı temizleyin veya başka bir kategori seçin."
                color: "#b1bac9"
                font.pixelSize: 14
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }
        }

        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.62, 460)
            spacing: 12
            visible: root.showBlockedState

            Text {
                width: parent.width
                text: "Bu kanalı açmak için aktif paket gerekiyor"
                color: "#f7f8fb"
                font.pixelSize: 30
                font.family: "Space Grotesk"
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }

            Text {
                width: parent.width
                text: "Sağ listeden başka kanal seçin ya da paket durumunuzu güncelleyin."
                color: "#b1bac9"
                font.pixelSize: 14
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
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
        function onActiveChanged() {
            if (!root.Window.window || !root.Window.window.active) {
                root.controlsHideTimer.stop()
                root.overlayGeometrySyncTimer.stop()
                root.audioMenuOpen = false
                if (root.overlayWindowObject) {
                    root.overlayWindowObject.visible = false
                }
                return
            }
            root.scheduleOverlaySync()
        }
    }

    Item {
        id: inlineOverlayHost
        anchors.fill: parent
        z: 10
        visible: !root.useOverlayWindow

        Loader {
            anchors.fill: parent
            active: !root.useOverlayWindow
            sourceComponent: overlayChromeComponent
        }
    }

    Loader {
        id: overlayWindowLoader
        active: root.useOverlayWindow
        sourceComponent: overlayWindowComponent
    }

    Component {
        id: overlayWindowComponent

        Window {
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

            Loader {
                anchors.fill: parent
                active: true
                sourceComponent: overlayChromeComponent
            }
        }
    }

    Component {
        id: overlayChromeComponent

        Item {
            id: overlayRoot
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
                    root.toggleFullscreenRequested()
                }
                onClicked: {
                    root.audioMenuOpen = false
                    root.showControls()
                }
            }

            Rectangle {
                id: audioMenuPanel
                anchors.left: bottomBar.left
                anchors.bottom: bottomBar.top
                anchors.bottomMargin: 10
                width: 260
                radius: 18
                color: "#b310151f"
                border.width: 1
                border.color: "#24ffffff"
                visible: root.audioMenuOpen && root.audioTrackItems.length > 0

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
                            color: root.controller && root.controller.selectedAudioTrackId === modelData.id ? "#1b2634" : overlayTrackMouse.containsMouse ? "#141d29" : "#0c121a"
                            border.width: 1
                            border.color: root.controller && root.controller.selectedAudioTrackId === modelData.id ? "#7cb6ff" : "#1affffff"

                            Text {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: 14
                                anchors.rightMargin: 14
                                text: (modelData.title || "Ses parcasi").toString()
                                color: "#f7f8fb"
                                font.pixelSize: 13
                                elide: Text.ElideRight
                            }

                            MouseArea {
                                id: overlayTrackMouse
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
                anchors.leftMargin: root.fullscreen ? 22 : 16
                anchors.rightMargin: root.fullscreen ? 22 : 16
                anchors.bottomMargin: root.fullscreen ? 22 : 16
                height: 78
                radius: 22
                color: root.fullscreen ? "#40101822" : "#55101822"
                border.width: 1
                border.color: "#26ffffff"
                opacity: root.controlsVisible ? 1.0 : 0.0
                visible: opacity > 0.0 || root.keepControlsVisible
                clip: true

                Behavior on opacity {
                    NumberAnimation { duration: 180; easing.type: Easing.OutCubic }
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 16
                    anchors.rightMargin: 16
                    spacing: 12

                    RoundButton {
                        id: overlayAudioTracksButton
                        implicitWidth: 46
                        implicitHeight: 46
                        text: "\u266B"
                        visible: root.audioTrackItems.length > 0
                        flat: true
                        onClicked: {
                            root.audioMenuOpen = !root.audioMenuOpen
                            root.showControls()
                        }
                        background: Rectangle {
                            radius: width / 2
                            color: root.secondaryFill(overlayAudioTracksButton, root.audioMenuOpen)
                            border.width: 1
                            border.color: root.secondaryBorder(overlayAudioTracksButton, root.audioMenuOpen)
                        }
                        contentItem: Text {
                            text: overlayAudioTracksButton.text
                            color: "#ffffff"
                            font.pixelSize: 20
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }
                    }

                    RoundButton {
                        id: overlayMuteButton
                        implicitWidth: 46
                        implicitHeight: 46
                        text: root.controller && (root.controller.muted || root.controller.volume <= 0) ? "\uD83D\uDD07" : "\uD83D\uDD0A"
                        enabled: root.hasChannel && root.playbackAllowed
                        flat: true
                        onClicked: {
                            if (root.controller) root.controller.toggleMuted()
                            root.showControls()
                        }
                        background: Rectangle {
                            radius: width / 2
                            color: root.secondaryFill(overlayMuteButton, false)
                            border.width: 1
                            border.color: root.secondaryBorder(overlayMuteButton, false)
                        }
                        contentItem: Text {
                            text: overlayMuteButton.text
                            color: "#ffffff"
                            font.pixelSize: 20
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }
                    }

                    Slider {
                        id: overlayVolumeSlider
                        Layout.preferredWidth: root.fullscreen ? 240 : 180
                        Layout.alignment: Qt.AlignVCenter
                        from: 0
                        to: 1
                        value: root.controller && root.controller.muted ? 0 : (root.controller ? root.controller.volume : 1)
                        enabled: root.hasChannel && root.playbackAllowed
                        onMoved: {
                            if (root.controller) root.controller.setVolume(value)
                            root.showControls()
                        }
                        onPressedChanged: root.showControls()

                        background: Rectangle {
                            x: overlayVolumeSlider.leftPadding
                            y: overlayVolumeSlider.topPadding + overlayVolumeSlider.availableHeight / 2 - height / 2
                            implicitWidth: 180
                            implicitHeight: 6
                            width: overlayVolumeSlider.availableWidth
                            height: implicitHeight
                            radius: 3
                            color: "#2cffffff"

                            Rectangle {
                                width: overlayVolumeSlider.visualPosition * parent.width
                                height: parent.height
                                radius: 3
                                color: "#e50914"
                            }
                        }

                        handle: Rectangle {
                            x: overlayVolumeSlider.leftPadding + overlayVolumeSlider.visualPosition * (overlayVolumeSlider.availableWidth - width)
                            y: overlayVolumeSlider.topPadding + overlayVolumeSlider.availableHeight / 2 - height / 2
                            implicitWidth: 18
                            implicitHeight: 18
                            radius: 9
                            color: "#ffffff"
                            border.width: 2
                            border.color: "#e50914"
                        }
                    }

                    Rectangle {
                        Layout.preferredWidth: 60
                        Layout.preferredHeight: 36
                        radius: 18
                        color: "#88151b25"
                        border.width: 1
                        border.color: "#24ffffff"
                        opacity: 0.92

                        Text {
                            anchors.centerIn: parent
                            text: root.volumePercent + "%"
                            color: "#f7f8fb"
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }

                    Item { Layout.fillWidth: true }

                    RoundButton {
                        id: overlayRefreshButton
                        implicitWidth: 46
                        implicitHeight: 46
                        text: "\u21BB"
                        enabled: root.hasChannel && root.playbackAllowed
                        flat: true
                        onClicked: {
                            if (root.controller) root.controller.retryCurrent()
                            root.showControls()
                        }
                        background: Rectangle {
                            radius: width / 2
                            color: root.secondaryFill(overlayRefreshButton, false)
                            border.width: 1
                            border.color: root.secondaryBorder(overlayRefreshButton, false)
                        }
                        contentItem: Text {
                            text: overlayRefreshButton.text
                            color: "#ffffff"
                            font.pixelSize: 22
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }
                    }

                    RoundButton {
                        id: overlayFullscreenButton
                        implicitWidth: 46
                        implicitHeight: 46
                        text: root.fullscreen ? "\u2750" : "\u26F6"
                        enabled: root.hasChannel && root.playbackAllowed
                        flat: true
                        onClicked: {
                            root.toggleFullscreenRequested()
                            root.showControls()
                        }
                        background: Rectangle {
                            radius: width / 2
                            color: root.accentFill(overlayFullscreenButton)
                            border.width: 0
                        }
                        contentItem: Text {
                            text: overlayFullscreenButton.text
                            color: root.accentTextColor(overlayFullscreenButton)
                            font.pixelSize: 20
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }
                    }
                }
            }
        }
    }

    Timer {
        id: overlayGeometrySyncTimer
        interval: 16
        repeat: false
        onTriggered: root.syncOverlayWindowGeometry()
    }

    Timer {
        id: controlsHideTimer
        interval: 3000
        repeat: false
        onTriggered: {
            if (root.showVideoSurface && !root.keepControlsVisible) {
                root.controlsVisible = false
            }
        }
    }
}
