import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import Flixify.Native 1.0

Window {
    id: videoWindow
    objectName: "playerWindow"
    property var owner
    signal seriesRequested(var media)
    transientParent: owner
    title: player.title ? player.title + " · Flixify Pro" : "Flixify Pro"
    width: owner ? owner.width : 1280
    height: owner ? owner.height : 800
    minimumWidth: 900
    minimumHeight: 620
    x: owner ? owner.x : 100
    y: owner ? owner.y : 100
    color: "black"
    property bool playbackActive: player.active
    property bool playbackFullScreen: player.fullScreen
    property bool ownsActiveWindow: desktopFocusedWindow === videoWindow || desktopFocusedWindow === controlsWindow
    property point lastPointerPosition: Qt.point(-100000, -100000)
    function pointerMoved(x, y) {
        if (Math.abs(x - lastPointerPosition.x) < 0.5 && Math.abs(y - lastPointerPosition.y) < 0.5) return
        lastPointerPosition = Qt.point(x, y)
        player.interact()
    }
    onPlaybackActiveChanged: {
        if (!playbackActive) pointerClick.stop()
        Qt.callLater(synchronizeVisibility)
    }
    onPlaybackFullScreenChanged: Qt.callLater(synchronizeVisibility)
    Component.onCompleted: synchronizeVisibility()
    function synchronizeVisibility() {
        if (!playbackActive) hide()
        else if (playbackFullScreen) showFullScreen()
        else showNormal()
    }
    onClosing: function (close) {
        close.accepted = false;
        player.close();
    }
    onVisibleChanged: if (visible) {
        requestActivate();
    }
    function clock(milliseconds) {
        const seconds = Math.max(0, Math.floor(milliseconds / 1000));
        return (seconds >= 3600 ? Math.floor(seconds / 3600) + ":" : "") + (seconds >= 3600 ? String(Math.floor(seconds / 60) % 60).padStart(2, "0") : Math.floor(seconds / 60)) + ":" + String(seconds % 60).padStart(2, "0");
    }
    function trackName(track, index) {
        return typeof track === "string" ? track : track.title || track.name || track.label || "Parça " + (index + 1);
    }
    function trackID(track, index) {
        return typeof track === "object" && track.id !== undefined ? track.id : index;
    }
    NativeVideoSurface {
        id: surface
        objectName: "nativeVideoSurface"
        playbackController: player
        anchors.fill: parent
        mousePassthrough: false
        focus: true
        Keys.onEscapePressed: if (!controlsWindow.menuOpen) player.close()
        onSurfaceHandleChanged: player.setSurface(surfaceHandle)
        onPointerActivity: function(globalPosition) { videoWindow.pointerMoved(globalPosition.x, globalPosition.y) }
    }
    Shortcut {
        sequence: "Space"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: {
            player.togglePause();
            player.interact();
        }
    }
    Shortcut {
        sequence: "Left"
        enabled: player.active && videoWindow.ownsActiveWindow && !player.live && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: {
            player.seekBy(-10);
            player.interact();
        }
    }
    Shortcut {
        sequence: "Right"
        enabled: player.active && videoWindow.ownsActiveWindow && !player.live && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: {
            player.seekBy(10);
            player.interact();
        }
    }
    Shortcut {
        sequence: "F"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen
        context: Qt.ApplicationShortcut
        onActivated: {
            player.setFullScreen(!player.fullScreen);
            player.interact();
        }
    }
    Shortcut {
        sequence: "Up"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: {
            player.setVolume(Math.min(100, player.volume + 5));
            player.interact();
        }
    }
    Shortcut {
        sequence: "Down"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: {
            player.setVolume(Math.max(0, player.volume - 5));
            player.interact();
        }
    }
    Window {
        id: controlsWindow
        objectName: "playerOverlay"
        transientParent: videoWindow
        flags: Qt.Tool | Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint
        // Zero-alpha Win32 pixels pass clicks through to VLC instead of the controls.
        color: "#01000000"
        x: videoWindow.x
        y: videoWindow.y
        width: videoWindow.width
        height: videoWindow.height
        visible: videoWindow.visible && videoWindow.visibility !== Window.Minimized
        onVisibleChanged: if (visible)
            requestActivate()
        onClosing: function (close) {
            close.accepted = false;
            player.close();
        }
        property bool menuOpen: audioMenu.visible || subtitleMenu.visible || episodeMenu.visible
        property bool controlFocused: isControlFocus(activeFocusItem)
        function isControlFocus(item) {
            while (item && item !== contentItem) {
                if (item.handlesPlaybackKeys === true || item === timeline || item === volumeSlider) return true
                item = item.parent
            }
            return false
        }
        property bool held: menuOpen || timeline.pressed || volumeSlider.pressed
        onHeldChanged: player.holdControls(held)
        onActiveFocusItemChanged: if (active && player.controlsVisible && controlFocused) player.interact()
        Item {
            anchors.fill: parent
            focus: true
            Keys.onEscapePressed: if (!controlsWindow.menuOpen) player.close()
            Keys.onPressed: function(event) {
                if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
                    player.interact()
                    event.accepted = false
                }
            }
            HoverHandler {
                id: hover
                objectName: "videoHover"
                onPointChanged: if (hovered) {
                    const globalPosition = parent.mapToGlobal(point.scenePosition.x, point.scenePosition.y)
                    videoWindow.pointerMoved(globalPosition.x, globalPosition.y)
                }
            }
            MouseArea {
                objectName: "videoPointerArea"
                anchors.fill: parent
                hoverEnabled: true
                onPositionChanged: function(event) {
                    if (containsMouse) {
                        const globalPosition = mapToGlobal(event.x, event.y)
                        videoWindow.pointerMoved(globalPosition.x, globalPosition.y)
                    }
                }
                onClicked: {
                    player.interact();
                    pointerClick.restart();
                }
                onDoubleClicked: { pointerClick.stop(); player.setFullScreen(!player.fullScreen) }
            }
            Timer { id: pointerClick; objectName: "videoSingleClickTimer"; interval: Qt.styleHints.mouseDoubleClickInterval; onTriggered: if (player.active) player.togglePause() }
            Rectangle {
                anchors.top: parent.top
                width: parent.width
                height: 140
                visible: player.controlsVisible
                gradient: Gradient {
                    GradientStop {
                        position: 0
                        color: "#C9000000"
                    }
                    GradientStop {
                        position: 1
                        color: "transparent"
                    }
                }
            }
            RowLayout {
                visible: player.controlsVisible
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 25
                spacing: 16
                ActionButton {
                    text: "Geri"
                    symbol: "‹"
                    quiet: true
                    onHoveredChanged: if (hovered)
                        player.interact()
                    onClicked: player.close()
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5
                    Text {
                        text: player.title
                        color: "#F5F6F8"
                        font.pixelSize: 19
                        font.weight: Font.DemiBold
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                    Text {
                        text: player.live ? "Canlı yayın" : player.item.kind === "episode" ? player.item.season + ". Sezon · " + player.item.episode + ". Bölüm" : "Film"
                        color: "#C4CBD5"
                        font.pixelSize: 12
                    }
                }
                ActionButton {
                    symbol: {
                        repository.libraryRevision;
                        return player.item.id && repository.isFavorite(player.item) ? "♥" : "♡";
                    }
                    accessibleLabel: "Favorileri değiştir"
                    quiet: true
                    onHoveredChanged: if (hovered)
                        player.interact()
                    onClicked: {
                        repository.toggleFavorite(player.item);
                        player.interact();
                    }
                }
            }
            Column {
                anchors.centerIn: parent
                spacing: 18
                visible: player.loading || !!player.error
                BusyIndicator {
                    anchors.horizontalCenter: parent.horizontalCenter
                    running: player.loading
                    visible: running
                    palette.dark: "#F5F6F8"
                }
                Text {
                    text: player.error || "Açılıyor…"
                    color: "#F5F6F8"
                    font.pixelSize: 16
                    wrapMode: Text.WordWrap
                    width: Math.min(460, controlsWindow.width - 80)
                    horizontalAlignment: Text.AlignHCenter
                }
                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 12
                    visible: !!player.error
                    ActionButton {
                        text: "Tekrar dene"
                        prominent: true
                        onClicked: repository.refreshPlayback(player.item)
                    }
                    ActionButton {
                        text: "Geri dön"
                        onClicked: player.close()
                    }
                }
            }
            Rectangle {
                visible: player.nextCountdown > 0
                anchors.right: parent.right
                anchors.rightMargin: 28
                anchors.bottom: footer.top
                anchors.bottomMargin: 18
                width: Math.min(400, parent.width - 56)
                height: 138
                radius: 14
                color: "#F013171E"
                border.color: "#46505E"
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 18
                    spacing: 10
                    Text {
                        text: player.nextCountdown + " saniye sonra sıradaki bölüm"
                        color: "#F5F6F8"
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                    Text {
                        text: player.nextItem.title || ""
                        color: "#A7B0BE"
                        font.pixelSize: 13
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                    RowLayout {
                        spacing: 10
                        ActionButton {
                            text: "Şimdi izle"
                            prominent: true
                            onClicked: player.playNext()
                        }
                        ActionButton {
                            text: "İptal"
                            onClicked: player.cancelNext()
                        }
                    }
                }
            }
            Item {
                id: footer
                anchors.bottom: parent.bottom
                width: parent.width
                height: player.live ? 122 : 160
                visible: player.controlsVisible
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop {
                            position: 0
                            color: "transparent"
                        }
                        GradientStop {
                            position: 0.5
                            color: "#D9000000"
                        }
                        GradientStop {
                            position: 1
                            color: "#F0000000"
                        }
                    }
                }
                ColumnLayout {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: 26
                    anchors.rightMargin: 26
                    anchors.bottomMargin: 22
                    spacing: 10
                    RowLayout {
                        visible: !player.live
                        Layout.fillWidth: true
                        spacing: 14
                        Text {
                            text: videoWindow.clock(timeline.pressed ? timeline.value : player.positionMs)
                            color: "#F5F6F8"
                            font.pixelSize: 12
                            font.family: "Consolas"
                            Layout.preferredWidth: 58
                        }
                        Slider {
                            id: timeline
                            objectName: "playerTimeline"
                            Layout.fillWidth: true
                            from: 0
                            to: Math.max(1, player.durationMs)
                            stepSize: 10000
                            property real pendingSeek: 0
                            Binding {
                                target: timeline
                                property: "value"
                                value: player.positionMs
                                when: !timeline.pressed
                                restoreMode: Binding.RestoreNone
                            }
                            enabled: player.durationMs > 0
                            Accessible.name: "Oynatma konumu"
                            onMoved: {
                                pendingSeek = value
                                player.interact()
                                if (!pressed) player.seek(Math.round(pendingSeek))
                            }
                            onPressedChanged: {
                                if (pressed)
                                    pendingSeek = value;
                                else
                                    player.seek(Math.round(pendingSeek));
                                player.interact();
                            }
                            background: Rectangle {
                                x: timeline.leftPadding
                                y: timeline.topPadding + timeline.availableHeight / 2 - 2
                                width: timeline.availableWidth
                                height: 4
                                radius: 2
                                color: "#707985"
                                Rectangle {
                                    width: timeline.visualPosition * parent.width
                                    height: 4
                                    radius: 2
                                    color: "#FF3545"
                                }
                            }
                            handle: Rectangle {
                                x: timeline.leftPadding + timeline.visualPosition * (timeline.availableWidth - width)
                                y: timeline.topPadding + timeline.availableHeight / 2 - height / 2
                                width: 13
                                height: 13
                                radius: 7
                                color: "#F5F6F8"
                                border.color: timeline.activeFocus ? "#FF3545" : "transparent"
                                border.width: 2
                            }
                        }
                        Text {
                            text: videoWindow.clock(player.durationMs)
                            color: "#B8C0CC"
                            font.pixelSize: 12
                            font.family: "Consolas"
                            Layout.preferredWidth: 58
                            horizontalAlignment: Text.AlignRight
                        }
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10
                        ActionButton {
                            symbol: player.playing ? "Ⅱ" : "▶"
                            accessibleLabel: player.playing ? "Duraklat" : "Oynat"
                            quiet: true
                            onHoveredChanged: if (hovered)
                                player.interact()
                            onClicked: {
                                player.togglePause();
                                player.interact();
                            }
                        }
                        ActionButton {
                            visible: !player.live
                            symbol: "−10"
                            accessibleLabel: "10 saniye geri sar"
                            quiet: true
                            onHoveredChanged: if (hovered)
                                player.interact()
                            onClicked: {
                                player.seekBy(-10);
                                player.interact();
                            }
                        }
                        ActionButton {
                            visible: !player.live
                            symbol: "+10"
                            accessibleLabel: "10 saniye ileri sar"
                            quiet: true
                            onHoveredChanged: if (hovered)
                                player.interact()
                            onClicked: {
                                player.seekBy(10);
                                player.interact();
                            }
                        }
                        ActionButton {
                            visible: player.live
                            symbol: "‹"
                            accessibleLabel: "Önceki kanal"
                            quiet: true
                            onClicked: player.switchChannel(-1)
                        }
                        ActionButton {
                            visible: player.live
                            symbol: "›"
                            accessibleLabel: "Sonraki kanal"
                            quiet: true
                            onClicked: player.switchChannel(1)
                        }
                        Text {
                            visible: player.live
                            text: "● CANLI"
                            color: "#FF6672"
                            font.pixelSize: 12
                            font.weight: Font.DemiBold
                        }
                        Item {
                            Layout.fillWidth: true
                        }
                        ActionButton {
                        objectName: "playerAudioAction"
                            text: "Ses"
                            quiet: true
                            enabled: player.audioTracks.length > 0
                            onClicked: {
                                audioMenu.popup();
                                player.interact();
                            }
                        }
                        ActionButton {
                        objectName: "playerSubtitleAction"
                            text: "Altyazı"
                            quiet: true
                            onClicked: {
                                subtitleMenu.popup();
                                player.interact();
                            }
                        }
                        ActionButton {
                            visible: player.item.kind === "episode"
                            text: "Bölümler"
                            quiet: true
                            onClicked: {
                                episodeMenu.popup();
                                player.interact();
                            }
                        }
                        ActionButton {
                            visible: !!player.nextItem.id
                            symbol: "▸▏"
                            accessibleLabel: "Sonraki bölüm"
                            quiet: true
                            onClicked: player.playNext()
                        }
                        ActionButton {
                            symbol: player.muted || player.volume === 0 ? "×♪" : "♪"
                            accessibleLabel: player.muted ? "Sesi aç" : "Sesi kapat"
                            quiet: true
                            onClicked: {
                                player.setMuted(!player.muted);
                                player.interact();
                            }
                        }
                        Slider {
                            id: volumeSlider
                            objectName: "playerVolume"
                            Layout.preferredWidth: controlsWindow.width < 1050 ? 68 : 100
                            from: 0
                            to: 100
                            stepSize: 1
                            value: player.muted ? 0 : player.volume
                            Accessible.name: "Ses düzeyi"
                            onMoved: {
                                player.setVolume(Math.round(value));
                                player.interact();
                            }
                        }
                        ActionButton {
                            symbol: player.fullScreen ? "⊡" : "⛶"
                            accessibleLabel: player.fullScreen ? "Tam ekrandan çık" : "Tam ekran"
                            quiet: true
                            onClicked: {
                                player.setFullScreen(!player.fullScreen);
                                player.interact();
                            }
                        }
                    }
                }
            }
            Menu {
                id: audioMenu
                popupType: Popup.Item
                objectName: "playerAudioMenu"
                title: "Ses parçaları"
                Instantiator {
                    model: player.audioTracks
                    delegate: MenuItem {
                        required property var modelData
                        required property int index
                        text: videoWindow.trackName(modelData, index)
                        checkable: true
                        checked: player.audioTrack === videoWindow.trackID(modelData, index)
                        onTriggered: {
                            player.selectAudio(videoWindow.trackID(modelData, index));
                            player.interact();
                        }
                    }
                    onObjectAdded: (index, object) => audioMenu.insertItem(index, object)
                    onObjectRemoved: (index, object) => audioMenu.removeItem(object)
                }
            }
            Menu {
                id: subtitleMenu
                popupType: Popup.Item
                objectName: "playerSubtitleMenu"
                title: "Altyazılar"
                MenuItem {
                    text: "Kapalı"
                    checkable: true
                    checked: player.subtitleTrack === -1
                    onTriggered: player.selectSubtitle(-1)
                }
                Instantiator {
                    model: player.subtitleTracks.filter(function(track) { return track.id !== -1 })
                    delegate: MenuItem {
                        required property var modelData
                        required property int index
                        text: videoWindow.trackName(modelData, index)
                        checkable: true
                        checked: player.subtitleTrack === videoWindow.trackID(modelData, index)
                        onTriggered: {
                            player.selectSubtitle(videoWindow.trackID(modelData, index));
                            player.interact();
                        }
                    }
                    onObjectAdded: (index, object) => subtitleMenu.insertItem(index + 1, object)
                    onObjectRemoved: (index, object) => subtitleMenu.removeItem(object)
                }
            }
            Menu {
                id: episodeMenu
                popupType: Popup.Item
                title: "Bölümler"
                MenuItem {
                    enabled: !!player.nextItem.id
                    text: "Sonraki bölümü izle"
                    onTriggered: player.playNext()
                }
                MenuItem {
                    text: "Sezon ve bölümleri seç"
                    onTriggered: {
                        let current = player.item;
                        player.close();
                        if (current.seriesID)
                            videoWindow.seriesRequested({
                                id: current.seriesID,
                                kind: "series",
                                title: current.seriesTitle || current.title,
                                artworkURL: current.artworkURL,
                                scope: current.scope
                            });
                    }
                }
            }
        }
    }
}
