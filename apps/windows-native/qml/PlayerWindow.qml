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
    property string programmeItemID: ""
    property var currentProgramme: repository.programmes.find(function(programme) { return programme.startsAt <= Date.now() && programme.endsAt > Date.now() }) || ({})
    property var episodeItems: {
        const detail = repository.seriesDetail
        if (!detail.series || String(detail.series.id) !== String(player.item.seriesID)) return []
        let episodes = []
        for (const season of detail.seasons || []) episodes = episodes.concat(season.episodes || [])
        return episodes
    }
    function pointerMoved(x, y) {
        if (Math.abs(x - lastPointerPosition.x) < 0.5 && Math.abs(y - lastPointerPosition.y) < 0.5) return
        lastPointerPosition = Qt.point(x, y)
        player.interact()
    }
    onPlaybackActiveChanged: {
        if (!playbackActive) {
            pointerClick.stop()
            controlsWindow.dismissPanels()
            programmeItemID = ""
        }
        Qt.callLater(synchronizeVisibility)
    }
    onPlaybackFullScreenChanged: Qt.callLater(synchronizeVisibility)
    Component.onCompleted: synchronizeVisibility()
    function synchronizeVisibility() {
        if (!playbackActive) hide()
        else if (playbackFullScreen) showFullScreen()
        else showNormal()
    }
    Connections {
        target: player
        function onStateChanged() {
            if (player.active && player.live && programmeItemID !== String(player.item.id)) {
                programmeItemID = String(player.item.id)
                repository.loadEpg(player.item)
            }
        }
    }
    onClosing: function(close) {
        close.accepted = owner && owner.shuttingDown
        player.close()
    }
    onVisibleChanged: if (visible) requestActivate()
    function clock(milliseconds) {
        const seconds = Math.max(0, Math.floor(milliseconds / 1000))
        return (seconds >= 3600 ? Math.floor(seconds / 3600) + ":" : "") + (seconds >= 3600 ? String(Math.floor(seconds / 60) % 60).padStart(2, "0") : Math.floor(seconds / 60)) + ":" + String(seconds % 60).padStart(2, "0")
    }
    function trackName(track, index) {
        return typeof track === "string" ? track : track.title || track.name || track.label || "Parça " + (index + 1)
    }
    function trackID(track, index) {
        return typeof track === "object" && track.id !== undefined ? track.id : index
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
        onActivated: { player.togglePause(); player.interact() }
    }
    Shortcut {
        sequence: "Left"
        enabled: player.active && videoWindow.ownsActiveWindow && !player.live && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: { player.seekBy(-10); player.interact() }
    }
    Shortcut {
        sequence: "Right"
        enabled: player.active && videoWindow.ownsActiveWindow && !player.live && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: { player.seekBy(10); player.interact() }
    }
    Shortcut {
        sequence: "F"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen
        context: Qt.ApplicationShortcut
        onActivated: { player.setFullScreen(!player.fullScreen); player.interact() }
    }
    Shortcut {
        sequence: "Up"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: { player.setVolume(Math.min(100, player.volume + 5)); player.interact() }
    }
    Shortcut {
        sequence: "Down"
        enabled: player.active && videoWindow.ownsActiveWindow && !controlsWindow.menuOpen && !controlsWindow.controlFocused
        context: Qt.ApplicationShortcut
        onActivated: { player.setVolume(Math.max(0, player.volume - 5)); player.interact() }
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
        onVisibleChanged: if (visible) requestActivate()
        onClosing: function(close) {
            close.accepted = videoWindow.owner && videoWindow.owner.shuttingDown
            player.close()
        }
        property bool menuOpen: audioMenu.visible || subtitleMenu.visible || episodeMenu.visible || settingsPanel.visible || guidePanel.visible
        property bool chromeVisible: player.controlsVisible || menuOpen || player.nextCountdown > 0
        property bool controlFocused: isControlFocus(activeFocusItem)
        function isControlFocus(item) {
            while (item && item !== contentItem) {
                if (item.handlesPlaybackKeys === true || item === timeline || item === volumeSlider) return true
                item = item.parent
            }
            return false
        }
        function dismissPanels() {
            audioMenu.close(); subtitleMenu.close(); episodeMenu.close(); settingsPanel.close(); guidePanel.close()
        }
        function panelTriggerPosition(button) {
            let x = 0, y = 0, item = button
            while (item && item !== contentItem) {
                x += item.x
                y += item.y
                item = item.parent
            }
            return Qt.point(x, y)
        }
        function openPanel(panel, button) {
            panel.x = Qt.binding(function() {
                const point = controlsWindow.panelTriggerPosition(button)
                return Math.max(12, Math.min(controlsWindow.width - panel.width - 12, point.x))
            })
            panel.y = Qt.binding(function() {
                const point = controlsWindow.panelTriggerPosition(button)
                return Math.max(12, Math.min(controlsWindow.height - panel.height - 12, point.y - panel.height - 10))
            })
            panel.open()
            player.interact()
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
                onClicked: { player.interact(); pointerClick.restart() }
                onDoubleClicked: { pointerClick.stop(); player.setFullScreen(!player.fullScreen) }
            }
            Timer { id: pointerClick; objectName: "videoSingleClickTimer"; interval: Qt.styleHints.mouseDoubleClickInterval; onTriggered: if (player.active) player.togglePause() }
            Rectangle {
                anchors.top: parent.top
                width: parent.width
                height: 84
                visible: controlsWindow.chromeVisible
                gradient: Gradient {
                    GradientStop { position: 0; color: "#A6000000" }
                    GradientStop { position: 1; color: "transparent" }
                }
            }
            PlayerToolButton {
                objectName: "playerCloseAction"
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.margins: 24
                visible: controlsWindow.chromeVisible
                iconName: "close"
                accessibleLabel: "Oynatıcıyı kapat"
                onHoveredChanged: if (hovered) player.interact()
                onClicked: player.close()
            }
            Rectangle {
                objectName: "playerLiveBadge"
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 24
                visible: player.live && controlsWindow.chromeVisible
                width: liveLabel.implicitWidth + 36
                height: 27
                radius: height / 2
                color: "#73000000"
                Row {
                    anchors.centerIn: parent
                    spacing: 7
                    Rectangle { width: 7; height: 7; radius: 3.5; color: "#FF3545"; anchors.verticalCenter: parent.verticalCenter }
                    Text { id: liveLabel; text: "CANLI"; color: "white"; font.family: "Segoe UI"; font.pixelSize: 11; font.weight: Font.Bold }
                }
            }
            Column {
                anchors.centerIn: parent
                spacing: 17
                visible: player.loading || !!player.error
                BusyIndicator {
                    anchors.horizontalCenter: parent.horizontalCenter
                    running: player.loading && !player.error
                    visible: running
                    palette.dark: "white"
                    Accessible.name: "Yayın açılıyor"
                }
                PlayerIcon { anchors.horizontalCenter: parent.horizontalCenter; width: 34; height: 34; name: "playBlocked"; ink: "#99FFFFFF"; visible: !!player.error }
                Text {
                    text: player.error
                    visible: !!player.error
                    color: "white"
                    font.family: "Segoe UI"
                    font.pixelSize: 16
                    wrapMode: Text.WordWrap
                    width: Math.min(410, controlsWindow.width - 80)
                    horizontalAlignment: Text.AlignHCenter
                }
                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 12
                    visible: !!player.error
                    ActionButton { text: "Geri dön"; onClicked: player.close() }
                    ActionButton { text: "Tekrar dene"; light: true; onClicked: repository.refreshPlayback(player.item) }
                }
            }
            Rectangle {
                visible: player.nextCountdown > 0
                anchors.right: parent.right
                anchors.rightMargin: 28
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 150
                width: 320
                height: continuationContent.implicitHeight + 44
                radius: 18
                color: "#ED29292B"
                border.color: "#29FFFFFF"
                ColumnLayout {
                    id: continuationContent
                    anchors.fill: parent
                    anchors.margins: 22
                    spacing: 12
                    Text { text: "Sonraki bölüm " + player.nextCountdown + " saniye içinde"; color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 13 }
                    Text {
                        text: player.nextItem.title || "Sonraki bölüm"
                        color: "white"
                        font.family: "Segoe UI"
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                    RowLayout {
                        spacing: 10
                        ActionButton { text: "Şimdi izle"; light: true; onClicked: player.playNext() }
                        ActionButton { text: "İptal"; onClicked: player.cancelNext() }
                    }
                }
            }
            Item {
                id: footer
                anchors.bottom: parent.bottom
                width: parent.width
                height: footerContents.implicitHeight + 59
                visible: controlsWindow.chromeVisible
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop { position: 0; color: "transparent" }
                        GradientStop { position: 1; color: "#E0000000" }
                    }
                }
                ColumnLayout {
                    id: footerContents
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: 28
                    anchors.rightMargin: 28
                    anchors.bottomMargin: 24
                    spacing: 17
                    RowLayout {
                        visible: !player.live
                        Layout.fillWidth: true
                        spacing: 13
                        Text { text: videoWindow.clock(timeline.pressed ? timeline.value : player.positionMs); color: "white"; font.family: "Segoe UI"; font.pixelSize: 12 }
                        PlayerSlider {
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
                                if (pressed) pendingSeek = value
                                else player.seek(Math.round(pendingSeek))
                                player.interact()
                            }
                        }
                        Text { text: videoWindow.clock(player.durationMs); color: "#99FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 12 }
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 20
                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.minimumWidth: 0
                            spacing: 5
                            Text {
                                objectName: "playerTitle"
                                text: player.title
                                color: "white"
                                font.family: "Segoe UI"
                                font.pixelSize: 23
                                font.weight: Font.DemiBold
                                wrapMode: Text.WordWrap
                                maximumLineCount: 2
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }
                            Text {
                                visible: player.live || player.item.kind === "episode"
                                text: player.live ? videoWindow.currentProgramme.title || "Canlı yayın" : player.item.season + ". Sezon · " + player.item.episode + ". Bölüm"
                                color: "#B3FFFFFF"
                                font.family: "Segoe UI"
                                font.pixelSize: 13
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }
                        }
                        Row {
                            id: tools
                            objectName: "playerTools"
                            spacing: 8
                            Layout.alignment: Qt.AlignVCenter
                            PlayerToolButton {
                                objectName: "playerPlaybackAction"
                                visible: player.live
                                iconName: player.playing ? "pause" : "play"
                                accessibleLabel: player.playing ? "Duraklat" : "Oynat"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: { player.togglePause(); player.interact() }
                            }
                            PlayerToolButton {
                                objectName: "playerPreviousChannelAction"
                                visible: player.live
                                iconName: "previousChannel"
                                accessibleLabel: "Önceki kanal"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: player.switchChannel(-1)
                            }
                            PlayerToolButton {
                                objectName: "playerNextChannelAction"
                                visible: player.live
                                iconName: "nextChannel"
                                accessibleLabel: "Sonraki kanal"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: player.switchChannel(1)
                            }
                            PlayerToolButton {
                                objectName: "playerFavoriteAction"
                                property bool favorite: { repository.libraryRevision; return !!player.item.id && repository.isFavorite(player.item) }
                                iconName: favorite ? "heartFilled" : "heart"
                                iconColor: favorite ? "#FF3545" : "white"
                                accessibleLabel: favorite ? "Favorilerden çıkar" : "Favorilere ekle"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: { repository.toggleFavorite(player.item); player.interact() }
                            }
                            PlayerToolButton {
                                objectName: "playerNextEpisodeAction"
                                visible: !!player.nextItem.id
                                iconName: "next"
                                accessibleLabel: "Sonraki bölüm"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: player.playNext()
                            }
                            Row {
                                spacing: 4
                                PlayerToolButton {
                                    objectName: "playerMuteAction"
                                    iconName: player.muted || player.volume === 0 ? "muted" : "volume"
                                    accessibleLabel: player.muted ? "Sesi aç" : "Sesi kapat"
                                    onHoveredChanged: if (hovered) player.interact()
                                    onClicked: { player.setMuted(!player.muted); player.interact() }
                                }
                                PlayerSlider {
                                    id: volumeSlider
                                    objectName: "playerVolume"
                                    width: 65
                                    anchors.verticalCenter: parent.verticalCenter
                                    from: 0
                                    to: 100
                                    stepSize: 1
                                    value: player.volume
                                    Accessible.name: "Ses seviyesi"
                                    onMoved: { player.setVolume(Math.round(value)); player.interact() }
                                }
                            }
                            PlayerToolButton {
                                id: audioButton
                                objectName: "playerAudioAction"
                                iconName: "audio"
                                accessibleLabel: "Ses parçaları"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: controlsWindow.openPanel(audioMenu, this)
                            }
                            PlayerToolButton {
                                id: subtitleButton
                                objectName: "playerSubtitleAction"
                                iconName: "subtitles"
                                accessibleLabel: "Altyazılar"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: controlsWindow.openPanel(subtitleMenu, this)
                            }
                            PlayerToolButton {
                                id: episodeButton
                                objectName: "playerEpisodesAction"
                                visible: player.item.kind === "episode"
                                iconName: "episodes"
                                accessibleLabel: "Sezonlar ve bölümler"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: {
                                    if (!videoWindow.episodeItems.length && player.item.seriesID)
                                        repository.showSeries({ id: player.item.seriesID, kind: "series", title: player.item.seriesTitle || player.title, scope: player.item.scope })
                                    controlsWindow.openPanel(episodeMenu, this)
                                }
                            }
                            PlayerToolButton {
                                id: guideButton
                                objectName: "playerGuideAction"
                                visible: player.live
                                iconName: "guide"
                                accessibleLabel: "Yayın akışı"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: controlsWindow.openPanel(guidePanel, this)
                            }
                            PlayerToolButton {
                                id: settingsButton
                                objectName: "playerSettingsAction"
                                iconName: "settings"
                                accessibleLabel: "Oynatıcı ayarları"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: controlsWindow.openPanel(settingsPanel, this)
                            }
                            PlayerToolButton {
                                objectName: "playerFullscreenAction"
                                iconName: player.fullScreen ? "exitFullscreen" : "fullscreen"
                                accessibleLabel: player.fullScreen ? "Tam ekrandan çık" : "Tam ekran"
                                onHoveredChanged: if (hovered) player.interact()
                                onClicked: { player.setFullScreen(!player.fullScreen); player.interact() }
                            }
                        }
                    }
                }
            }
            PlayerMenu {
                id: audioMenu
                parent: controlsWindow.contentItem
                objectName: "playerAudioMenu"
                title: "Ses"
                PlayerMenuItem { visible: !player.audioTracks.length; height: visible ? implicitHeight : 0; enabled: false; text: "Kullanılabilir parça bulunamadı." }
                Instantiator {
                    model: player.audioTracks
                    delegate: PlayerMenuItem {
                        required property var modelData
                        required property int index
                        text: videoWindow.trackName(modelData, index)
                        checkable: true
                        checked: player.audioTrack === videoWindow.trackID(modelData, index)
                        onTriggered: { player.selectAudio(videoWindow.trackID(modelData, index)); player.interact() }
                    }
                    onObjectAdded: (index, object) => audioMenu.insertItem(index + 1, object)
                    onObjectRemoved: (index, object) => audioMenu.removeItem(object)
                }
            }
            PlayerMenu {
                id: subtitleMenu
                parent: controlsWindow.contentItem
                objectName: "playerSubtitleMenu"
                title: "Altyazı"
                PlayerMenuItem { text: "Kapalı"; checkable: true; checked: player.subtitleTrack === -1; onTriggered: player.selectSubtitle(-1) }
                Instantiator {
                    model: player.subtitleTracks.filter(function(track) { return track.id !== -1 })
                    delegate: PlayerMenuItem {
                        required property var modelData
                        required property int index
                        text: videoWindow.trackName(modelData, index)
                        checkable: true
                        checked: player.subtitleTrack === videoWindow.trackID(modelData, index)
                        onTriggered: { player.selectSubtitle(videoWindow.trackID(modelData, index)); player.interact() }
                    }
                    onObjectAdded: (index, object) => subtitleMenu.insertItem(index + 1, object)
                    onObjectRemoved: (index, object) => subtitleMenu.removeItem(object)
                }
            }
            PlayerMenu {
                id: episodeMenu
                parent: controlsWindow.contentItem
                objectName: "playerEpisodeMenu"
                title: "Bölümler"
                width: 370
                implicitHeight: 370
                PlayerMenuItem { visible: !videoWindow.episodeItems.length; height: visible ? implicitHeight : 0; enabled: false; text: repository.busy ? "Bölümler yükleniyor…" : repository.error || "Kullanılabilir bölüm bulunamadı." }
                Instantiator {
                    model: videoWindow.episodeItems
                    delegate: PlayerMenuItem {
                        required property var modelData
                        required property int index
                        leadingText: modelData.season + "·" + modelData.episode
                        text: modelData.title
                        checkable: true
                        checked: String(player.item.id) === String(modelData.id)
                        selectionIcon: "audio"
                        selectionColor: "#FF3545"
                        onTriggered: { player.cancelNext(); repository.playItem(modelData) }
                    }
                    onObjectAdded: (index, object) => episodeMenu.insertItem(index + 1, object)
                    onObjectRemoved: (index, object) => episodeMenu.removeItem(object)
                }
            }
            Popup {
                id: settingsPanel
                parent: controlsWindow.contentItem
                objectName: "playerSettingsMenu"
                popupType: Popup.Item
                width: 350
                padding: 22
                focus: true
                closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
                background: Rectangle { radius: 12; color: "#F2222224"; border.color: "#29FFFFFF" }
                contentItem: ColumnLayout {
                    spacing: 20
                    Text { text: "Oynatıcı"; color: "white"; font.family: "Segoe UI"; font.pixelSize: 18; font.weight: Font.Bold }
                    ColumnLayout {
                        visible: !player.live
                        spacing: 9
                        Text { text: "Oynatma hızı"; color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 13 }
                        RowLayout {
                            spacing: 5
                            Repeater {
                                model: [0.5, 0.75, 1, 1.25, 1.5, 2]
                                PlayerChoice {
                                    required property real modelData
                                    objectName: "playerRate-" + modelData
                                    text: modelData + "×"
                                    selected: player.rate === modelData
                                    onClicked: { player.setRate(modelData); player.interact() }
                                }
                            }
                        }
                    }
                    ColumnLayout {
                        spacing: 9
                        Text { text: "Görüntü oranı"; color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 13 }
                        RowLayout {
                            spacing: 8
                            Repeater {
                                model: ["Otomatik", "16:9", "4:3"]
                                PlayerChoice {
                                    required property string modelData
                                    objectName: "playerAspect-" + modelData
                                    text: modelData
                                    selected: player.aspect === modelData
                                    onClicked: { player.setAspect(modelData); player.interact() }
                                }
                            }
                        }
                    }
                    RowLayout {
                        visible: player.live
                        spacing: 12
                        Text { text: "Ses"; color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 13 }
                        PlayerSlider { Layout.fillWidth: true; from: 0; to: 100; value: player.volume; Accessible.name: "Ses seviyesi"; onMoved: player.setVolume(Math.round(value)) }
                    }
                    Text { text: "Boşluk: duraklat / oynat\n← →: 10 saniye sar · Esc: geri"; color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 12 }
                }
            }
            Popup {
                id: guidePanel
                parent: controlsWindow.contentItem
                objectName: "playerGuideMenu"
                popupType: Popup.Item
                width: 370
                height: repository.programmes.length ? 370 : 150
                padding: 20
                focus: true
                closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
                background: Rectangle { radius: 12; color: "#F2222224"; border.color: "#29FFFFFF" }
                contentItem: ColumnLayout {
                    spacing: 14
                    Text { text: "Yayın akışı"; color: "white"; font.family: "Segoe UI"; font.pixelSize: 18; font.weight: Font.Bold }
                    Text { visible: !repository.programmes.length; text: "Bu kanal için yayın bilgisi bulunamadı."; color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true; Layout.fillHeight: true }
                    ListView {
                        visible: repository.programmes.length > 0
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        clip: true
                        spacing: 18
                        model: repository.programmes
                        ScrollIndicator.vertical: ScrollIndicator {}
                        delegate: RowLayout {
                            required property var modelData
                            width: ListView.view.width
                            spacing: 14
                            Text { text: new Date(modelData.startsAt).toLocaleTimeString(Qt.locale("tr_TR"), "HH:mm"); color: "#B3FFFFFF"; font.family: "Segoe UI"; font.pixelSize: 12; Layout.alignment: Qt.AlignTop }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 5
                                Text { text: modelData.title; color: "white"; font.family: "Segoe UI"; font.pixelSize: 13; font.weight: Font.Medium; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                                Text { text: "Şimdi yayında"; visible: modelData.startsAt <= Date.now() && modelData.endsAt > Date.now(); color: "#FF3545"; font.family: "Segoe UI"; font.pixelSize: 12 }
                            }
                        }
                    }
                }
            }
        }
    }
}
