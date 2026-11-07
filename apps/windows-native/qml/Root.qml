import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import QtMultimedia

ApplicationWindow {
    id: root
    objectName: "mainWindow"
    width: 1280
    height: 800
    minimumWidth: 900
    minimumHeight: 620
    visible: true
    property bool shuttingDown: false
    onClosing: {
        shuttingDown = true
        player.close()
        Qt.quit()
    }
    title: "Flixify Pro"
    color: "#07090C"
    font.family: "Segoe UI"
    palette.window: "#07090C"
    palette.windowText: "#F5F6F8"
    palette.text: "#F5F6F8"
    palette.base: "#13171E"
    palette.button: "#252C36"
    palette.buttonText: "#F5F6F8"
    palette.highlight: "#FF3545"
    palette.highlightedText: "#F5F6F8"
    property string requestedSeries: ""
    property var seriesData: repository.seriesDetail
    property bool seriesPending: false
    property bool deviceLoginCompleting: repository.pairingStatus === "authorized" || repository.pairingStatus === "bootstrap_error"
    property bool accessExpired: repository.authenticated && !repository.welcomeVisible && !deviceLoginCompleting && repository.account.canPlay === false
    onSeriesDataChanged: {
        if (seriesPending && seriesData.series && String(seriesData.series.id) === requestedSeries) {
            seriesPending = false;
            seriesDialog.open();
        }
    }
    function inspect(media) {
        if (media.kind === "series") {
            requestedSeries = String(media.id);
            seriesPending = true;
            repository.showSeries(media);
            if (repository.seriesDetail.series && String(repository.seriesDetail.series.id) === requestedSeries) {
                seriesPending = false;
                seriesDialog.open();
            }
        } else
            filmDialog.show(media);
    }
    function searchAll(value) {
        if (value.trim() && repository.route !== "search")
            repository.navigate("search");
        repository.setQuery(value);
    }
    Connections {
        target: repository
        function onSourceChanged() {
            root.seriesPending = false;
            seriesDialog.close();
            filmDialog.close();
        }
        function onAccessRevoked() {
            root.seriesPending = false;
            seriesDialog.close();
            filmDialog.close();
        }
    }
    SoundEffect {
        id: posterSound
        source: "qrc:/brand/poster_move.wav"
        volume: 0.22
    }
    Timer {
        id: soundThrottle
        interval: 100
    }
    function posterFocused() {
        if (repository.posterSoundEnabled && !player.active && !soundThrottle.running) {
            posterSound.play();
            soundThrottle.start();
        }
    }
    Shortcut {
        sequence: "Ctrl+F"
        enabled: repository.authenticated && !player.active
        onActivated: {
            search.forceActiveFocus();
            search.selectAll();
        }
    }
    Item {
        anchors.fill: parent
        visible: !repository.bootstrapping && repository.authenticated && !repository.welcomeVisible && !root.accessExpired && !root.deviceLoginCompleting
        enabled: !player.active
        Rectangle {
            id: sidebar
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: root.width < 1050 ? 190 : 220
            color: "#07090C"
            Rectangle {
                anchors.right: parent.right
                height: parent.height
                width: 1
                color: "#1C222C"
            }
            Image {
                x: 28
                y: 46
                width: sidebar.width - 56
                height: 53
                source: "qrc:/brand/flixify-logo.png"
                fillMode: Image.PreserveAspectFit
                sourceSize.width: 340
            }
            Column {
                x: 17
                y: 139
                width: sidebar.width - 34
                spacing: 10
                Repeater {
                    model: [
                        {
                            route: "home",
                            title: "Ana Sayfa",
                            icon: "⌂"
                        },
                        {
                            route: "live",
                            title: "Canlı TV",
                            icon: "▣"
                        },
                        {
                            route: "movies",
                            title: "Filmler",
                            icon: "▤"
                        },
                        {
                            route: "series",
                            title: "Diziler",
                            icon: "▥"
                        },
                        {
                            route: "favorites",
                            title: "Favoriler",
                            icon: "♡"
                        },
                        {
                            route: "account",
                            title: "Hesabım",
                            icon: "♙"
                        }
                    ]
                    delegate: Button {
                        id: nav
                        objectName: "nav-" + modelData.route
                        required property var modelData
                        property bool current: repository.route === modelData.route
                        width: parent.width
                        height: 50
                        hoverEnabled: true
                        Accessible.name: modelData.title
                        Accessible.role: Accessible.PageTab
                        Accessible.checkable: true
                        Accessible.checked: current
                        onClicked: repository.navigate(modelData.route)
                        background: Rectangle {
                            radius: 25
                            color: nav.current ? "#1D222B" : nav.hovered ? "#13171E" : "transparent"
                            border.color: nav.activeFocus ? "#F5F6F8" : nav.current ? "#6D7684" : "transparent"
                            border.width: nav.activeFocus ? 2 : 1
                        }
                        contentItem: RowLayout {
                            spacing: 13
                            RouteIcon {
                                route: nav.modelData.route
                                stroke: nav.current ? "#F5F6F8" : "#A7B0BE"
                                Layout.preferredWidth: 23
                                Layout.preferredHeight: 23
                            }
                            Text {
                                text: nav.modelData.title
                                color: nav.current ? "#F5F6F8" : "#A7B0BE"
                                font.pixelSize: 14
                                font.weight: nav.current ? Font.DemiBold : Font.Normal
                                Layout.fillWidth: true
                            }
                        }
                        leftPadding: 16
                        rightPadding: 14
                    }
                }
            }
            Text {
                x: 30
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 27
                text: "Windows · " + appVersion
                color: "#788495"
                font.pixelSize: 11
            }
        }
        Item {
            anchors.left: sidebar.right
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            RowLayout {
                id: topBar
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.leftMargin: 30
                anchors.rightMargin: 30
                height: 66
                spacing: 16
                Text {
                    objectName: "headerTrialCountdown"
                    text: repository.trialCountdownText || (repository.account.trial ? "Deneme hesabı" : "Flixify Pro")
                    color: "#A7B0BE"
                    font.pixelSize: 12
                    Layout.fillWidth: true
                }
                ActionButton {
                    text: "Paketleri gör"
                    quiet: true
                    visible: repository.trialCountdownStatus === "active" || repository.trialCountdownStatus === "expired"
                    onClicked: repository.openWebsite("packages")
                }
                TextField {
                    id: search
                    objectName: "catalogSearch"
                    Layout.preferredWidth: Math.min(330, root.width / 3)
                    implicitHeight: 38
                    placeholderText: "Film, dizi veya kanal ara"
                    text: repository.query
                    color: "#F5F6F8"
                    placeholderTextColor: "#A7B0BE"
                    font.pixelSize: 13
                    leftPadding: 16
                    rightPadding: search.text ? 44 : 16
                    selectByMouse: true
                    Accessible.name: "Film, dizi veya kanal ara, Ctrl F"
                    background: Rectangle {
                        color: "#13171E"
                        radius: 19
                        border.color: search.activeFocus ? "#F5F6F8" : "#29313D"
                    }
                    onTextEdited: searchDelay.restart()
                    onAccepted: {
                        searchDelay.stop();
                        root.searchAll(text);
                    }
                    Keys.onEscapePressed: {
                        clear();
                        repository.setQuery("");
                        focus = false;
                    }
                    ActionButton {
                        visible: !!search.text
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        width: 36
                        height: 34
                        quiet: true
                        symbol: "×"
                        accessibleLabel: "Aramayı temizle"
                        onClicked: {
                            search.clear();
                            repository.setQuery("");
                        }
                    }
                    Timer {
                        id: searchDelay
                        interval: 160
                        onTriggered: root.searchAll(search.text)
                    }
                }
            }
            BrowsePage {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: topBar.bottom
                anchors.bottom: parent.bottom
                visible: repository.route !== "account"
                onInspect: value => root.inspect(value)
                onPosterFocused: root.posterFocused()
            }
            AccountPage {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: topBar.bottom
                anchors.bottom: parent.bottom
                visible: repository.route === "account"
            }
        }
    }
    AccessPage {
        anchors.fill: parent
        visible: !repository.bootstrapping && (!repository.authenticated || repository.welcomeVisible || root.deviceLoginCompleting)
    }
    AccessExpired { anchors.fill: parent; visible: !repository.bootstrapping && root.accessExpired }
    Rectangle {
        anchors.fill: parent
        color: "#07090C"
        visible: repository.bootstrapping
        Column {
            anchors.centerIn: parent
            spacing: 27
            Image {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 220
                height: 75
                source: "qrc:/brand/flixify-logo.png"
                fillMode: Image.PreserveAspectFit
            }
            BusyIndicator {
                anchors.horizontalCenter: parent.horizontalCenter
                running: repository.bootstrapping
                palette.dark: "#FF3545"
            }
            Text {
                text: "İçeriklerin hazırlanıyor…"
                color: "#A7B0BE"
                font.pixelSize: 14
            }
        }
    }
    Rectangle {
        anchors.fill: parent
        color: "#80000000"
        visible: root.seriesPending
        MouseArea {
            anchors.fill: parent
        }
        Rectangle {
            width: 250
            height: 142
            anchors.centerIn: parent
            radius: 16
            color: "#13171E"
            Column {
                anchors.centerIn: parent
                spacing: 12
                BusyIndicator {
                    anchors.horizontalCenter: parent.horizontalCenter
                    running: root.seriesPending
                }
                Text {
                    text: "Bölümler yükleniyor…"
                    color: "#F5F6F8"
                    font.pixelSize: 14
                }
            }
        }
    }
    Connections {
        target: repository
        function onStateChanged() {
            if (root.seriesPending && repository.error && !repository.busy)
                root.seriesPending = false;
        }
    }
    SeriesDialog {
        id: seriesDialog
    }
    DetailDialog {
        id: filmDialog
    }
    PlayerWindow {
        owner: root
        onSeriesRequested: value => root.inspect(value)
    }
}
