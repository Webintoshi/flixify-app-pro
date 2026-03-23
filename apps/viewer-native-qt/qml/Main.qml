import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
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

    readonly property color panel: "#0d121ccc"
    readonly property color panelSoft: "#131923"
    readonly property color panelStrong: "#080b11f0"
    readonly property color textPrimary: "#f7f8fb"
    readonly property color textMuted: "#b1bac9"
    readonly property color accent: "#e50914"
    readonly property color accentStrong: "#ff2432"
    readonly property color borderSoft: "#ffffff1a"
    readonly property color success: "#30d19d"
    readonly property color danger: "#ff7d86"
    readonly property color info: "#7cb6ff"

    property string currentScreen: apiClient.authenticated ? "home" : "login"
    property string authCode: ""
    property string authDeviceName: "Flixify Native Qt"
    property string registerDeviceName: "Flixify Native Qt"
    property string issuedCode: ""
    property int revealedCount: 0
    property int scrambleSeed: 0
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

    function subscriptionLabel() {
        const user = userData()
        if (user.hasActiveSubscription && user.activePackage) {
            return `${user.activePackage.title} • ${user.activePackage.remainingDays} gun`
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
                subtitle: `${item.seasonCount} sezon • ${item.episodeCount} bolum`,
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

    function shouldShowBlocked() { return apiClient.authenticated && userData().status === "blocked" }
    function shouldShowPremiumPopup() { return apiClient.authenticated && userData() && !userData().hasActiveSubscription && !premiumPopupDismissed && !pendingPackage && !playerVisible }
    function appUpdatePayload() { return apiClient.appUpdate || ({}) }
    function appUpdateVisible() { return Boolean(appUpdatePayload().updateAvailable && appUpdatePayload().latestVersion && appUpdatePayload().latestVersion !== dismissedUpdateVersion) }

    function openScreen(screenName) {
        currentScreen = screenName
        if (screenName === "packages") {
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

    function playLive(channel) {
        if (!channel || !channel.id) return
        selectedLiveId = channel.id
        playerSubtitle = channel.groupTitle || "Canli TV"
        playerImageUrl = channel.logoUrl || ""
        playerVisible = true
        playbackController.playChannel(channel.id)
    }

    function closePlayer() {
        playerVisible = false
        playbackController.stop()
    }

    Timer {
        id: revealTimer
        interval: 82
        repeat: true
        onTriggered: {
            if (revealedCount >= issuedCode.length) {
                stop()
                return
            }
            scrambleSeed += 1
            revealedCount += 1
        }
    }

    Timer {
        id: toastTimer
        interval: 3200
        repeat: false
        onTriggered: toastMessage = ""
    }

    Connections {
        target: apiClient
        function onLoginSucceeded() { currentScreen = "home"; premiumPopupDismissed = false }
        function onAnonCodeIssued(code) { issuedCode = sanitizeCode(code); revealedCount = 0; scrambleSeed = 0; registerAcknowledged = false; currentScreen = "register"; revealTimer.restart() }
        function onSeriesChanged() { if (!selectedSeriesId && (apiClient.series || []).length) selectedSeriesId = apiClient.series[0].id }
        function onLiveChannelsChanged() { if (!selectedLiveId && (apiClient.liveChannels || []).length) selectedLiveId = apiClient.liveChannels[0].id }
        function onLogoutCompleted() { currentScreen = "login"; authCode = ""; issuedCode = ""; closePlayer(); pendingPackage = null; selectedPaymentMethodId = "" }
        function onNoticeChanged() { if (apiClient.notice && apiClient.notice.length) showToast(apiClient.notice, success) }
        function onRequestFailed(context, message) { showToast(message, danger) }
    }

    Component.onCompleted: apiClient.bootstrap()

    component AppButton: Button {
        id: control
        property bool secondary: false
        implicitHeight: 50
        padding: 0
        font.pixelSize: 15
        font.bold: true
        background: Rectangle {
            radius: height / 2
            border.width: 1
            border.color: control.secondary ? window.borderSoft : "#00000000"
            gradient: Gradient {
                GradientStop { position: 0.0; color: control.secondary ? "#ffffff12" : window.accentStrong }
                GradientStop { position: 1.0; color: control.secondary ? "#ffffff12" : window.accent }
            }
            opacity: control.enabled ? 1.0 : 0.45
        }
        contentItem: Text {
            text: control.text
            color: "#ffffff"
            font: control.font
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component AppField: TextField {
        implicitHeight: 54
        color: window.textPrimary
        selectedTextColor: window.textPrimary
        selectionColor: "#e5091455"
        placeholderTextColor: "#8f98a8"
        font.pixelSize: 15
        leftPadding: 16
        rightPadding: 16
        background: Rectangle {
            radius: 16
            color: "#ffffff0d"
            border.width: 1
            border.color: parent.activeFocus ? "#ffffff40" : window.borderSoft
        }
    }

    component ChipButton: Button {
        id: chip
        property bool active: false
        implicitHeight: 42
        padding: 0
        background: Rectangle {
            radius: 21
            color: chip.active ? "#e5091430" : "#ffffff0a"
            border.width: 1
            border.color: chip.active ? "#ffffff28" : window.borderSoft
        }
        contentItem: Text {
            text: chip.text
            color: window.textPrimary
            font.pixelSize: 13
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component GlassCard: Rectangle {
        radius: 28
        color: window.panel
        border.width: 1
        border.color: window.borderSoft
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
            border.color: "#ffffff14"
        }

        Image {
            anchors.fill: parent
            anchors.margins: 1
            source: rail.item.posterUrl || rail.item.logoUrl || ""
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            visible: source.length > 0
            clip: true
        }

        Rectangle {
            anchors.fill: parent
            radius: 28
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#05070b11" }
                GradientStop { position: 0.62; color: "#05070b66" }
                GradientStop { position: 1.0; color: "#05070bf0" }
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
                color: "#ffffff14"
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
                color: rail.item.playbackAllowed ? "#30d19d2b" : "#ffffff14"
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

    Rectangle {
        anchors.fill: parent
        color: "#020307"

        Rectangle {
            width: parent.width * 0.42
            height: width
            x: -width * 0.25
            y: -height * 0.28
            radius: width / 2
            color: "#e5091422"
        }

        Rectangle {
            width: parent.width * 0.24
            height: width
            x: parent.width * 0.76
            y: parent.height * 0.06
            radius: width / 2
            color: "#6e4dff22"
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
            visible: !apiClient.authenticated

            ColumnLayout {
                anchors.centerIn: parent
                width: 620
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
                                  : "16 haneli erisim kodunuzla giris yapin"
                            color: "#d7dce6"
                            font.pixelSize: 18
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "login"

                            AppField {
                                width: parent.width
                                placeholderText: "X7F2 A9B1 C4D8 E6F0"
                                text: formatCode(authCode)
                                onTextChanged: {
                                    const normalized = sanitizeCode(text)
                                    if (normalized !== authCode) authCode = normalized
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
                                        color: index < progressSegments() ? window.accent : "#ffffff14"
                                    }
                                }
                            }

                            Text { text: `${sanitizeCode(authCode).length}/16`; color: window.textMuted; width: parent.width; horizontalAlignment: Text.AlignRight }
                            AppButton { width: parent.width; text: apiClient.busy ? "Giris Yapiliyor..." : "Giris Yap"; enabled: !apiClient.busy && sanitizeCode(authCode).length === 16; onClicked: apiClient.loginByCode(sanitizeCode(authCode), authDeviceName) }
                            AppButton { width: parent.width; text: "Hesap Olustur"; secondary: true; onClicked: currentScreen = "register" }
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "register"

                            AppField { width: parent.width; placeholderText: "Bu cihazin adi"; text: registerDeviceName; visible: !issuedCode.length; onTextChanged: registerDeviceName = text }
                            AppButton { width: parent.width; text: apiClient.busy ? "Kod Uretiliyor..." : "Hesap Numarasi Olustur"; visible: !issuedCode.length; enabled: !apiClient.busy; onClicked: apiClient.issueAnonCode(registerDeviceName) }

                            Rectangle {
                                width: parent.width; height: 154; radius: 22; color: "#0b0f17"; border.width: 1; border.color: issuedCode.length ? "#e5091442" : window.borderSoft; visible: issuedCode.length > 0
                                Column {
                                    anchors.fill: parent; anchors.margins: 20; spacing: 12
                                    Text { text: "Erisim Kodunuz"; color: window.textMuted; font.pixelSize: 13; font.bold: true }
                                    Text { text: animatedIssuedCode(); color: window.textPrimary; width: parent.width; horizontalAlignment: Text.AlignHCenter; font.pixelSize: 32; font.family: "Space Grotesk"; font.bold: true }
                                    Rectangle {
                                        width: parent.width; height: 8; radius: 4; color: "#ffffff14"
                                        Rectangle { width: parent.width * (issuedCode.length ? revealedCount / issuedCode.length : 0); height: parent.height; radius: 4; color: window.accent }
                                    }
                                }
                            }

                            Row {
                                width: parent.width; spacing: 12; visible: issuedCode.length > 0
                                AppButton {
                                    width: (parent.width - 12) / 2
                                    text: "Kopyala"
                                    secondary: true
                                    enabled: !revealTimer.running
                                    onClicked: {
                                        const copied = apiClient.copyText(issuedCode)
                                        showToast(copied ? "Kod kopyalandi." : "Kod kopyalanamadi.", copied ? success : danger)
                                    }
                                }
                                AppButton {
                                    width: (parent.width - 12) / 2
                                    text: "Kaydet"
                                    secondary: true
                                    enabled: !revealTimer.running
                                    onClicked: {
                                        const path = apiClient.saveTextFile("flixify-kod", `Flixify Pro Hesap Numarasi\nKod: ${formatCode(issuedCode)}\nTam kod: ${issuedCode}\n`)
                                        showToast(path.length ? "Kod dosyasi kaydedildi." : "Kod dosyasi kaydedilemedi.", path.length ? success : danger)
                                    }
                                }
                            }

                            Rectangle {
                                width: parent.width; height: 56; radius: 16; visible: issuedCode.length > 0; color: registerAcknowledged ? "#30d19d22" : "#ffffff0c"; border.width: 1; border.color: registerAcknowledged ? "#30d19d55" : window.borderSoft
                                Row {
                                    anchors.fill: parent; anchors.margins: 16; spacing: 12
                                    Rectangle { width: 22; height: 22; radius: 11; color: registerAcknowledged ? window.success : "#ffffff18"; anchors.verticalCenter: parent.verticalCenter; Text { anchors.centerIn: parent; text: registerAcknowledged ? "✓" : ""; color: "#04140d"; font.bold: true } }
                                    Text { anchors.verticalCenter: parent.verticalCenter; text: "Hesap numarami kaydettigimi onayliyorum"; color: window.textPrimary; font.pixelSize: 14 }
                                }
                                MouseArea { anchors.fill: parent; enabled: !revealTimer.running; onClicked: registerAcknowledged = !registerAcknowledged }
                            }

                            AppButton { width: parent.width; text: "Giris Ekranina Gec"; visible: issuedCode.length > 0; enabled: !revealTimer.running && registerAcknowledged; onClicked: { authCode = issuedCode; currentScreen = "login" } }
                            AppButton { width: parent.width; text: "Zaten Hesabim Var"; secondary: true; onClicked: currentScreen = "login" }
                        }

                        Row {
                            width: parent.width
                            spacing: 12
                            Repeater {
                                model: [
                                    { title: "Guvenli Erisim", copy: "Kodu kaydet, oturumu native uygulamadan ac." },
                                    { title: "Premium Deneyim", copy: "Film, dizi ve canli icerikler branded shell icinde acilir." }
                                ]
                                Rectangle {
                                    width: (parent.width - 12) / 2; height: 96; radius: 18; color: "#ffffff0a"; border.width: 1; border.color: window.borderSoft
                                    Column {
                                        anchors.fill: parent; anchors.margins: 16; spacing: 6
                                        Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 15; font.family: "Space Grotesk"; font.bold: true }
                                        Text { text: modelData.copy; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 }
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
            visible: apiClient.authenticated && !shouldShowBlocked()

            ColumnLayout {
                anchors.fill: parent
                spacing: 0

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 104
                    color: "#010204ee"

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
                                    Button {
                                        required property var modelData
                                        text: modelData.label
                                        flat: true
                                        onClicked: openScreen(modelData.key)
                                        contentItem: Column {
                                            spacing: 6
                                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: parent.parent.text; color: currentScreen === parent.parent.modelData.key ? window.textPrimary : "#ffffff9f"; font.pixelSize: 18; font.bold: true }
                                            Rectangle { anchors.horizontalCenter: parent.horizontalCenter; width: 56; height: 4; radius: 2; color: window.accent; visible: currentScreen === parent.parent.modelData.key }
                                        }
                                        background: Item {}
                                    }
                                }
                            }
                        }

                        Rectangle {
                            width: 232; height: 62; radius: 31; color: "#ffffff0a"; border.width: 1; border.color: window.borderSoft
                            Row {
                                anchors.fill: parent; anchors.margins: 6; spacing: 12
                                Rectangle { width: 50; height: 50; radius: 25; color: "#ffffff10"; anchors.verticalCenter: parent.verticalCenter; Text { anchors.centerIn: parent; text: "•"; color: window.textPrimary; font.pixelSize: 28 } }
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
                        Layout.preferredHeight: appUpdateVisible() ? 94 : 0
                        color: "#7cb6ff16"
                        border.width: appUpdateVisible() ? 1 : 0
                        border.color: "#7cb6ff30"
                        visible: appUpdateVisible()
                        Row {
                            anchors.fill: parent; anchors.margins: 18; spacing: 16
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 280
                                spacing: 4
                                Text { text: `Yeni surum hazir: v${appUpdatePayload().latestVersion || ""}`; color: window.textPrimary; font.pixelSize: 16; font.family: "Space Grotesk"; font.bold: true }
                                Text { text: appUpdatePayload().notes || "Guncelleme indirilebilir durumda."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 14 }
                            }
                            AppButton { anchors.verticalCenter: parent.verticalCenter; text: "Guncellemeyi Indir"; secondary: true; implicitWidth: 170; visible: Boolean(appUpdatePayload().downloadUrl); onClicked: Qt.openUrlExternally(appUpdatePayload().downloadUrl) }
                            AppButton { anchors.verticalCenter: parent.verticalCenter; text: "Daha Sonra"; secondary: true; implicitWidth: 120; onClicked: dismissedUpdateVersion = appUpdatePayload().latestVersion || "" }
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
                                        Image { anchors.fill: parent; anchors.margins: 1; source: homeHeroItem() ? (homeHeroItem().posterUrl || homeHeroItem().logoUrl || "") : ""; fillMode: Image.PreserveAspectCrop; asynchronous: true; visible: source.length > 0; clip: true }
                                        Rectangle { anchors.fill: parent; radius: 28; gradient: Gradient { GradientStop { position: 0.0; color: "#05070b33" } GradientStop { position: 0.48; color: "#05070b8a" } GradientStop { position: 1.0; color: "#05070bf0" } } }
                                        Row {
                                            anchors.fill: parent; anchors.margins: 34; spacing: 24
                                            Column {
                                                width: parent.width * 0.62; anchors.verticalCenter: parent.verticalCenter; spacing: 14
                                                Rectangle { width: 180; height: 34; radius: 17; color: "#ffffff14"; Text { anchors.centerIn: parent; text: homeHeroItem() && homeHeroItem().kind === "movie" ? "Flixify Film Selection" : homeHeroItem() && homeHeroItem().kind === "live" ? "Canli Yayin Spotlight" : "Binge-Worthy Series"; color: "#ffffffd8"; font.pixelSize: 12; font.bold: true } }
                                                Text { width: parent.width; wrapMode: Text.WordWrap; text: homeHeroItem() ? homeHeroItem().title : ""; color: window.textPrimary; font.pixelSize: 64; font.family: "Space Grotesk"; font.bold: true }
                                                Row { spacing: 10; Rectangle { width: subscriptionPill.implicitWidth + 28; height: 34; radius: 17; color: "#e5091433"; Text { id: subscriptionPill; anchors.centerIn: parent; text: subscriptionLabel(); color: "#ffd7da"; font.pixelSize: 12; font.bold: true } } }
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
                                                    width: parent.width; height: 188; color: "#080b10d8"
                                                    Column {
                                                        anchors.fill: parent; anchors.margins: 20; spacing: 10
                                                        Text { text: "Canli Spor Odagi"; color: "#ffffffd8"; font.pixelSize: 12; font.bold: true }
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
                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: 24
                                spacing: 20
                                GlassCard {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    color: "#090c13"
                                    Column {
                                        anchors.fill: parent; anchors.margins: 24; spacing: 18
                                        Text { text: "Canli TV"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                        AppField { width: parent.width; placeholderText: "Kanal ara..."; text: liveSearchText; onTextChanged: liveSearchText = text }
                                        Flickable {
                                            width: parent.width; height: 52; contentWidth: liveChipRow.width; clip: true
                                            Row {
                                                id: liveChipRow
                                                spacing: 10
                                                Repeater {
                                                    model: [""] .concat(uniqueGroups(apiClient.liveChannels || []))
                                                    ChipButton { required property var modelData; text: modelData.length ? modelData : "Tumu"; active: selectedLiveGroup === modelData; width: Math.max(96, implicitContentWidth + 28); onClicked: selectedLiveGroup = modelData }
                                                }
                                            }
                                        }
                                        GlassCard {
                                            width: parent.width; height: parent.height - 188; color: "#05070dcc"; visible: selectedLiveItem() !== null
                                            Column {
                                                anchors.fill: parent; anchors.margins: 26; spacing: 18
                                                Text { text: selectedLiveItem() ? selectedLiveItem().title : "Kanal secin"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap }
                                                Text { text: selectedLiveItem() ? (selectedLiveItem().groupTitle || "Canli TV") : ""; color: window.textMuted; font.pixelSize: 16 }
                                                AppButton { text: "Canli Yayini Ac"; implicitWidth: 180; onClicked: playLive(selectedLiveItem()) }
                                            }
                                        }
                                    }
                                }
                                GlassCard {
                                    Layout.preferredWidth: 420
                                    Layout.fillHeight: true
                                    color: "#0a0f18"
                                    Column {
                                        anchors.fill: parent; anchors.margins: 18; spacing: 14
                                        Text { text: "Kanallar"; color: window.textPrimary; font.pixelSize: 22; font.family: "Space Grotesk"; font.bold: true }
                                        ListView {
                                            width: parent.width; height: parent.height - 56; clip: true; spacing: 12; model: filteredLiveItems()
                                            delegate: Rectangle {
                                                required property var modelData
                                                width: parent.width; height: 88; radius: 22; color: selectedLiveId === modelData.id ? "#e50914" : "#131923"; border.width: 1; border.color: selectedLiveId === modelData.id ? "#ff5d74" : "#2a3140"
                                                Row { anchors.fill: parent; anchors.margins: 14; spacing: 14; Rectangle { width: 54; height: 54; radius: 18; color: "#ffffff14"; anchors.verticalCenter: parent.verticalCenter; Image { anchors.fill: parent; anchors.margins: 8; source: modelData.logoUrl || ""; fillMode: Image.PreserveAspectFit; visible: source.length > 0; asynchronous: true } } Column { anchors.verticalCenter: parent.verticalCenter; width: parent.width - 82; spacing: 4; Text { text: modelData.title; width: parent.width; elide: Text.ElideRight; color: "#ffffff"; font.pixelSize: 18; font.bold: true } Text { text: modelData.groupTitle || "Canli TV"; width: parent.width; elide: Text.ElideRight; color: selectedLiveId === modelData.id ? "#ffe8eb" : window.textMuted; font.pixelSize: 13 } } }
                                                MouseArea { anchors.fill: parent; onClicked: selectedLiveId = modelData.id; onDoubleClicked: playLive(modelData) }
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
                                Flow { width: parent.width; spacing: 20; Repeater { model: filteredMovies(); RailCard { width: 282; height: 420; item: modelData; cardKind: "movie"; onActivated: playMovie(apiClient.movieById(item.id)) } } }
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
                                Flow { width: parent.width; spacing: 20; Repeater { model: filteredSeries(); RailCard { width: 282; height: 430; item: ({ id: modelData.id, title: modelData.title, subtitle: `${modelData.seasonCount} sezon • ${modelData.episodeCount} bolum`, posterUrl: modelData.posterUrl, playbackAllowed: Boolean(modelData.featuredEpisode && modelData.featuredEpisode.playbackAllowed) }); cardKind: "episode"; onActivated: openSeriesDetail(modelData.id) } } }
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
                                    GlassCard { width: 320; height: 460; color: "#090c13"; Image { anchors.fill: parent; anchors.margins: 1; source: selectedSeries() ? (selectedSeries().posterUrl || "") : ""; fillMode: Image.PreserveAspectCrop; asynchronous: true; visible: source.length > 0; clip: true } }
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
                                            Text { text: `${modelData.title} • ${modelData.episodeCount} bolum`; color: window.textPrimary; font.pixelSize: 26; font.family: "Space Grotesk"; font.bold: true }
                                            Repeater {
                                                model: modelData.episodes || []
                                                Rectangle {
                                                    width: seasonContent.width; height: 80; radius: 20; color: "#131923"; border.width: 1; border.color: "#2a3140"
                                                    Row {
                                                        anchors.fill: parent; anchors.margins: 16; spacing: 18
                                                        Text { anchors.verticalCenter: parent.verticalCenter; text: `B${modelData.episodeNumber}`; color: "#ffffffa6"; font.pixelSize: 14; font.bold: true }
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
                                            Column { anchors.fill: parent; anchors.margins: 22; spacing: 10; Rectangle { width: 82; height: 34; radius: 17; color: "#ffffff14"; Text { anchors.centerIn: parent; text: `${modelData.durationMonths} ay`; color: window.textPrimary; font.pixelSize: 12; font.bold: true } } Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 30; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap } Text { text: modelData.priceLabel || "Fiyat bilgisi destek ekibinden alinir."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 14 } AppButton { text: "Paket Al"; implicitWidth: 132; onClicked: { pendingPackage = modelData; selectedPaymentMethodId = ""; apiClient.fetchPaymentMethods() } } }
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
            anchors.fill: parent; color: "#030508d9"; visible: playerVisible; z: 20
            GlassCard {
                anchors.fill: parent; anchors.margins: 18; color: "#080a0ef2"; z: 21
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 14
                    RowLayout { Layout.fillWidth: true; ColumnLayout { Layout.fillWidth: true; spacing: 4; Text { text: playbackController.activeContentKind === "live" ? "Canli TV" : playbackController.activeContentKind === "movie" ? "Film" : "Dizi"; color: "#ffffffc7"; font.pixelSize: 12; font.bold: true } Text { text: playbackController.activeTitle.length ? playbackController.activeTitle : "Player Hazir"; color: window.textPrimary; font.pixelSize: 28; font.family: "Space Grotesk"; font.bold: true } Text { text: playerSubtitle; color: window.textMuted; font.pixelSize: 14; visible: text.length > 0 } } AppButton { text: "Kapat"; secondary: true; implicitWidth: 120; onClicked: closePlayer() } }
                    RowLayout {
                        Layout.fillWidth: true; Layout.fillHeight: true; spacing: 16
                        GlassCard {
                            Layout.fillWidth: true; Layout.fillHeight: true; color: "#000000"
                            NativeVideoSurface { anchors.fill: parent; anchors.margins: 6; onSurfaceHandleChanged: playbackController.setVideoSurfaceHandle(surfaceHandle) }
                            Rectangle { anchors.left: parent.left; anchors.top: parent.top; anchors.margins: 18; width: stateLabel.implicitWidth + 28; height: 40; radius: 20; color: "#070a0fc7"; border.width: 1; border.color: "#ffffff12"; Text { id: stateLabel; anchors.centerIn: parent; text: playbackController.state === "buffering" ? "Buffer dolduruluyor" : playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazirlaniyor" : playbackController.state === "error" ? "Yayin acilamadi" : "Yayin hazir"; color: window.textPrimary; font.pixelSize: 13; font.bold: true } }
                            Rectangle {
                                anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 16; height: 78; radius: 22; color: "#070a0fc7"; border.width: 1; border.color: "#ffffff12"
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
                        GlassCard { Layout.preferredWidth: 320; Layout.fillHeight: true; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 12; Text { text: "Yayin Bilgisi"; color: window.textPrimary; font.pixelSize: 20; font.family: "Space Grotesk"; font.bold: true } Rectangle { width: parent.width; height: 180; radius: 22; color: "#ffffff08"; border.width: 1; border.color: window.borderSoft; Image { anchors.fill: parent; anchors.margins: 1; source: playerImageUrl; fillMode: Image.PreserveAspectCrop; asynchronous: true; visible: source.length > 0; clip: true } Text { anchors.centerIn: parent; visible: !playerImageUrl.length; text: "FLIXIFY"; color: "#ffffff77"; font.pixelSize: 28; font.family: "Space Grotesk"; font.bold: true } } Text { text: playbackController.lastError.length ? playbackController.lastError : "Native player branded shell icinde hazir."; width: parent.width; wrapMode: Text.WordWrap; color: playbackController.lastError.length ? "#ffb2b8" : window.textMuted; font.pixelSize: 14 } } }
                    }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#030508d9"; visible: pendingPackage !== null; z: 30
            GlassCard {
                width: 740; height: paymentContent.implicitHeight + 40; anchors.centerIn: parent; color: "#0b0f17"; z: 31
                Column {
                    id: paymentContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 20; spacing: 16
                    Row { width: parent.width; Text { text: "Odeme Yontemi"; color: "#ffffffd8"; font.pixelSize: 12; font.bold: true } Item { width: 1; height: 1 } AppButton { text: "Kapat"; secondary: true; implicitWidth: 96; onClicked: { pendingPackage = null; selectedPaymentMethodId = "" } } }
                    Text { text: pendingPackage ? `${pendingPackage.title} paketi icin odeme yontemi secin` : ""; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Flow {
                        width: parent.width; spacing: 12
                        Repeater {
                            model: paymentMethods()
                            GlassCard { width: (parent.width - 12) / 2; height: 94; color: selectedPaymentMethodId === modelData.id ? "#e5091422" : "#131923"; border.color: selectedPaymentMethodId === modelData.id ? "#ffffff30" : "#2a3140"; Column { anchors.fill: parent; anchors.margins: 16; spacing: 6; Text { text: modelData.label || modelData.id; color: window.textPrimary; font.pixelSize: 18; font.bold: true } Text { text: modelData.details || "Onay sureci destek ekibi tarafindan baslatilir."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 } } MouseArea { anchors.fill: parent; onClicked: selectedPaymentMethodId = modelData.id } }
                        }
                    }
                    AppButton { width: parent.width; text: "Odeme Bildir"; enabled: selectedPaymentMethod() !== null && !apiClient.busy; onClicked: { apiClient.requestPayment(pendingPackage.slug); if (contactData().whatsapp) Qt.openUrlExternally(contactData().whatsapp); pendingPackage = null; selectedPaymentMethodId = ""; openScreen("payments") } }
                    AppButton { width: parent.width; text: "Vazgec"; secondary: true; onClicked: { pendingPackage = null; selectedPaymentMethodId = "" } }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#030508d9"; visible: shouldShowPremiumPopup(); z: 25
            GlassCard {
                width: 700; height: premiumContent.implicitHeight + 40; anchors.centerIn: parent; color: "#0b0f17"; z: 26
                Column {
                    id: premiumContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 22; spacing: 16
                    Row { width: parent.width; Rectangle { width: 112; height: 34; radius: 17; color: "#e5091433"; Text { anchors.centerIn: parent; text: "Premium Erisim"; color: "#ffd7da"; font.pixelSize: 12; font.bold: true } } Item { width: 1; height: 1 } AppButton { text: "Kapat"; secondary: true; implicitWidth: 96; onClicked: premiumPopupDismissed = true } }
                    Text { text: "Tum iceriklere erismek icin aktif bir paket satin alin"; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Text { text: "Giris basarili. Paketiniz aktif olunca kataloglarin tamami acilacak."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
                    Row { spacing: 12; AppButton { text: "Test Yapmak Istiyorum"; implicitWidth: 190; onClicked: apiClient.requestTrial("Windows native cihazindan test talebi") } AppButton { text: "WhatsApp ile Iletisime Gec"; secondary: true; implicitWidth: 220; onClicked: Qt.openUrlExternally(contactData().whatsapp || "") } AppButton { text: "Paket Satin Al"; secondary: true; implicitWidth: 170; onClicked: openScreen("packages") } }
                }
            }
        }

        Rectangle {
            visible: toastMessage.length > 0; z: 40; width: Math.min(640, toastLabel.implicitWidth + 52); height: 62; radius: 20; color: toastColor === success ? "#30d19d22" : toastColor === danger ? "#ff7d8624" : "#7cb6ff22"; border.width: 1; border.color: toastColor; anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 24
            Text { id: toastLabel; anchors.centerIn: parent; text: toastMessage; color: window.textPrimary; font.pixelSize: 14; font.bold: true }
        }
    }
}
