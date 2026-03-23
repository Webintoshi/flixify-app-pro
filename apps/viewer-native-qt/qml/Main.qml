import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import Flixify.Native 1.0

ApplicationWindow {
    id: window
    width: 1540
    height: 960
    minimumWidth: 1240
    minimumHeight: 820
    visible: true
    title: "Flixify Pro"
    color: "#05070b"

    readonly property color panel: "#cc0d121c"
    readonly property color panelSoft: "#131923"
    readonly property color panelStrong: "#f0080b11"
    readonly property color textPrimary: "#f7f8fb"
    readonly property color textMuted: "#b1bac9"
    readonly property color accent: "#e50914"
    readonly property color accentStrong: "#ff2432"
    readonly property color borderSoft: "#1affffff"
    readonly property color success: "#30d19d"
    readonly property color danger: "#ff7d86"
    readonly property color info: "#7cb6ff"

    property string currentScreen: "login"
    property string authCode: ""
    property bool showAuthCode: false
    property string authDeviceName: "Flixify Native Qt"
    property string registerDeviceName: "Flixify Native Qt"
    property string issuedCode: ""
    property int revealedCount: 0
    property int scrambleSeed: 0
    property int revealWarmupTicks: 0
    property bool registerAcknowledged: false
    property bool playerVisible: false
    property bool premiumPopupDismissed: false
    property string dismissedUpdateVersion: ""
    property string selectedSeriesId: ""
    property string selectedLiveId: ""
    property string selectedMovieGroup: ""
    property string selectedSeriesGroup: ""
    property string selectedLiveGroup: ""
    property string moviesSearchText: ""
    property string seriesSearchText: ""
    property string liveSearchText: ""
    property string playerSubtitle: ""
    property string playerImageUrl: ""
    property var pendingPackage: null
    property string selectedPaymentMethodId: ""
    property string toastMessage: ""
    property color toastColor: info

    function normalizeText(value) {
        return (value || "").toString().toLocaleLowerCase()
    }

    function sanitizeCode(value) {
        return (value || "").toString().replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16)
    }

    function formatCode(value) {
        const normalized = sanitizeCode(value)
        return normalized.length ? normalized.match(/.{1,4}/g).join(" ") : "---- ---- ---- ----"
    }

    function animatedIssuedCode() {
        if (!issuedCode.length) {
            return formatCode("")
        }
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        let buffer = ""
        for (let index = 0; index < issuedCode.length; index += 1) {
            buffer += index < revealedCount ? issuedCode[index] : alphabet[(scrambleSeed + index * 7) % alphabet.length]
        }
        return formatCode(buffer)
    }

    function progressSegments() {
        return Math.min(Math.ceil(sanitizeCode(authCode).length / 4), 4)
    }

    function registerRevealProgress() {
        return issuedCode.length ? Math.min(1, revealedCount / issuedCode.length) : 0
    }

    function registerRevealComplete() {
        return issuedCode.length > 0 && revealedCount >= issuedCode.length
    }

    function registerRevealBusy() {
        return issuedCode.length > 0 && !registerRevealComplete()
    }

    function safeText(value) {
        return (value || "").toString().trim()
    }

    function isIpOrLocalhostHost(hostname) {
        const normalized = safeText(hostname).toLowerCase()
        if (!normalized.length) {
            return false
        }
        if (normalized === "localhost" || normalized.endsWith(".localhost")) {
            return true
        }
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
            return true
        }
        if (normalized.indexOf(":") !== -1) {
            return /^[0-9a-f:.]+$/i.test(normalized)
        }
        return false
    }

    function normalizeArtworkUrl(value) {
        const trimmed = safeText(value)
        if (!trimmed.length) {
            return ""
        }

        if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
            return trimmed
        }

        try {
            const parsed = new URL(trimmed)
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return ""
            }
            if (parsed.protocol === "http:" && !isIpOrLocalhostHost(parsed.hostname)) {
                parsed.protocol = "https:"
                return parsed.toString()
            }
            return parsed.toString()
        } catch (error) {
            return trimmed
        }
    }

    function artworkSource(value) {
        return normalizeArtworkUrl(value)
    }

    function artworkMonogram(value) {
        const parts = safeText(value).split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < parts.length; index += 1) {
            output += (parts[index][0] || "").toUpperCase()
        }
        return output.length ? output : "FX"
    }

    function artworkLabel(kind) {
        if (kind === "live") return "Canli Yayin"
        if (kind === "episode") return "Dizi"
        return "Film"
    }

    function showToast(message, color) {
        if (!message || !message.toString().trim().length) {
            return
        }
        toastMessage = message.toString().trim()
        toastColor = color || info
        toastTimer.restart()
    }

    function userData() {
        return apiClient.me && apiClient.me.user ? apiClient.me.user : ({})
    }

    function contactData() {
        return apiClient.me && apiClient.me.contact ? apiClient.me.contact : ({})
    }

    function hasLoadedUser() {
        const user = userData()
        return Boolean(user && user.id)
    }

    function subscriptionLabel() {
        const user = userData()
        if (user.hasActiveSubscription && user.activePackage) {
            return `${user.activePackage.title} - ${user.activePackage.remainingDays} gun`
        }
        return "Paket aktif degil"
    }

    function uniqueGroups(items) {
        const seen = {}
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            const title = (items[index].groupTitle || "").toString().trim()
            if (!title.length || seen[title]) {
                continue
            }
            seen[title] = true
            output.push(title)
        }
        return output
    }

    function filterItems(items, search, group) {
        const searchText = normalizeText(search)
        const groupText = normalizeText(group)
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index]
            const haystack = normalizeText(`${item.title || ""} ${item.groupTitle || ""}`)
            if (searchText.length && haystack.indexOf(searchText) === -1) {
                continue
            }
            if (groupText.length && normalizeText(item.groupTitle) !== groupText) {
                continue
            }
            output.push(item)
        }
        return output
    }

    function filteredMovies() { return filterItems(apiClient.movies || [], moviesSearchText, selectedMovieGroup) }
    function filteredSeries() { return filterItems(apiClient.series || [], seriesSearchText, selectedSeriesGroup) }
    function filteredLiveItems() { return filterItems(apiClient.liveChannels || [], liveSearchText, selectedLiveGroup) }

    function syncSelectedLiveSelection() {
        const items = filteredLiveItems()
        if (!items.length) {
            selectedLiveId = ""
            return
        }

        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedLiveId) {
                return
            }
        }

        selectedLiveId = items[0].id
    }

    function selectedSeries() {
        const items = apiClient.series || []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedSeriesId) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
    }

    function selectedLiveItem() {
        const items = filteredLiveItems()
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedLiveId) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
    }

    function featuredSeriesEpisodes() {
        const series = apiClient.series || []
        const output = []
        for (let index = 0; index < series.length; index += 1) {
            const item = series[index]
            const episode = item.featuredEpisode && item.featuredEpisode.id
                          ? item.featuredEpisode
                          : item.seasons && item.seasons.length && item.seasons[0].episodes && item.seasons[0].episodes.length
                            ? item.seasons[0].episodes[0]
                            : null
            if (!episode) {
                continue
            }
            output.push({
                id: episode.id,
                kind: "episode",
                title: item.title,
                subtitle: `${item.seasonCount} sezon - ${item.episodeCount} bolum`,
                posterUrl: item.posterUrl,
                playbackAllowed: episode.playbackAllowed,
                seriesId: item.id
            })
        }
        return output
    }

    function homeHeroItem() {
        if ((apiClient.movies || []).length) {
            const movie = apiClient.movies[0]
            return { id: movie.id, kind: "movie", title: movie.title, subtitle: movie.groupTitle || "Film secimi", posterUrl: movie.posterUrl }
        }
        const episodes = featuredSeriesEpisodes()
        if (episodes.length) {
            return episodes[0]
        }
        if ((apiClient.liveChannels || []).length) {
            const live = apiClient.liveChannels[0]
            return { id: live.id, kind: "live", title: live.title, subtitle: live.groupTitle || "Canli TV", logoUrl: live.logoUrl }
        }
        return null
    }

    function paymentMethods() {
        const items = apiClient.paymentMethods || []
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].enabled) {
                output.push(items[index])
            }
        }
        return output
    }

    function selectedPaymentMethod() {
        const items = paymentMethods()
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedPaymentMethodId) {
                return items[index]
            }
        }
        return null
    }

    function currentPlaybackItem() {
        if (playbackController.activeContentKind === "movie") return apiClient.movieById(playbackController.activeContentId)
        if (playbackController.activeContentKind === "episode") return apiClient.episodeById(playbackController.activeContentId)
        if (playbackController.activeContentKind === "live") return apiClient.liveChannelById(playbackController.activeContentId)
        return ({})
    }

    function activeAudioTrackIndex() {
        const tracks = playbackController.audioTracks || []
        for (let index = 0; index < tracks.length; index += 1) {
            if (tracks[index].id === playbackController.selectedAudioTrackId) {
                return index
            }
        }
        return tracks.length ? 0 : -1
    }

    function shouldShowBlocked() {
        const user = userData()
        return apiClient.authenticated && Boolean(user.id) && user.status === "blocked"
    }

    function shouldShowPremiumPopup() {
        const user = userData()
        return apiClient.authenticated &&
            Boolean(user.id) &&
            !user.hasActiveSubscription &&
            !premiumPopupDismissed &&
            !pendingPackage &&
            !playerVisible
    }
    function inlineLivePlayerVisible() {
        return currentScreen === "live" &&
            playerVisible &&
            playbackController.activeContentKind === "live" &&
            playbackController.activeChannelId === selectedLiveId &&
            selectedLiveItem() !== null &&
            selectedLiveItem().playbackAllowed !== false
    }
    function overlayPlayerVisible() {
        return playerVisible && !inlineLivePlayerVisible()
    }
    function toggleWindowFullscreen() {
        if (window.visibility === Window.FullScreen) {
            window.showNormal()
            return
        }
        window.showFullScreen()
    }
    function appUpdatePayload() { return apiClient.appUpdate || ({}) }
    function appUpdateVisible() { return Boolean(appUpdatePayload().updateAvailable && appUpdatePayload().latestVersion && appUpdatePayload().latestVersion !== dismissedUpdateVersion) }
    function appUpdateBannerVisible() { return appUpdateVisible() || apiClient.updateInProgress || apiClient.updateError.length > 0 }
    function updateProgressPercent() { return Math.max(0, Math.min(100, Math.round((apiClient.updateProgress || 0) * 100))) }

    function openScreen(screenName) {
        if (currentScreen === "live" && screenName !== "live" && playbackController.activeContentKind === "live" && playerVisible) {
            closePlayer()
        }
        currentScreen = screenName
        if (screenName === "live") {
            syncSelectedLiveSelection()
            liveAutoplayTimer.restart()
        } else if (screenName === "packages") {
            apiClient.fetchPackages()
            apiClient.fetchPaymentMethods()
        } else if (screenName === "payments") {
            apiClient.fetchPaymentRequests()
        } else if (screenName === "contact") {
            apiClient.fetchMe()
        }
    }

    function openSeriesDetail(seriesId) {
        selectedSeriesId = seriesId
        currentScreen = "series-detail"
    }

    function playMovie(movie) {
        if (!movie || !movie.id) return
        playerSubtitle = movie.groupTitle || "Film"
        playerImageUrl = movie.posterUrl || ""
        playerVisible = true
        playbackController.playVod("movie", movie.id, movie.title)
    }

    function playEpisode(episode, series) {
        if (!episode || !episode.id) return
        playerSubtitle = series && series.title ? series.title : "Dizi"
        playerImageUrl = series && series.posterUrl ? series.posterUrl : ""
        playerVisible = true
        playbackController.playVod("episode", episode.id, episode.title)
    }

    function playLive(channel, forceRestart) {
        if (!channel || !channel.id) return
        selectedLiveId = channel.id
        playerSubtitle = channel.groupTitle || "Canli TV"
        playerImageUrl = channel.logoUrl || ""
        if (channel.playbackAllowed === false) {
            if (playbackController.activeContentKind === "live") {
                playbackController.stop()
            }
            playerVisible = false
            return
        }
        playerVisible = true
        const sameChannel = playbackController.activeContentKind === "live" && playbackController.activeChannelId === channel.id
        if (sameChannel && !forceRestart) {
            return
        }
        playbackController.playChannel(channel.id)
    }

    function ensureLiveAutoplay(forceRestart) {
        if (currentScreen !== "live") {
            return
        }
        const channel = selectedLiveItem()
        if (!channel || !channel.id) {
            return
        }
        playLive(channel, forceRestart)
    }

    function closePlayer() {
        playerVisible = false
        playbackController.stop()
    }

    Timer {
        id: revealTimer
        interval: 112
        repeat: true
        onTriggered: {
            if (!issuedCode.length) {
                stop()
                return
            }
            scrambleSeed += 3
            if (revealWarmupTicks > 0) {
                revealWarmupTicks -= 1
                interval = Math.max(84, interval - 4)
                return
            }
            if (revealedCount >= issuedCode.length) {
                stop()
                return
            }
            interval = revealedCount < 4 ? 126 : revealedCount < 10 ? 142 : 158
            revealedCount += 1
        }
    }

    Timer {
        id: toastTimer
        interval: 3200
        repeat: false
        onTriggered: toastMessage = ""
    }

    Timer {
        id: liveAutoplayTimer
        interval: 120
        repeat: false
        onTriggered: ensureLiveAutoplay(false)
    }

    Timer {
        id: updatePollTimer
        interval: 900000
        repeat: true
        running: apiClient.authenticated
        onTriggered: {
            if (!apiClient.updateInProgress) {
                apiClient.checkAppUpdate()
            }
        }
    }

    Connections {
        target: apiClient
        function onAuthenticatedChanged() {
            if (apiClient.authenticated) {
                if (currentScreen === "login" || currentScreen === "register") {
                    currentScreen = "home"
                }
                return
            }
            if (!apiClient.restoringSession && currentScreen !== "register") {
                currentScreen = "login"
            }
        }
        function onLoginSucceeded() { currentScreen = "home"; premiumPopupDismissed = false; showAuthCode = false; authCode = "" }
        function onAnonCodeIssued(code) { issuedCode = sanitizeCode(code); revealedCount = 0; scrambleSeed = 0; revealWarmupTicks = 6; registerAcknowledged = false; authCode = ""; showAuthCode = false; currentScreen = "register"; revealTimer.interval = 88; revealTimer.restart() }
        function onSeriesChanged() { if (!selectedSeriesId && (apiClient.series || []).length) selectedSeriesId = apiClient.series[0].id }
        function onLiveChannelsChanged() { syncSelectedLiveSelection(); if (currentScreen === "live") liveAutoplayTimer.restart() }
        function onLogoutCompleted() { currentScreen = "login"; authCode = ""; issuedCode = ""; showAuthCode = false; closePlayer(); pendingPackage = null; selectedPaymentMethodId = "" }
        function onNoticeChanged() { if (apiClient.notice && apiClient.notice.length) showToast(apiClient.notice, success) }
        function onRequestFailed(context, message) { showToast(message, danger) }
    }

    Component.onCompleted: {
        currentScreen = apiClient.authenticated ? "home" : "login"
        apiClient.bootstrap()
    }

    component AppButton: Button {
        id: control
        property bool secondary: false
        hoverEnabled: control.enabled
        focusPolicy: Qt.NoFocus
        implicitHeight: 52
        leftPadding: 22
        rightPadding: 22
        topPadding: 0
        bottomPadding: 0
        font.pixelSize: 15
        font.bold: true
        opacity: control.enabled ? 1.0 : 0.42
        scale: control.down ? 0.988 : control.hovered ? 1.012 : 1.0
        Behavior on scale { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
        background: Rectangle {
            readonly property bool hoverState: control.hovered && control.enabled
            readonly property bool pressedState: control.down && control.enabled
            radius: height / 2
            border.width: 1
            border.color: control.secondary
                ? (pressedState ? "#34ffffff" : hoverState ? "#28ffffff" : window.borderSoft)
                : (pressedState ? "#38ffd9de" : hoverState ? "#24ffffff" : "#00000000")
            gradient: Gradient {
                GradientStop {
                    position: 0.0
                    color: control.secondary
                        ? (pressedState ? "#1affffff" : hoverState ? "#20ffffff" : "#12ffffff")
                        : (pressedState ? "#cfb20f18" : hoverState ? "#ff3c49" : window.accentStrong)
                }
                GradientStop {
                    position: 1.0
                    color: control.secondary
                        ? (pressedState ? "#0dffffff" : hoverState ? "#14ffffff" : "#12ffffff")
                        : (pressedState ? "#cc970812" : hoverState ? "#f20f1d" : window.accent)
                }
            }
            Rectangle {
                anchors.fill: parent
                radius: parent.radius
                color: hoverState && !control.secondary ? "#12ffffff" : "transparent"
                opacity: pressedState ? 0.35 : hoverState ? 0.8 : 0.0
            }
            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.46
                radius: parent.radius
                color: "#18ffffff"
                opacity: control.secondary ? (hoverState ? 0.5 : 0.32) : (hoverState ? 0.24 : 0.14)
            }
        }
        contentItem: Text {
            text: control.text
            color: control.secondary ? "#f4f6fb" : "#ffffff"
            font: control.font
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component AppField: TextField {
        implicitHeight: 54
        color: window.textPrimary
        selectedTextColor: window.textPrimary
        selectionColor: "#55e50914"
        placeholderTextColor: "#8f98a8"
        font.pixelSize: 15
        leftPadding: 16
        rightPadding: 16
        background: Rectangle {
            radius: 16
            color: "#0dffffff"
            border.width: 1
            border.color: parent.activeFocus ? "#40ffffff" : window.borderSoft
        }
    }

    component ChipButton: Button {
        id: chip
        property bool active: false
        hoverEnabled: chip.enabled
        focusPolicy: Qt.NoFocus
        implicitHeight: 42
        leftPadding: 18
        rightPadding: 18
        topPadding: 0
        bottomPadding: 0
        scale: chip.down ? 0.988 : chip.hovered ? 1.01 : 1.0
        Behavior on scale { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
        background: Rectangle {
            readonly property bool hoverState: chip.hovered && chip.enabled
            radius: 21
            color: chip.active ? (chip.down ? "#8f0e16" : hoverState ? "#d41520" : "#b20d16") : (chip.down ? "#14ffffff" : hoverState ? "#12ffffff" : "#0affffff")
            border.width: 1
            border.color: chip.active ? (hoverState ? "#42ffffff" : "#28ffffff") : (hoverState ? "#26ffffff" : window.borderSoft)
            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.48
                radius: parent.radius
                color: chip.active ? "#16ffffff" : "#10ffffff"
                opacity: hoverState ? 0.72 : 0.4
            }
        }
        contentItem: Text {
            text: chip.text
            color: chip.active ? "#ffffff" : window.textPrimary
            font.pixelSize: 13
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component NavButton: Button {
        id: nav
        property bool active: false
        hoverEnabled: nav.enabled
        focusPolicy: Qt.NoFocus
        padding: 0
        background: Item {}
        contentItem: Column {
            spacing: 8
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: nav.text
                color: nav.active ? window.textPrimary : (nav.hovered ? "#d9e1ef" : "#9fffffff")
                font.pixelSize: 18
                font.bold: true
                Behavior on color { ColorAnimation { duration: 140 } }
            }
            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: nav.active ? 56 : (nav.hovered ? 38 : 22)
                height: 4
                radius: 2
                color: nav.active ? window.accent : (nav.hovered ? "#88ff4451" : "#00000000")
                opacity: nav.active ? 1.0 : (nav.hovered ? 1.0 : 0.0)
                Behavior on width { NumberAnimation { duration: 150; easing.type: Easing.OutCubic } }
                Behavior on opacity { NumberAnimation { duration: 120 } }
                Behavior on color { ColorAnimation { duration: 120 } }
            }
        }
    }

    component GlassCard: Rectangle {
        radius: 28
        color: window.panel
        border.width: 1
        border.color: window.borderSoft
    }

    component ArtworkPanel: Item {
        id: artwork
        required property string title
        property string subtitle: ""
        property string sourceUrl: ""
        property string kind: "movie"
        property string mode: "poster"
        property real cornerRadius: 28
        property bool compact: false
        readonly property string normalizedSource: window.artworkSource(sourceUrl)
        readonly property bool fallbackVisible: normalizedSource.length === 0 || artworkImage.status === Image.Null || artworkImage.status === Image.Loading || artworkImage.status === Image.Error

        Rectangle {
            anchors.fill: parent
            radius: artwork.cornerRadius
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#1de50914" }
                GradientStop { position: 0.44; color: "#11224dff" }
                GradientStop { position: 1.0; color: "#f0080b11" }
            }
        }

        Image {
            id: artworkImage
            anchors.fill: parent
            anchors.margins: artwork.mode === "logo" ? (artwork.compact ? 10 : 22) : 1
            source: artwork.normalizedSource
            fillMode: artwork.mode === "logo" ? Image.PreserveAspectFit : Image.PreserveAspectCrop
            asynchronous: true
            cache: true
            visible: artwork.normalizedSource.length > 0 && status === Image.Ready
            clip: true
        }

        Rectangle {
            anchors.fill: parent
            radius: artwork.cornerRadius
            gradient: Gradient {
                GradientStop { position: 0.0; color: artwork.compact ? "#1205070b" : "#1805070b" }
                GradientStop { position: 0.58; color: artwork.compact ? "#3205070b" : "#6405070b" }
                GradientStop { position: 1.0; color: "#f005070b" }
            }
        }

        Item {
            anchors.fill: parent
            visible: artwork.fallbackVisible && artwork.compact

            Rectangle {
                width: Math.min(parent.width - 8, parent.height - 8)
                height: width
                radius: Math.max(16, width / 3)
                anchors.centerIn: parent
                color: "#1affffff"
                border.width: 1
                border.color: "#2affffff"

                Text {
                    anchors.centerIn: parent
                    text: window.artworkMonogram(artwork.title)
                    color: window.textPrimary
                    font.pixelSize: Math.max(16, parent.width * 0.34)
                    font.family: "Space Grotesk"
                    font.bold: true
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: artwork.fallbackVisible && !artwork.compact

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 20
                spacing: 10

                Rectangle {
                    width: 72
                    height: 72
                    radius: 22
                    color: "#16ffffff"
                    border.width: 1
                    border.color: "#26ffffff"

                    Text {
                        anchors.centerIn: parent
                        text: window.artworkMonogram(artwork.title)
                        color: window.textPrimary
                        font.pixelSize: 28
                        font.family: "Space Grotesk"
                        font.bold: true
                    }
                }

                Text {
                    text: artwork.title
                    width: parent.width
                    wrapMode: Text.WordWrap
                    maximumLineCount: artwork.mode === "logo" ? 3 : 2
                    elide: Text.ElideRight
                    color: window.textPrimary
                    font.pixelSize: artwork.mode === "logo" ? 24 : 28
                    font.family: "Space Grotesk"
                    font.bold: true
                }

                Text {
                    text: artwork.subtitle.length ? artwork.subtitle : window.artworkLabel(artwork.kind)
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: "#d4dbe8"
                    font.pixelSize: 13
                    visible: text.length > 0
                }
            }
        }
    }

    component RailCard: Item {
        id: rail
        required property var item
        required property string cardKind
        signal activated(var item)
        width: 286
        height: 420

        Rectangle {
            anchors.fill: parent
            radius: 28
            color: "#0a0e16"
            border.width: 1
            border.color: "#14ffffff"
        }

        ArtworkPanel {
            anchors.fill: parent
            title: rail.item.title || ""
            subtitle: rail.item.subtitle || rail.item.groupTitle || ""
            sourceUrl: rail.item.posterUrl || rail.item.logoUrl || ""
            mode: rail.cardKind === "live" ? "logo" : "poster"
            kind: rail.cardKind
            cornerRadius: 28
        }

        Rectangle {
            anchors.fill: parent
            radius: 28
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#1105070b" }
                GradientStop { position: 0.62; color: "#6605070b" }
                GradientStop { position: 1.0; color: "#f005070b" }
            }
        }

        Column {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 10

            Rectangle {
                width: 64
                height: 32
                radius: 16
                color: "#14ffffff"
                visible: rail.cardKind !== "live"
                Text {
                    anchors.centerIn: parent
                    text: rail.cardKind === "movie" ? "Film" : "Dizi"
                    color: window.textPrimary
                    font.pixelSize: 12
                    font.bold: true
                }
            }

            Item { width: 1; height: 1 }

            Text {
                text: rail.item.title || ""
                width: parent.width
                wrapMode: Text.WordWrap
                color: window.textPrimary
                font.pixelSize: 28
                font.family: "Space Grotesk"
                font.bold: true
            }

            Text {
                text: rail.item.subtitle || rail.item.groupTitle || ""
                width: parent.width
                wrapMode: Text.WordWrap
                color: window.textMuted
                font.pixelSize: 14
                visible: text.length > 0
            }

            Rectangle {
                width: 132
                height: 34
                radius: 17
                color: rail.item.playbackAllowed ? "#2b30d19d" : "#14ffffff"
                Text {
                    anchors.centerIn: parent
                    text: rail.item.playbackAllowed ? "Hazir" : "Paket Gerekli"
                    color: rail.item.playbackAllowed ? "#82ecc4" : window.textPrimary
                    font.pixelSize: 12
                    font.bold: true
                }
            }
        }

        MouseArea {
            anchors.fill: parent
            onClicked: rail.activated(rail.item)
        }
    }

    component PosterGridCard: Item {
        id: posterCard
        required property var item
        required property string cardKind
        signal activated(var item)
        width: 222
        height: 382

        Rectangle {
            id: posterVisual
            anchors.fill: parent
            radius: 24
            color: "#0a0e16"
            border.width: 1
            border.color: "#14ffffff"
        }

        ArtworkPanel {
            anchors.fill: parent
            title: posterCard.item.title || ""
            subtitle: posterCard.item.subtitle || posterCard.item.groupTitle || ""
            sourceUrl: posterCard.item.posterUrl || posterCard.item.logoUrl || ""
            mode: posterCard.cardKind === "live" ? "logo" : "poster"
            kind: posterCard.cardKind
            cornerRadius: 24
        }

        Rectangle {
            anchors.fill: parent
            radius: 24
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#05070b12" }
                GradientStop { position: 0.54; color: "#1805070b" }
                GradientStop { position: 1.0; color: "#f005070b" }
            }
        }

        Column {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 16
            spacing: 10

            Row {
                spacing: 8
                Rectangle {
                    width: 62
                    height: 30
                    radius: 15
                    color: "#16ffffff"
                    Text {
                        anchors.centerIn: parent
                        text: posterCard.cardKind === "movie" ? "Film" : "Dizi"
                        color: window.textPrimary
                        font.pixelSize: 11
                        font.bold: true
                    }
                }
                Rectangle {
                    width: playbackBadge.implicitWidth + 22
                    height: 30
                    radius: 15
                    color: posterCard.item.playbackAllowed ? "#2b30d19d" : "#16ffffff"
                    Text {
                        id: playbackBadge
                        anchors.centerIn: parent
                        text: posterCard.item.playbackAllowed ? "Hazir" : "Paket Gerekli"
                        color: posterCard.item.playbackAllowed ? "#82ecc4" : window.textPrimary
                        font.pixelSize: 11
                        font.bold: true
                    }
                }
            }

            Text {
                text: posterCard.item.title || ""
                width: parent.width
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                elide: Text.ElideRight
                color: window.textPrimary
                font.pixelSize: 24
                font.family: "Space Grotesk"
                font.bold: true
            }

            Text {
                text: posterCard.item.subtitle || posterCard.item.groupTitle || ""
                width: parent.width
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                elide: Text.ElideRight
                color: window.textMuted
                font.pixelSize: 13
                visible: text.length > 0
            }
        }

        MouseArea {
            anchors.fill: parent
            onClicked: posterCard.activated(posterCard.item)
        }
    }

    Component {
        id: nativeVideoSurfaceComponent
        NativeVideoSurface {
            anchors.fill: parent
            anchors.margins: 0
            onSurfaceHandleChanged: playbackController.setVideoSurfaceHandle(surfaceHandle)
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#020307"

        Rectangle {
            width: parent.width * 0.42
            height: width
            x: -width * 0.25
            y: -height * 0.28
            radius: width / 2
            color: "#22e50914"
        }

        Rectangle {
            width: parent.width * 0.24
            height: width
            x: parent.width * 0.76
            y: parent.height * 0.06
            radius: width / 2
            color: "#226e4dff"
        }

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#090d16" }
                GradientStop { position: 0.38; color: "#04050b" }
                GradientStop { position: 1.0; color: "#020307" }
            }
            opacity: 0.95
        }
    }

    Item {
        anchors.fill: parent

        Item {
            anchors.fill: parent
            visible: !apiClient.authenticated && !apiClient.restoringSession

            ColumnLayout {
                anchors.centerIn: parent
                width: currentScreen === "register" ? 560 : 460
                spacing: 18

                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: authContent.implicitHeight + 44

                    Column {
                        id: authContent
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 28
                        spacing: 18

                        Row {
                            anchors.horizontalCenter: parent.horizontalCenter
                            spacing: 12
                            Image { width: 42; height: 42; source: "qrc:/branding/icon.png"; fillMode: Image.PreserveAspectFit }
                            Text { text: "FLIXIFY"; color: window.textPrimary; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                            Rectangle {
                                width: 58; height: 28; radius: 10; color: window.accent
                                anchors.verticalCenter: parent.verticalCenter
                                Text { anchors.centerIn: parent; text: "PRO"; color: "#ffffff"; font.pixelSize: 12; font.bold: true }
                            }
                        }

                        Text {
                            text: currentScreen === "register"
                                  ? (issuedCode.length ? "Hesabiniz olusturuldu" : "Yeni bir hesap numarasi olusturun")
                                  : "16 haneli erisim kodunuzu girin"
                            color: "#d7dce6"
                            font.pixelSize: 18
                            width: parent.width
                            horizontalAlignment: Text.AlignHCenter
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "login"

                            Text {
                                text: "Erisim Kodu"
                                color: window.textPrimary
                                font.pixelSize: 16
                                font.bold: true
                            }

                            Item {
                                width: parent.width
                                height: 76

                                AppField {
                                    id: authCodeField
                                    anchors.fill: parent
                                    placeholderText: "X7F2 A9B1 C4D8 E6F0"
                                    text: formatCode(authCode)
                                    echoMode: showAuthCode ? TextInput.Normal : TextInput.Password
                                    font.pixelSize: showAuthCode ? 22 : 20
                                    font.family: showAuthCode ? "Space Grotesk" : "Consolas"
                                    font.bold: showAuthCode
                                    font.letterSpacing: showAuthCode ? 2.8 : 2.2
                                    leftPadding: 24
                                    rightPadding: 102
                                    color: showAuthCode ? "#ffffff" : window.textPrimary
                                    selectByMouse: true
                                    background: Rectangle {
                                        radius: 18
                                        gradient: Gradient {
                                            GradientStop { position: 0.0; color: "#1a1a22" }
                                            GradientStop { position: 1.0; color: "#171921" }
                                        }
                                        border.width: 2
                                        border.color: authCodeField.activeFocus ? window.accent : (showAuthCode ? "#3bffffff" : "#26ffffff")
                                    }
                                    onTextChanged: {
                                        const normalized = sanitizeCode(text)
                                        if (normalized !== authCode) authCode = normalized
                                    }
                                }

                                Rectangle {
                                    width: 78
                                    height: 54
                                    radius: 16
                                    anchors.right: parent.right
                                    anchors.rightMargin: 11
                                    anchors.verticalCenter: parent.verticalCenter
                                    gradient: Gradient {
                                        GradientStop { position: 0.0; color: showAuthCode ? "#272b35" : "#222733" }
                                        GradientStop { position: 1.0; color: showAuthCode ? "#1e212a" : "#1a1d25" }
                                    }
                                    border.width: 1
                                    border.color: showAuthCode ? "#40ffffff" : "#26ffffff"

                                    Text {
                                        anchors.centerIn: parent
                                        text: showAuthCode ? "Gizle" : "Goster"
                                        color: "#d7dce6"
                                        font.pixelSize: 13
                                        font.bold: true
                                    }

                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: showAuthCode = !showAuthCode
                                    }
                                }
                            }

                            Row {
                                width: parent.width
                                spacing: 8
                                Repeater {
                                    model: 4
                                    Rectangle {
                                        width: (parent.width - 24) / 4
                                        height: 8
                                        radius: 4
                                        color: index < progressSegments() ? window.accent : "#14ffffff"
                                    }
                                }
                            }

                            Text { text: `${sanitizeCode(authCode).length}/16`; color: window.textMuted; width: parent.width; horizontalAlignment: Text.AlignRight }
                            Text {
                                width: parent.width
                                visible: apiClient.lastError.length > 0
                                text: apiClient.lastError
                                color: window.danger
                                wrapMode: Text.WordWrap
                                font.pixelSize: 13
                            }
                            AppButton { width: parent.width; text: apiClient.busy ? "Giris Yapiliyor..." : "Giris Yap"; enabled: !apiClient.busy && sanitizeCode(authCode).length === 16; onClicked: apiClient.loginByCode(sanitizeCode(authCode), authDeviceName) }
                            Row {
                                anchors.horizontalCenter: parent.horizontalCenter
                                spacing: 6
                                Text { text: "Hesabiniz yok mu?"; color: window.textMuted; font.pixelSize: 15 }
                                Text {
                                    text: "Hesap Olustur"
                                    color: window.accentStrong
                                    font.pixelSize: 15
                                    font.bold: true
                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            issuedCode = ""
                                            revealedCount = 0
                                            scrambleSeed = 0
                                            revealWarmupTicks = 0
                                            registerAcknowledged = false
                                            authCode = ""
                                            showAuthCode = false
                                            currentScreen = "register"
                                        }
                                    }
                                }
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "register" && !issuedCode.length

                            Rectangle {
                                width: parent.width
                                height: 206
                                radius: 24
                                color: "#0b0f17"
                                border.width: 1
                                border.color: "#1dffffff"
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: "#0f1521" }
                                    GradientStop { position: 0.54; color: "#0b0f17" }
                                    GradientStop { position: 1.0; color: "#08101a" }
                                }

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 22
                                    spacing: 14

                                    Rectangle {
                                        width: createLabel.implicitWidth + 26
                                        height: 34
                                        radius: 17
                                        color: "#19e50914"
                                        border.width: 1
                                        border.color: "#22ffffff"

                                        Text {
                                            id: createLabel
                                            anchors.centerIn: parent
                                            text: "Tek Kullanimlik Guvenli Kod"
                                            color: "#ffd7da"
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                    }

                                    Text {
                                        text: "Premium iceriklere erisim icin size ozel 16 haneli bir hesap numarasi uretin."
                                        width: parent.width
                                        wrapMode: Text.WordWrap
                                        color: window.textPrimary
                                        font.pixelSize: 26
                                        font.family: "Space Grotesk"
                                        font.bold: true
                                    }

                                    Text {
                                        text: "Kod bir kez uretilir. Kaydedip sakladiginizda ayni hesapla uygulamaya tekrar giris yapabilirsiniz."
                                        width: parent.width
                                        wrapMode: Text.WordWrap
                                        color: window.textMuted
                                        font.pixelSize: 14
                                    }

                                    Row {
                                        spacing: 10
                                        Repeater {
                                            model: [
                                                { title: "16 Hane", copy: "Kriptolu" },
                                                { title: "Tek Kod", copy: "Kopyala/Kaydet" },
                                                { title: "Aninda Aktif", copy: "Native Giris" }
                                            ]

                                            Rectangle {
                                                width: Math.floor((parent.width - 20) / 3)
                                                height: 56
                                                radius: 16
                                                color: "#0effffff"
                                                border.width: 1
                                                border.color: "#14ffffff"

                                                Column {
                                                    anchors.centerIn: parent
                                                    spacing: 4
                                                    Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 13; font.bold: true; horizontalAlignment: Text.AlignHCenter }
                                                    Text { text: modelData.copy; color: window.textMuted; font.pixelSize: 11; horizontalAlignment: Text.AlignHCenter }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            AppButton {
                                width: parent.width
                                implicitHeight: 58
                                text: apiClient.busy ? "Sifreli Anahtar Uretiliyor..." : "Hesap Numarasi Olustur"
                                enabled: !apiClient.busy
                                onClicked: apiClient.issueAnonCode(registerDeviceName)
                            }

                            AppButton {
                                width: parent.width
                                text: "Zaten Hesabim Var"
                                secondary: true
                                onClicked: {
                                    authCode = ""
                                    showAuthCode = false
                                    currentScreen = "login"
                                }
                            }

                            Row {
                                width: parent.width
                                spacing: 12
                                Repeater {
                                    model: [
                                        { title: "Guvenli Erisim", copy: "Kodu kaydet, oturumu native uygulamadan tekrar ac." },
                                        { title: "Premium Deneyim", copy: "Film, dizi ve canli icerikler branded shell icinde acilir." }
                                    ]
                                    Rectangle {
                                        width: (parent.width - 12) / 2; height: 110; radius: 18; color: "#0d131d"; border.width: 1; border.color: window.borderSoft
                                        Column {
                                            anchors.fill: parent; anchors.margins: 16; spacing: 8
                                            Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 16; font.family: "Space Grotesk"; font.bold: true }
                                            Text { text: modelData.copy; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 }
                                        }
                                    }
                                }
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "register" && issuedCode.length > 0

                            Rectangle {
                                width: parent.width
                                height: 228
                                radius: 24
                                color: "#0b0f17"
                                border.width: 1
                                border.color: registerRevealComplete() ? "#36e50914" : "#22ffffff"
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: registerRevealComplete() ? "#101521" : "#0e121c" }
                                    GradientStop { position: 1.0; color: "#090d15" }
                                }

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 20
                                    spacing: 14

                                    Row {
                                        width: parent.width
                                        spacing: 10

                                        Text { text: "Erisim Kodunuz"; color: window.textMuted; font.pixelSize: 13; font.bold: true }
                                        Item { width: 1; height: 1 }
                                        Rectangle {
                                            width: revealStatusText.implicitWidth + 28
                                            height: 32
                                            radius: 16
                                            color: registerRevealComplete() ? "#2330d19d" : "#1ae50914"
                                            border.width: 1
                                            border.color: registerRevealComplete() ? "#3a30d19d" : "#24ffffff"

                                            Text {
                                                id: revealStatusText
                                                anchors.centerIn: parent
                                                text: registerRevealComplete() ? "Hazir" : "Sifreli Anahtar Uretiliyor"
                                                color: registerRevealComplete() ? "#82ecc4" : "#ffd7da"
                                                font.pixelSize: 11
                                                font.bold: true
                                            }
                                        }
                                    }

                                    Text {
                                        text: animatedIssuedCode()
                                        color: window.textPrimary
                                        width: parent.width
                                        horizontalAlignment: Text.AlignHCenter
                                        font.pixelSize: 40
                                        font.family: "Space Grotesk"
                                        font.bold: true
                                        font.letterSpacing: 1.2
                                    }

                                    Text {
                                        text: registerRevealComplete() ? "Kod hazir. Simdi kopyalayin veya kaydedin." : "Kriptografik karakter matrisi olusturuluyor..."
                                        width: parent.width
                                        horizontalAlignment: Text.AlignHCenter
                                        color: window.textMuted
                                        font.pixelSize: 13
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 10
                                        radius: 5
                                        color: "#13ffffff"

                                        Rectangle {
                                            width: parent.width * registerRevealProgress()
                                            height: parent.height
                                            radius: 5
                                            gradient: Gradient {
                                                GradientStop { position: 0.0; color: window.accentStrong }
                                                GradientStop { position: 1.0; color: window.accent }
                                            }
                                        }
                                    }

                                    Text {
                                        text: `${revealedCount}/16`
                                        width: parent.width
                                        horizontalAlignment: Text.AlignRight
                                        color: "#b8c4d8"
                                        font.pixelSize: 12
                                        font.bold: true
                                    }
                                }
                            }

                            Rectangle {
                                width: parent.width
                                height: 86
                                radius: 20
                                color: "#0d131d"
                                border.width: 1
                                border.color: "#1dffffff"

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 18
                                    spacing: 14

                                    Rectangle {
                                        width: 42
                                        height: 42
                                        radius: 14
                                        color: "#19e50914"
                                        border.width: 1
                                        border.color: "#20ffffff"
                                        anchors.verticalCenter: parent.verticalCenter

                                        Text {
                                            anchors.centerIn: parent
                                            text: "!"
                                            color: "#ffd7da"
                                            font.pixelSize: 20
                                            font.bold: true
                                        }
                                    }

                                    Column {
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: parent.width - 62
                                        spacing: 4
                                        Text { text: "Onemli"; color: window.textPrimary; font.pixelSize: 15; font.family: "Space Grotesk"; font.bold: true }
                                        Text { text: "Bu kodu kaybetmeyin. Kodunuzu saklamadan ilerlemeyin."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 }
                                    }
                                }
                            }

                            Row {
                                width: parent.width
                                spacing: 12
                                AppButton {
                                    width: (parent.width - 12) / 2
                                    text: "Kopyala"
                                    secondary: true
                                    enabled: registerRevealComplete()
                                    onClicked: {
                                        const copied = apiClient.copyText(issuedCode)
                                        showToast(copied ? "Kod kopyalandi." : "Kod kopyalanamadi.", copied ? success : danger)
                                    }
                                }
                                AppButton {
                                    width: (parent.width - 12) / 2
                                    text: "Kaydet"
                                    secondary: true
                                    enabled: registerRevealComplete()
                                    onClicked: {
                                        const path = apiClient.saveTextFile("flixify-kod", `Flixify Pro Hesap Numarasi\nKod: ${formatCode(issuedCode)}\nTam kod: ${issuedCode}\n`)
                                        showToast(path.length ? "Kod dosyasi kaydedildi." : "Kod dosyasi kaydedilemedi.", path.length ? success : danger)
                                    }
                                }
                            }

                            Rectangle {
                                width: parent.width
                                height: 60
                                radius: 18
                                color: registerAcknowledged ? "#2230d19d" : "#0d131d"
                                border.width: 1
                                border.color: registerAcknowledged ? "#5530d19d" : window.borderSoft

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 16
                                    spacing: 12

                                    Rectangle {
                                        width: 24
                                        height: 24
                                        radius: 12
                                        color: registerAcknowledged ? window.success : "#18ffffff"
                                        anchors.verticalCenter: parent.verticalCenter

                                        Text {
                                            anchors.centerIn: parent
                                            text: registerAcknowledged ? "OK" : ""
                                            color: "#04140d"
                                            font.bold: true
                                        }
                                    }

                                    Text { anchors.verticalCenter: parent.verticalCenter; text: "Hesap numarami kaydettigimi onayliyorum"; color: window.textPrimary; font.pixelSize: 14 }
                                }

                                MouseArea { anchors.fill: parent; enabled: registerRevealComplete(); onClicked: registerAcknowledged = !registerAcknowledged }
                            }

                            AppButton {
                                width: parent.width
                                text: "Giris Ekranina Gec"
                                enabled: registerRevealComplete() && registerAcknowledged
                                onClicked: {
                                    authCode = ""
                                    showAuthCode = false
                                    currentScreen = "login"
                                }
                            }

                            AppButton {
                                width: parent.width
                                text: "Zaten Hesabim Var"
                                secondary: true
                                onClicked: {
                                    authCode = ""
                                    showAuthCode = false
                                    currentScreen = "login"
                                }
                            }
                        }
                    }
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: apiClient.restoringSession

            ColumnLayout {
                anchors.centerIn: parent
                width: 520
                spacing: 18

                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 220
                    color: window.panelStrong

                    Column {
                        anchors.centerIn: parent
                        spacing: 18

                        Image {
                            width: 54
                            height: 54
                            source: "qrc:/branding/icon.png"
                            fillMode: Image.PreserveAspectFit
                        }

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "Oturum geri yukleniyor"
                            color: window.textPrimary
                            font.pixelSize: 32
                            font.family: "Space Grotesk"
                            font.bold: true
                        }

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "Kayitli cihaz oturumu dogrulaniyor."
                            color: window.textMuted
                            font.pixelSize: 15
                        }

                        BusyIndicator {
                            anchors.horizontalCenter: parent.horizontalCenter
                            running: apiClient.restoringSession
                            width: 44
                            height: 44
                        }
                    }
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: apiClient.authenticated && !shouldShowBlocked()

            ColumnLayout {
                anchors.fill: parent
                spacing: 0

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 104
                    color: "#ee010204"

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 28
                        anchors.rightMargin: 28
                        spacing: 24

                        Row {
                            spacing: 14
                            Image { width: 36; height: 36; source: "qrc:/branding/icon.png"; fillMode: Image.PreserveAspectFit }
                            Text { text: "FLIXIFY"; color: window.textPrimary; font.pixelSize: 30; font.family: "Space Grotesk"; font.bold: true }
                            Rectangle { width: 58; height: 28; radius: 10; color: window.accent; anchors.verticalCenter: parent.verticalCenter; Text { anchors.centerIn: parent; text: "PRO"; color: "#ffffff"; font.pixelSize: 12; font.bold: true } }
                        }

                        Item {
                            Layout.fillWidth: true
                            Row {
                                anchors.centerIn: parent
                                spacing: 32
                                Repeater {
                                    model: [
                                        { key: "home", label: "Ana Sayfa" },
                                        { key: "live", label: "Canli TV" },
                                        { key: "movies", label: "Filmler" },
                                        { key: "series", label: "Diziler" }
                                    ]
                                    NavButton {
                                        required property var modelData
                                        text: modelData.label
                                        active: currentScreen === modelData.key
                                        onClicked: openScreen(modelData.key)
                                    }
                                }
                            }
                        }

                        Rectangle {
                            width: 232; height: 62; radius: 31; color: "#0affffff"; border.width: 1; border.color: window.borderSoft
                            Row {
                                anchors.fill: parent; anchors.margins: 6; spacing: 12
                                Rectangle { width: 50; height: 50; radius: 25; color: "#10ffffff"; anchors.verticalCenter: parent.verticalCenter; Text { anchors.centerIn: parent; text: "-"; color: window.textPrimary; font.pixelSize: 28 } }
                                Text { anchors.verticalCenter: parent.verticalCenter; width: 150; elide: Text.ElideRight; text: userData().kryptoniteCode || "Profil"; color: window.textPrimary; font.pixelSize: 14; font.bold: true }
                            }
                            MouseArea { anchors.fill: parent; onClicked: openScreen("profile") }
                        }

                        AppButton { text: "Cikis"; secondary: true; implicitWidth: 110; onClicked: apiClient.logout() }
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 0

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: appUpdateBannerVisible() ? 118 : 0
                        color: "#167cb6ff"
                        border.width: appUpdateBannerVisible() ? 1 : 0
                        border.color: "#307cb6ff"
                        visible: appUpdateBannerVisible()
                        Row {
                            anchors.fill: parent; anchors.margins: 18; spacing: 16
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 280
                                spacing: 4
                                Text {
                                    text: apiClient.updateInProgress
                                          ? `Guncelleme indiriliyor... %${updateProgressPercent()}`
                                          : (apiClient.updateError.length
                                             ? "Guncelleme baslatilamadi"
                                             : `Yeni surum hazir: v${appUpdatePayload().latestVersion || ""}`)
                                    color: window.textPrimary
                                    font.pixelSize: 16
                                    font.family: "Space Grotesk"
                                    font.bold: true
                                }
                                Text {
                                    text: apiClient.updateInProgress
                                          ? "Installer indiriliyor. Hazir olunca uygulama kapanip yeni surum kurulumu baslayacak."
                                          : (apiClient.updateError.length
                                             ? apiClient.updateError
                                             : (appUpdatePayload().notes || "Guncelleme uygulama icinden indirilebilir durumda."))
                                    width: parent.width
                                    wrapMode: Text.WordWrap
                                    color: window.textMuted
                                    font.pixelSize: 14
                                }
                                Rectangle {
                                    width: parent.width
                                    height: 8
                                    radius: 4
                                    visible: apiClient.updateInProgress
                                    color: "#24ffffff"
                                    Rectangle {
                                        width: parent.width * (apiClient.updateProgress || 0)
                                        height: parent.height
                                        radius: 4
                                        color: window.success
                                    }
                                }
                            }
                            AppButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: apiClient.updateInProgress ? "Indiriliyor..." : "Guncelle ve Yeniden Baslat"
                                secondary: true
                                implicitWidth: 220
                                enabled: !apiClient.updateInProgress && Boolean(appUpdatePayload().downloadUrl)
                                visible: !apiClient.updateInProgress
                                onClicked: apiClient.installAppUpdate()
                            }
                            AppButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "Daha Sonra"
                                secondary: true
                                implicitWidth: 120
                                enabled: !apiClient.updateInProgress
                                visible: appUpdateVisible()
                                onClicked: dismissedUpdateVersion = appUpdatePayload().latestVersion || ""
                            }
                        }
                    }

                    StackLayout {
                        id: pageStack
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        currentIndex: ({ "home": 0, "live": 1, "movies": 2, "series": 3, "series-detail": 4, "profile": 5, "packages": 6, "payments": 7, "settings": 8, "contact": 9 })[currentScreen] ?? 0

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 22
                                GlassCard {
                                    width: parent.width
                                    height: 580
                                    visible: homeHeroItem() !== null
                                    Item {
                                        anchors.fill: parent
                                        ArtworkPanel { anchors.fill: parent; title: homeHeroItem() ? homeHeroItem().title : "Flixify"; subtitle: homeHeroItem() ? (homeHeroItem().subtitle || "") : ""; sourceUrl: homeHeroItem() ? (homeHeroItem().posterUrl || homeHeroItem().logoUrl || "") : ""; kind: homeHeroItem() ? homeHeroItem().kind : "movie"; mode: homeHeroItem() && homeHeroItem().kind === "live" ? "logo" : "poster"; cornerRadius: 28 }
                                        Rectangle { anchors.fill: parent; radius: 28; gradient: Gradient { GradientStop { position: 0.0; color: "#3305070b" } GradientStop { position: 0.48; color: "#8a05070b" } GradientStop { position: 1.0; color: "#f005070b" } } }
                                        Row {
                                            anchors.fill: parent; anchors.margins: 34; spacing: 24
                                            Column {
                                                width: parent.width * 0.62; anchors.verticalCenter: parent.verticalCenter; spacing: 14
                                                Rectangle { width: 180; height: 34; radius: 17; color: "#14ffffff"; Text { anchors.centerIn: parent; text: homeHeroItem() && homeHeroItem().kind === "movie" ? "Flixify Film Selection" : homeHeroItem() && homeHeroItem().kind === "live" ? "Canli Yayin Spotlight" : "Binge-Worthy Series"; color: "#d8ffffff"; font.pixelSize: 12; font.bold: true } }
                                                Text { width: parent.width; wrapMode: Text.WordWrap; text: homeHeroItem() ? homeHeroItem().title : ""; color: window.textPrimary; font.pixelSize: 64; font.family: "Space Grotesk"; font.bold: true }
                                                Row { spacing: 10; Rectangle { width: subscriptionPill.implicitWidth + 28; height: 34; radius: 17; color: "#33e50914"; Text { id: subscriptionPill; anchors.centerIn: parent; text: subscriptionLabel(); color: "#ffd7da"; font.pixelSize: 12; font.bold: true } } }
                                                Text { width: parent.width * 0.82; wrapMode: Text.WordWrap; text: homeHeroItem() && homeHeroItem().kind === "movie" ? "Poster odakli premium film secimi ve native player deneyimi." : homeHeroItem() && homeHeroItem().kind === "live" ? "Canli spor, haber ve premium yayinlar branded shell icinde yonetilir." : "Yeni sezonlar ve otomatik sonraki bolum akisi ile premium dizi deneyimi."; color: "#d7dce6"; font.pixelSize: 16 }
                                                Row {
                                                    spacing: 12
                                                    AppButton { text: homeHeroItem() && homeHeroItem().kind === "live" ? "Canliyi Ac" : homeHeroItem() && homeHeroItem().kind === "movie" ? "Filmi Oynat" : "Diziyi Baslat"; implicitWidth: 180; onClicked: { if (homeHeroItem().kind === "movie") playMovie(apiClient.movieById(homeHeroItem().id)); else if (homeHeroItem().kind === "episode") playEpisode(apiClient.episodeById(homeHeroItem().id), apiClient.seriesById(homeHeroItem().seriesId)); else playLive(apiClient.liveChannelById(homeHeroItem().id)) } }
                                                    AppButton { text: "Filmleri Kesfet"; secondary: true; implicitWidth: 180; onClicked: openScreen("movies") }
                                                }
                                            }
                                            Column {
                                                width: parent.width * 0.28; anchors.verticalCenter: parent.verticalCenter; spacing: 14
                                                GlassCard {
                                                    width: parent.width; height: 188; color: "#d8080b10"
                                                    Column {
                                                        anchors.fill: parent; anchors.margins: 20; spacing: 10
                                                        Text { text: "Canli Spor Odagi"; color: "#d8ffffff"; font.pixelSize: 12; font.bold: true }
                                                        Text { text: (apiClient.liveChannels || []).length ? apiClient.liveChannels[0].title : "Canli TV Vitrini"; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 28; font.family: "Space Grotesk"; font.bold: true }
                                                        Text { text: "Canli rail uzerinden premium spor ve haber yayinlarina hizli gecis."; color: window.textMuted; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 14 }
                                                        AppButton { width: parent.width; text: (apiClient.liveChannels || []).length ? "Canli Kanali Ac" : "Canli TV'ye Git"; secondary: true; onClicked: { if ((apiClient.liveChannels || []).length) playLive(apiClient.liveChannels[0]); else openScreen("live") } }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                Repeater {
                                    model: [
                                        { title: "Filmler", kind: "movie", items: (apiClient.movies || []).slice(0, 10) },
                                        { title: "Diziler", kind: "episode", items: featuredSeriesEpisodes().slice(0, 10) },
                                        { title: "Canli TV", kind: "live", items: (apiClient.liveChannels || []).slice(0, 10) }
                                    ]
                                    Column {
                                        required property var modelData
                                        width: parent.width
                                        spacing: 14
                                        visible: modelData.items.length > 0
                                        Row { width: parent.width; Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true } Item { width: 1; height: 1 } AppButton { text: "Tumunu Ac"; secondary: true; implicitWidth: 128; onClicked: openScreen(modelData.title === "Filmler" ? "movies" : modelData.title === "Diziler" ? "series" : "live") } }
                                        ListView {
                                            width: parent.width; height: 430; orientation: ListView.Horizontal; spacing: 18; clip: true; model: modelData.items
                                            delegate: RailCard {
                                                item: modelData
                                                cardKind: parent.parent.parent.modelData.kind
                                                onActivated: {
                                                    if (cardKind === "movie") playMovie(apiClient.movieById(item.id))
                                                    else if (cardKind === "episode") playEpisode(apiClient.episodeById(item.id), apiClient.seriesById(item.seriesId))
                                                    else playLive(apiClient.liveChannelById(item.id))
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Item {
                            ColumnLayout {
                                anchors.fill: parent
                                anchors.margins: 24
                                spacing: 18
                                Text {
                                    text: "Canli TV"
                                    color: window.textPrimary
                                    font.pixelSize: 42
                                    font.family: "Space Grotesk"
                                    font.bold: true
                                }

                                Flickable {
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: 52
                                    contentWidth: liveChipRow.width
                                    clip: true

                                    Row {
                                        id: liveChipRow
                                        spacing: 10

                                        Repeater {
                                            model: [""] .concat(uniqueGroups(apiClient.liveChannels || []))
                                            ChipButton {
                                                required property var modelData
                                                text: modelData.length ? modelData : "Tumu"
                                                active: selectedLiveGroup === modelData
                                                width: Math.max(96, implicitContentWidth + 28)
                                                onClicked: {
                                                    selectedLiveGroup = modelData
                                                    syncSelectedLiveSelection()
                                                    liveAutoplayTimer.restart()
                                                }
                                            }
                                        }
                                    }
                                }

                                RowLayout {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    spacing: 20
                                    GlassCard {
                                        Layout.fillWidth: true
                                        Layout.fillHeight: true
                                        color: "#090c13"

                                        ColumnLayout {
                                            anchors.fill: parent
                                            anchors.margins: 24
                                            spacing: 16

                                            RowLayout {
                                                Layout.fillWidth: true
                                                spacing: 18

                                                ColumnLayout {
                                                    Layout.fillWidth: true
                                                    spacing: 6

                                                    Text {
                                                        text: selectedLiveItem() ? selectedLiveItem().title : "Kanal secin"
                                                        color: window.textPrimary
                                                        font.pixelSize: 34
                                                        font.family: "Space Grotesk"
                                                        font.bold: true
                                                        elide: Text.ElideRight
                                                    }

                                                    Text {
                                                        text: selectedLiveItem() ? (selectedLiveItem().groupTitle || "Canli TV") : "Sag panelden kanal secin"
                                                        color: window.textMuted
                                                        font.pixelSize: 14
                                                    }
                                                }

                                                Rectangle {
                                                    Layout.alignment: Qt.AlignTop
                                                    width: liveStateLabel.implicitWidth + 24
                                                    height: 34
                                                    radius: 17
                                                    color: playbackController.state === "playing" ? "#2b30d19d" : playbackController.state === "error" ? "#24ff7d86" : "#16ffffff"
                                                    border.width: 1
                                                    border.color: playbackController.state === "playing" ? "#2282ecc4" : "#1effffff"

                                                    Text {
                                                        id: liveStateLabel
                                                        anchors.centerIn: parent
                                                        text: playbackController.state === "buffering" ? "Buffer" :
                                                              playbackController.state === "resolving" || playbackController.state === "opening" ? "Hazirlaniyor" :
                                                              playbackController.state === "error" ? "Hata" :
                                                              playbackController.state === "playing" ? "Canli" : "Beklemede"
                                                        color: "#ffffff"
                                                        font.pixelSize: 12
                                                        font.bold: true
                                                    }
                                                }
                                            }

                                            Rectangle {
                                                Layout.fillWidth: true
                                                Layout.fillHeight: true
                                                radius: 28
                                                color: "#000000"
                                                border.width: 1
                                                border.color: "#14ffffff"
                                                clip: true
                                                
                                                Loader {
                                                    anchors.fill: parent
                                                    active: inlineLivePlayerVisible()
                                                    sourceComponent: nativeVideoSurfaceComponent
                                                }

                                                Item {
                                                    anchors.fill: parent
                                                    visible: filteredLiveItems().length === 0

                                                    Column {
                                                        anchors.centerIn: parent
                                                        width: Math.min(parent.width * 0.6, 420)
                                                        spacing: 12

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Filtreye uyan kanal bulunamadi"
                                                            color: window.textPrimary
                                                            font.pixelSize: 28
                                                            font.family: "Space Grotesk"
                                                            font.bold: true
                                                            wrapMode: Text.WordWrap
                                                        }

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Aramayi temizleyin veya baska bir kategori secin."
                                                            color: window.textMuted
                                                            font.pixelSize: 14
                                                            wrapMode: Text.WordWrap
                                                        }
                                                    }
                                                }

                                                Item {
                                                    anchors.fill: parent
                                                    visible: filteredLiveItems().length > 0 && selectedLiveItem() !== null && selectedLiveItem().playbackAllowed === false

                                                    Column {
                                                        anchors.centerIn: parent
                                                        width: Math.min(parent.width * 0.62, 460)
                                                        spacing: 12

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Bu kanali acmak icin aktif paket gerekiyor"
                                                            color: window.textPrimary
                                                            font.pixelSize: 30
                                                            font.family: "Space Grotesk"
                                                            font.bold: true
                                                            wrapMode: Text.WordWrap
                                                        }

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Sag listeden baska kanal secin ya da paket durumunuzu guncelleyin."
                                                            color: window.textMuted
                                                            font.pixelSize: 14
                                                            wrapMode: Text.WordWrap
                                                        }
                                                    }
                                                }

                                                Rectangle {
                                                    anchors.top: parent.top
                                                    anchors.left: parent.left
                                                    anchors.margins: 18
                                                    width: inlineStateText.implicitWidth + 28
                                                    height: 40
                                                    radius: 20
                                                    color: "#c7070a0f"
                                                    border.width: 1
                                                    border.color: "#12ffffff"
                                                    visible: selectedLiveItem() !== null && filteredLiveItems().length > 0 && selectedLiveItem().playbackAllowed !== false

                                                    Text {
                                                        id: inlineStateText
                                                        anchors.centerIn: parent
                                                        text: playbackController.state === "buffering" ? "Buffer dolduruluyor" :
                                                              playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazirlaniyor" :
                                                              playbackController.state === "error" ? "Yayin acilamadi" :
                                                              playbackController.state === "playing" ? "Yayin acik" : "Kanal bekliyor"
                                                        color: window.textPrimary
                                                        font.pixelSize: 13
                                                        font.bold: true
                                                    }
                                                }

                                                Rectangle {
                                                    anchors.left: parent.left
                                                    anchors.right: parent.right
                                                    anchors.bottom: parent.bottom
                                                    anchors.margins: 16
                                                    height: 74
                                                    radius: 22
                                                    color: "#c7070a0f"
                                                    border.width: 1
                                                    border.color: "#12ffffff"
                                                    visible: selectedLiveItem() !== null && filteredLiveItems().length > 0 && selectedLiveItem().playbackAllowed !== false

                                                    RowLayout {
                                                        anchors.fill: parent
                                                        anchors.margins: 14
                                                        spacing: 12

                                                        AppButton {
                                                            text: playbackController.muted || playbackController.volume <= 0 ? "Sesi Ac" : "Sesi Kapat"
                                                            secondary: true
                                                            implicitWidth: 118
                                                            onClicked: playbackController.toggleMuted()
                                                        }

                                                        Slider {
                                                            id: liveVolumeSlider
                                                            Layout.preferredWidth: 180
                                                            Layout.alignment: Qt.AlignVCenter
                                                            from: 0
                                                            to: 1
                                                            value: 1
                                                            stepSize: 0.01
                                                            Component.onCompleted: value = playbackController.muted ? 0 : playbackController.volume
                                                            onMoved: playbackController.setVolume(value)

                                                            background: Rectangle {
                                                                x: liveVolumeSlider.leftPadding
                                                                y: liveVolumeSlider.topPadding + liveVolumeSlider.availableHeight / 2 - height / 2
                                                                implicitWidth: 180
                                                                implicitHeight: 6
                                                                width: liveVolumeSlider.availableWidth
                                                                height: implicitHeight
                                                                radius: 3
                                                                color: "#20ffffff"

                                                                Rectangle {
                                                                    width: liveVolumeSlider.visualPosition * parent.width
                                                                    height: parent.height
                                                                    radius: 3
                                                                    color: window.accent
                                                                }
                                                            }

                                                            handle: Rectangle {
                                                                x: liveVolumeSlider.leftPadding + liveVolumeSlider.visualPosition * (liveVolumeSlider.availableWidth - width)
                                                                y: liveVolumeSlider.topPadding + liveVolumeSlider.availableHeight / 2 - height / 2
                                                                implicitWidth: 18
                                                                implicitHeight: 18
                                                                radius: 9
                                                                color: "#ffffff"
                                                                border.width: 1
                                                                border.color: "#40ffffff"
                                                            }
                                                        }

                                                        Text {
                                                            text: `${Math.round((playbackController.muted ? 0 : playbackController.volume) * 100)}%`
                                                            color: window.textPrimary
                                                            font.pixelSize: 13
                                                            font.bold: true
                                                            Layout.alignment: Qt.AlignVCenter
                                                        }

                                                        Item { Layout.fillWidth: true }

                                                        AppButton {
                                                            text: window.visibility === Window.FullScreen ? "Pencereden Cik" : "Tam Ekran"
                                                            secondary: true
                                                            implicitWidth: 148
                                                            onClicked: toggleWindowFullscreen()
                                                        }
                                                    }
                                                }

                                                Connections {
                                                    target: playbackController
                                                    function onVolumeChanged() { liveVolumeSlider.value = playbackController.muted ? 0 : playbackController.volume }
                                                    function onMutedChanged() { liveVolumeSlider.value = playbackController.muted ? 0 : playbackController.volume }
                                                }

                                                Rectangle {
                                                    anchors.horizontalCenter: parent.horizontalCenter
                                                    anchors.bottom: parent.bottom
                                                    anchors.bottomMargin: 102
                                                    width: Math.min(parent.width - 36, inlineErrorLabel.implicitWidth + 36)
                                                    height: inlineErrorLabel.implicitHeight + 22
                                                    radius: 20
                                                    color: "#cc20070b"
                                                    border.width: 1
                                                    border.color: "#28ff7d86"
                                                    visible: playbackController.lastError.length > 0 && playbackController.activeContentKind === "live"

                                                    Text {
                                                        id: inlineErrorLabel
                                                        anchors.centerIn: parent
                                                        width: parent.width - 26
                                                        wrapMode: Text.WordWrap
                                                        horizontalAlignment: Text.AlignHCenter
                                                        text: playbackController.lastError
                                                        color: "#ffd5da"
                                                        font.pixelSize: 13
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    GlassCard {
                                        Layout.preferredWidth: 420
                                        Layout.fillHeight: true
                                        color: "#0a0f18"

                                        ColumnLayout {
                                            anchors.fill: parent
                                            anchors.margins: 18
                                            spacing: 14

                                            AppField {
                                                Layout.fillWidth: true
                                                placeholderText: "Kanal ara..."
                                                text: liveSearchText
                                                onTextChanged: {
                                                    liveSearchText = text
                                                    syncSelectedLiveSelection()
                                                    liveAutoplayTimer.restart()
                                                }
                                            }

                                            RowLayout {
                                                Layout.fillWidth: true

                                                Text {
                                                    text: "Kanallar"
                                                    color: window.textPrimary
                                                    font.pixelSize: 22
                                                    font.family: "Space Grotesk"
                                                    font.bold: true
                                                }

                                                Item { Layout.fillWidth: true }

                                                Text {
                                                    text: filteredLiveItems().length ? `${filteredLiveItems().length} kanal` : "Bos"
                                                    color: window.textMuted
                                                    font.pixelSize: 13
                                                }
                                            }

                                            ListView {
                                                Layout.fillWidth: true
                                                Layout.fillHeight: true
                                                clip: true
                                                spacing: 12
                                                model: filteredLiveItems()

                                                delegate: Rectangle {
                                                    required property var modelData
                                                    width: ListView.view.width
                                                    height: 88
                                                    radius: 22
                                                    color: selectedLiveId === modelData.id ? "#e50914" : "#131923"
                                                    border.width: 1
                                                    border.color: selectedLiveId === modelData.id ? "#ff5d74" : "#2a3140"

                                                    Row {
                                                        anchors.fill: parent
                                                        anchors.margins: 14
                                                        spacing: 14

                                                        Text {
                                                            anchors.verticalCenter: parent.verticalCenter
                                                            text: index + 1
                                                            color: selectedLiveId === modelData.id ? "#ffffff" : "#9eabba"
                                                            font.pixelSize: 15
                                                            font.bold: true
                                                        }

                                                        Rectangle {
                                                            width: 54
                                                            height: 54
                                                            radius: 18
                                                            color: "#14ffffff"
                                                            anchors.verticalCenter: parent.verticalCenter

                                                            ArtworkPanel {
                                                                anchors.fill: parent
                                                                title: modelData.title || ""
                                                                subtitle: modelData.groupTitle || "Canli TV"
                                                                sourceUrl: modelData.logoUrl || ""
                                                                kind: "live"
                                                                mode: "logo"
                                                                compact: true
                                                                cornerRadius: 18
                                                            }
                                                        }

                                                        Column {
                                                            anchors.verticalCenter: parent.verticalCenter
                                                            width: parent.width - 120
                                                            spacing: 4

                                                            Text {
                                                                text: modelData.title
                                                                width: parent.width
                                                                elide: Text.ElideRight
                                                                color: "#ffffff"
                                                                font.pixelSize: 18
                                                                font.bold: true
                                                            }

                                                            Text {
                                                                text: modelData.groupTitle || "Canli TV"
                                                                width: parent.width
                                                                elide: Text.ElideRight
                                                                color: selectedLiveId === modelData.id ? "#ffe8eb" : window.textMuted
                                                                font.pixelSize: 13
                                                            }
                                                        }
                                                    }

                                                    MouseArea {
                                                        anchors.fill: parent
                                                        onClicked: playLive(modelData)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Text { text: "Filmler"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                AppField { width: parent.width; placeholderText: "Film ara..."; text: moviesSearchText; onTextChanged: moviesSearchText = text }
                                Flickable { width: parent.width; height: 52; contentWidth: movieChipRow.width; clip: true; Row { id: movieChipRow; spacing: 10; Repeater { model: [""] .concat(uniqueGroups(apiClient.movies || [])); ChipButton { required property var modelData; text: modelData.length ? modelData : "Tum Filmler"; active: selectedMovieGroup === modelData; width: Math.max(112, implicitContentWidth + 28); onClicked: selectedMovieGroup = modelData } } } }
                                Flow {
                                    width: parent.width
                                    spacing: 20
                                    Repeater {
                                        model: filteredMovies()
                                        PosterGridCard {
                                            item: modelData
                                            cardKind: "movie"
                                            onActivated: playMovie(item)
                                        }
                                    }
                                }
                                GlassCard {
                                    width: parent.width
                                    height: 180
                                    visible: filteredMovies().length === 0
                                    color: "#090c13"
                                    Column {
                                        anchors.centerIn: parent
                                        spacing: 8
                                        Text {
                                            text: "Filtreye uygun film bulunamadi"
                                            color: window.textPrimary
                                            font.pixelSize: 30
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }
                                        Text {
                                            text: "Aramayi temizleyip baska bir kategori deneyebilirsiniz."
                                            color: window.textMuted
                                            font.pixelSize: 14
                                        }
                                    }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Text { text: "Diziler"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                AppField { width: parent.width; placeholderText: "Dizi ara..."; text: seriesSearchText; onTextChanged: seriesSearchText = text }
                                Flickable { width: parent.width; height: 52; contentWidth: seriesChipRow.width; clip: true; Row { id: seriesChipRow; spacing: 10; Repeater { model: [""] .concat(uniqueGroups(apiClient.series || [])); ChipButton { required property var modelData; text: modelData.length ? modelData : "Tum Diziler"; active: selectedSeriesGroup === modelData; width: Math.max(112, implicitContentWidth + 28); onClicked: selectedSeriesGroup = modelData } } } }
                                Flow { width: parent.width; spacing: 20; Repeater { model: filteredSeries(); RailCard { width: 282; height: 430; item: ({ id: modelData.id, title: modelData.title, subtitle: `${modelData.seasonCount} sezon - ${modelData.episodeCount} bolum`, posterUrl: modelData.posterUrl, playbackAllowed: Boolean(modelData.featuredEpisode && modelData.featuredEpisode.playbackAllowed) }); cardKind: "episode"; onActivated: openSeriesDetail(modelData.id) } } }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                AppButton { text: "Dizilere Don"; secondary: true; implicitWidth: 140; onClicked: openScreen("series") }
                                Row {
                                    width: parent.width; spacing: 24
                                    GlassCard { width: 320; height: 460; color: "#090c13"; ArtworkPanel { anchors.fill: parent; title: selectedSeries() ? selectedSeries().title : "Dizi"; subtitle: selectedSeries() ? (selectedSeries().groupTitle || "Premium Dizi") : "Premium Dizi"; sourceUrl: selectedSeries() ? (selectedSeries().posterUrl || "") : ""; kind: "episode"; mode: "poster"; cornerRadius: 28 } }
                                    GlassCard {
                                        width: parent.width - 344; height: 460; color: "#090c13"
                                        Column {
                                            anchors.fill: parent; anchors.margins: 28; spacing: 14
                                            Text { text: selectedSeries() ? selectedSeries().title : "Dizi secin"; color: window.textPrimary; font.pixelSize: 46; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap }
                                            Text { text: selectedSeries() ? (selectedSeries().groupTitle || "Seckin dizi") : ""; color: window.textMuted; font.pixelSize: 16 }
                                            Text { width: parent.width * 0.8; wrapMode: Text.WordWrap; text: "Sezonlari gezin, bolumu secin ve native player yuzeyinde branded playback deneyimini kullanin."; color: window.textMuted; font.pixelSize: 15 }
                                            AppButton { text: "One Cikan Bolumu Ac"; implicitWidth: 190; enabled: selectedSeries() && selectedSeries().featuredEpisode && selectedSeries().featuredEpisode.id; onClicked: playEpisode(selectedSeries().featuredEpisode, selectedSeries()) }
                                        }
                                    }
                                }
                                Repeater {
                                    model: selectedSeries() && selectedSeries().seasons ? selectedSeries().seasons : []
                                    GlassCard {
                                        width: parent.width; height: seasonContent.implicitHeight + 34; color: "#090c13"
                                        Column {
                                            id: seasonContent
                                            anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 18; spacing: 14
                                            Text { text: `${modelData.title} - ${modelData.episodeCount} bolum`; color: window.textPrimary; font.pixelSize: 26; font.family: "Space Grotesk"; font.bold: true }
                                            Repeater {
                                                model: modelData.episodes || []
                                                Rectangle {
                                                    width: seasonContent.width; height: 80; radius: 20; color: "#131923"; border.width: 1; border.color: "#2a3140"
                                                    Row {
                                                        anchors.fill: parent; anchors.margins: 16; spacing: 18
                                                        Text { anchors.verticalCenter: parent.verticalCenter; text: `B${modelData.episodeNumber}`; color: "#a6ffffff"; font.pixelSize: 14; font.bold: true }
                                                        Column { anchors.verticalCenter: parent.verticalCenter; width: parent.width - 170; spacing: 4; Text { text: modelData.title; width: parent.width; elide: Text.ElideRight; color: window.textPrimary; font.pixelSize: 18; font.bold: true } Text { text: modelData.playbackAllowed ? "Hazir" : "Paket Gerekli"; color: modelData.playbackAllowed ? "#82ecc4" : window.textMuted; font.pixelSize: 13 } }
                                                        AppButton { anchors.verticalCenter: parent.verticalCenter; text: "Oynat"; implicitWidth: 110; enabled: modelData.playbackAllowed; onClicked: playEpisode(modelData, selectedSeries()) }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Text { text: "Profil"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: [
                                            { title: "Profil Ayarlari", copy: "Kullanici ve baglanti bilgilerini goruntuleyin.", action: "Ayarlar", screen: "settings" },
                                            { title: "Paketler", copy: "Aktif paketleri gorup satin alim talebi olusturun.", action: "Paketleri Gor", screen: "packages" },
                                            { title: "Odeme Bildirimi", copy: "Odeme taleplerinin durumunu takip edin.", action: "Bildirimleri Gor", screen: "payments" },
                                            { title: "Iletisim", copy: "Destek ekibine WhatsApp veya Telegram uzerinden ulasin.", action: "Iletisime Gec", screen: "contact" }
                                        ]
                                        GlassCard {
                                            width: (parent.width - 18) / 2; height: 210; color: "#090c13"
                                            Column { anchors.fill: parent; anchors.margins: 22; spacing: 12; Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 26; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap } Text { text: modelData.copy; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 14 } AppButton { text: modelData.action; secondary: modelData.screen !== "packages"; implicitWidth: 160; onClicked: openScreen(modelData.screen) } }
                                        }
                                    }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Paketler"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: apiClient.packages
                                        GlassCard {
                                            width: (parent.width - 36) / 3; height: 240; color: "#090c13"
                                            Column { anchors.fill: parent; anchors.margins: 22; spacing: 10; Rectangle { width: 82; height: 34; radius: 17; color: "#14ffffff"; Text { anchors.centerIn: parent; text: `${modelData.durationMonths} ay`; color: window.textPrimary; font.pixelSize: 12; font.bold: true } } Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 30; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap } Text { text: modelData.priceLabel || "Fiyat bilgisi destek ekibinden alinir."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 14 } AppButton { text: "Paket Al"; implicitWidth: 132; onClicked: { pendingPackage = modelData; selectedPaymentMethodId = ""; apiClient.fetchPaymentMethods() } } }
                                        }
                                    }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Odeme Bildirimi"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Repeater {
                                    model: apiClient.paymentRequests
                                    GlassCard { width: parent.width; height: 104; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 6; Text { text: modelData.packageTitle; color: window.textPrimary; font.pixelSize: 22; font.family: "Space Grotesk"; font.bold: true } Text { text: modelData.status; color: window.textMuted; font.pixelSize: 14 } Text { text: modelData.createdAt; color: "#8e98aa"; font.pixelSize: 13 } } }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Ayarlar"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: [
                                            { label: "Kullanici Kodu", value: userData().kryptoniteCode || "-" },
                                            { label: "Aktif Paket", value: userData().activePackage ? userData().activePackage.title : "Yok" },
                                            { label: "Link Durumu", value: userData().hasAssignedLink ? "Bagli" : "Admin atamasi bekleniyor" },
                                            { label: "Abonelik", value: subscriptionLabel() }
                                        ]
                                        GlassCard { width: (parent.width - 18) / 2; height: 126; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 8; Text { text: modelData.label; color: window.textMuted; font.pixelSize: 13 } Text { text: modelData.value; width: parent.width; wrapMode: Text.WordWrap; color: window.textPrimary; font.pixelSize: 22; font.family: "Space Grotesk"; font.bold: true } } }
                                    }
                                }
                                Row { spacing: 12; AppButton { text: "Paketler"; implicitWidth: 128; onClicked: openScreen("packages") } AppButton { text: "Odemeler"; secondary: true; implicitWidth: 128; onClicked: openScreen("payments") } AppButton { text: "Iletisim"; secondary: true; implicitWidth: 128; onClicked: openScreen("contact") } }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: pageStack.width - 48
                                x: 24
                                topPadding: 20
                                bottomPadding: 28
                                spacing: 20
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Iletisim"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                GlassCard {
                                    width: parent.width; height: 200; color: "#090c13"
                                    Column {
                                        anchors.fill: parent; anchors.margins: 24; spacing: 12
                                        Text { text: "Destek ekibine hizli ulasin"; color: window.textPrimary; font.pixelSize: 32; font.family: "Space Grotesk"; font.bold: true }
                                        Text { text: "Aktivasyon, paket ve odeme surecleri icin WhatsApp veya Telegram kullanin."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
                                        Row { spacing: 12; AppButton { text: "WhatsApp"; implicitWidth: 140; onClicked: Qt.openUrlExternally(contactData().whatsapp || "") } AppButton { text: "Telegram"; secondary: true; implicitWidth: 140; onClicked: Qt.openUrlExternally(contactData().telegram || "") } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: shouldShowBlocked()
            ColumnLayout {
                anchors.centerIn: parent
                width: 720
                spacing: 18
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 250
                    color: "#0a0d14"
                    Column { anchors.fill: parent; anchors.margins: 28; spacing: 14; Text { text: "Erisim Durdu"; color: window.textPrimary; font.pixelSize: 44; font.family: "Space Grotesk"; font.bold: true } Text { text: "Hesabiniz su anda engelli. Destek ekibi ile iletisime gecerek tekrar aktivasyon talep edebilirsiniz."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 16 } Row { spacing: 12; AppButton { text: "WhatsApp"; implicitWidth: 144; onClicked: Qt.openUrlExternally(contactData().whatsapp || "") } AppButton { text: "Telegram"; secondary: true; implicitWidth: 144; onClicked: Qt.openUrlExternally(contactData().telegram || "") } AppButton { text: "Cikis"; secondary: true; implicitWidth: 120; onClicked: apiClient.logout() } } }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#d9030508"; visible: overlayPlayerVisible(); z: 20
            GlassCard {
                anchors.fill: parent; anchors.margins: 18; color: "#f2080a0e"; z: 21
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 14
                    RowLayout { Layout.fillWidth: true; ColumnLayout { Layout.fillWidth: true; spacing: 4; Text { text: playbackController.activeContentKind === "live" ? "Canli TV" : playbackController.activeContentKind === "movie" ? "Film" : "Dizi"; color: "#c7ffffff"; font.pixelSize: 12; font.bold: true } Text { text: playbackController.activeTitle.length ? playbackController.activeTitle : "Player Hazir"; color: window.textPrimary; font.pixelSize: 28; font.family: "Space Grotesk"; font.bold: true } Text { text: playerSubtitle; color: window.textMuted; font.pixelSize: 14; visible: text.length > 0 } } AppButton { text: "Kapat"; secondary: true; implicitWidth: 120; onClicked: closePlayer() } }
                    RowLayout {
                        Layout.fillWidth: true; Layout.fillHeight: true; spacing: 16
                        GlassCard {
                            Layout.fillWidth: true; Layout.fillHeight: true; color: "#000000"
                            Loader { anchors.fill: parent; anchors.margins: 6; active: overlayPlayerVisible(); sourceComponent: nativeVideoSurfaceComponent }
                            Rectangle { anchors.left: parent.left; anchors.top: parent.top; anchors.margins: 18; width: stateLabel.implicitWidth + 28; height: 40; radius: 20; color: "#c7070a0f"; border.width: 1; border.color: "#12ffffff"; Text { id: stateLabel; anchors.centerIn: parent; text: playbackController.state === "buffering" ? "Buffer dolduruluyor" : playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazirlaniyor" : playbackController.state === "error" ? "Yayin acilamadi" : "Yayin hazir"; color: window.textPrimary; font.pixelSize: 13; font.bold: true } }
                            Rectangle {
                                anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 16; height: 78; radius: 22; color: "#c7070a0f"; border.width: 1; border.color: "#12ffffff"
                                Row {
                                    anchors.fill: parent; anchors.margins: 14; spacing: 10
                                    AppButton { text: playbackController.paused ? "Play" : "Pause"; secondary: true; implicitWidth: 104; onClicked: playbackController.togglePause() }
                                    AppButton { text: "Geri 15sn"; secondary: true; implicitWidth: 110; enabled: playbackController.activeContentKind === "movie" || playbackController.activeContentKind === "episode"; onClicked: playbackController.seekBy(-15) }
                                    AppButton { text: "Ileri 30sn"; secondary: true; implicitWidth: 116; enabled: playbackController.activeContentKind === "movie" || playbackController.activeContentKind === "episode"; onClicked: playbackController.seekBy(30) }
                                    AppButton { text: "Tekrar Dene"; secondary: true; implicitWidth: 126; onClicked: playbackController.retryCurrent() }
                                    AppButton { text: "Sonraki Bolum"; implicitWidth: 146; visible: Boolean(playbackController.recommendedNextEpisode.id); enabled: visible; onClicked: playbackController.playRecommendedNextEpisode() }
                                    Item { width: 1; height: 1 }
                                    Column { anchors.verticalCenter: parent.verticalCenter; spacing: 6; Text { text: `Pozisyon: ${playbackController.positionSeconds.toFixed(1)} / ${playbackController.durationSeconds.toFixed(1)}`; color: window.textPrimary; font.pixelSize: 13 } ComboBox { width: 260; model: playbackController.audioTracks; textRole: "title"; enabled: playbackController.audioTracks.length > 0; currentIndex: activeAudioTrackIndex(); onActivated: function(index) { const track = playbackController.audioTracks[index]; if (track && track.id) playbackController.selectAudioTrack(track.id) } } }
                                }
                            }
                        }
                        GlassCard { Layout.preferredWidth: 320; Layout.fillHeight: true; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 12; Text { text: "Yayin Bilgisi"; color: window.textPrimary; font.pixelSize: 20; font.family: "Space Grotesk"; font.bold: true } Rectangle { width: parent.width; height: 180; radius: 22; color: "#08ffffff"; border.width: 1; border.color: window.borderSoft; ArtworkPanel { anchors.fill: parent; title: playbackController.activeTitle.length ? playbackController.activeTitle : "Flixify"; subtitle: playerSubtitle; sourceUrl: playerImageUrl; kind: playbackController.activeContentKind || "movie"; mode: playbackController.activeContentKind === "live" ? "logo" : "poster"; cornerRadius: 22 } } Text { text: playbackController.lastError.length ? playbackController.lastError : "Native player branded shell icinde hazir."; width: parent.width; wrapMode: Text.WordWrap; color: playbackController.lastError.length ? "#ffb2b8" : window.textMuted; font.pixelSize: 14 } } }
                    }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#d9030508"; visible: pendingPackage !== null; z: 30
            GlassCard {
                width: 740; height: paymentContent.implicitHeight + 40; anchors.centerIn: parent; color: "#0b0f17"; z: 31
                Column {
                    id: paymentContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 20; spacing: 16
                    Row { width: parent.width; Text { text: "Odeme Yontemi"; color: "#d8ffffff"; font.pixelSize: 12; font.bold: true } Item { width: 1; height: 1 } AppButton { text: "Kapat"; secondary: true; implicitWidth: 96; onClicked: { pendingPackage = null; selectedPaymentMethodId = "" } } }
                    Text { text: pendingPackage ? `${pendingPackage.title} paketi icin odeme yontemi secin` : ""; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Flow {
                        width: parent.width; spacing: 12
                        Repeater {
                            model: paymentMethods()
                            GlassCard { width: (parent.width - 12) / 2; height: 94; color: selectedPaymentMethodId === modelData.id ? "#22e50914" : "#131923"; border.color: selectedPaymentMethodId === modelData.id ? "#30ffffff" : "#2a3140"; Column { anchors.fill: parent; anchors.margins: 16; spacing: 6; Text { text: modelData.label || modelData.id; color: window.textPrimary; font.pixelSize: 18; font.bold: true } Text { text: modelData.details || "Onay sureci destek ekibi tarafindan baslatilir."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 } } MouseArea { anchors.fill: parent; onClicked: selectedPaymentMethodId = modelData.id } }
                        }
                    }
                    AppButton { width: parent.width; text: "Odeme Bildir"; enabled: selectedPaymentMethod() !== null && !apiClient.busy; onClicked: { apiClient.requestPayment(pendingPackage.slug); if (contactData().whatsapp) Qt.openUrlExternally(contactData().whatsapp); pendingPackage = null; selectedPaymentMethodId = ""; openScreen("payments") } }
                    AppButton { width: parent.width; text: "Vazgec"; secondary: true; onClicked: { pendingPackage = null; selectedPaymentMethodId = "" } }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#d9030508"; visible: shouldShowPremiumPopup(); z: 25; focus: visible
            Keys.onPressed: function(event) { event.accepted = true }
            MouseArea {
                anchors.fill: parent
                acceptedButtons: Qt.AllButtons
                hoverEnabled: true
                propagateComposedEvents: false
                onPressed: function(mouse) { mouse.accepted = true }
                onReleased: function(mouse) { mouse.accepted = true }
                onClicked: function(mouse) { mouse.accepted = true }
                onDoubleClicked: function(mouse) { mouse.accepted = true }
                onWheel: function(wheel) { wheel.accepted = true }
            }
            GlassCard {
                width: 700; height: premiumContent.implicitHeight + 40; anchors.centerIn: parent; color: "#0b0f17"; z: 26
                Column {
                    id: premiumContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 22; spacing: 16
                    Row { width: parent.width; Rectangle { width: 112; height: 34; radius: 17; color: "#33e50914"; Text { anchors.centerIn: parent; text: "Premium Erisim"; color: "#ffd7da"; font.pixelSize: 12; font.bold: true } } Item { width: 1; height: 1 } AppButton { text: "Kapat"; secondary: true; implicitWidth: 96; onClicked: premiumPopupDismissed = true } }
                    Text { text: "Tum iceriklere erismek icin aktif bir paket satin alin"; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Text { text: "Giris basarili. Paketiniz aktif olunca kataloglarin tamami acilacak."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
                    Row { spacing: 12; AppButton { text: "Test Yapmak Istiyorum"; implicitWidth: 190; onClicked: apiClient.requestTrial("Windows native cihazindan test talebi") } AppButton { text: "WhatsApp ile Iletisime Gec"; secondary: true; implicitWidth: 220; onClicked: Qt.openUrlExternally(contactData().whatsapp || "") } AppButton { text: "Paket Satin Al"; secondary: true; implicitWidth: 170; onClicked: openScreen("packages") } }
                }
            }
        }

        Rectangle {
            visible: toastMessage.length > 0; z: 40; width: Math.min(640, toastLabel.implicitWidth + 52); height: 62; radius: 20; color: toastColor === success ? "#2230d19d" : toastColor === danger ? "#24ff7d86" : "#227cb6ff"; border.width: 1; border.color: toastColor; anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 24
            Text { id: toastLabel; anchors.centerIn: parent; text: toastMessage; color: window.textPrimary; font.pixelSize: 14; font.bold: true }
        }
    }
}
