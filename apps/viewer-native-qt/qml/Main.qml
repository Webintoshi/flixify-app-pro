import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Flixify.Native 1.0

ApplicationWindow {
    id: window
    width: 1520
    height: 940
    visible: true
    title: "Flixify Native Qt"
    color: "#05060a"

    property var selectedSeries: ({})

    function refreshAllCatalogs() {
        apiClient.fetchAllCatalogs(searchField.text, 300)
    }

    Connections {
        target: apiClient
        function onLoginSucceeded() {
            window.refreshAllCatalogs()
        }
        function onSeriesChanged() {
            if ((!selectedSeries || !selectedSeries.id) && apiClient.series.length > 0) {
                selectedSeries = apiClient.series[0]
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 16

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 102
            radius: 22
            color: "#0d1119"
            border.color: "#272d3a"

            RowLayout {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 14

                TextField {
                    id: codeField
                    Layout.preferredWidth: 220
                    placeholderText: "Kryptonite kodu"
                    color: "#f4f7fb"
                    selectByMouse: true
                }

                TextField {
                    id: searchField
                    Layout.preferredWidth: 280
                    placeholderText: "Film, dizi, kanal ara"
                    color: "#f4f7fb"
                    selectByMouse: true
                    onAccepted: window.refreshAllCatalogs()
                }

                Button {
                    text: "Login"
                    onClicked: apiClient.loginByCode(codeField.text)
                }

                Button {
                    text: "Yenile"
                    enabled: apiClient.accessToken.length > 0
                    onClicked: window.refreshAllCatalogs()
                }

                BusyIndicator {
                    running: apiClient.busy || playbackController.busy
                    visible: running
                }

                Item {
                    Layout.fillWidth: true
                }

                Column {
                    spacing: 4
                    Text {
                        text: playbackController.activeTitle.length > 0 ? playbackController.activeTitle : "Hazir"
                        color: "#f4f7fb"
                        font.pixelSize: 18
                        font.bold: true
                    }
                    Text {
                        text: "State: " + playbackController.state + " | Decoder: " + playbackController.decoderMode
                        color: "#a7b1c2"
                    }
                    Text {
                        text: playbackController.lastError.length > 0 ? playbackController.lastError : "libVLC native VOD hazir"
                        color: playbackController.lastError.length > 0 ? "#ffb2b8" : "#9fb1d1"
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 18

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 28
                color: "#090b11"
                border.color: "#202737"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        radius: 22
                        color: "#05070d"
                        border.color: "#1b2230"

                        NativeVideoSurface {
                            anchors.fill: parent
                            anchors.margins: 8
                            onSurfaceHandleChanged: playbackController.setVideoSurfaceHandle(surfaceHandle)
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        Button {
                            text: playbackController.paused ? "Play" : "Pause"
                            onClicked: playbackController.togglePause()
                        }
                        Button {
                            text: "Geri 15sn"
                            enabled: playbackController.activeContentKind === "movie" || playbackController.activeContentKind === "episode"
                            onClicked: playbackController.seekBy(-15)
                        }
                        Button {
                            text: "Ileri 30sn"
                            enabled: playbackController.activeContentKind === "movie" || playbackController.activeContentKind === "episode"
                            onClicked: playbackController.seekBy(30)
                        }
                        Button {
                            text: "Tekrar Dene"
                            onClicked: playbackController.retryCurrent()
                        }
                        Button {
                            text: "Durdur"
                            onClicked: playbackController.stop()
                        }
                        Button {
                            text: "Sonraki Bolum"
                            enabled: playbackController.recommendedNextEpisode.id
                            visible: enabled
                            onClicked: playbackController.playRecommendedNextEpisode()
                        }

                        Item {
                            Layout.fillWidth: true
                        }

                        ColumnLayout {
                            spacing: 6
                            Text {
                                text: "Pozisyon: " + playbackController.positionSeconds.toFixed(1) + " / " + playbackController.durationSeconds.toFixed(1)
                                color: "#d7e1f6"
                            }
                            ComboBox {
                                Layout.preferredWidth: 260
                                enabled: playbackController.audioTracks.length > 0
                                model: playbackController.audioTracks
                                textRole: "title"
                                onActivated: (index) => {
                                    const track = playbackController.audioTracks[index]
                                    if (track && track.id) {
                                        playbackController.selectAudioTrack(track.id)
                                    }
                                }
                                Component.onCompleted: currentIndex = 0
                            }
                        }
                    }
                }
            }

            Rectangle {
                Layout.preferredWidth: 460
                Layout.fillHeight: true
                radius: 28
                color: "#0b0e14"
                border.color: "#202737"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: 12

                    TabBar {
                        id: catalogTabs
                        Layout.fillWidth: true

                        TabButton { text: "Canli TV" }
                        TabButton { text: "Filmler" }
                        TabButton { text: "Diziler" }
                    }

                    StackLayout {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        currentIndex: catalogTabs.currentIndex

                        ListView {
                            id: liveList
                            clip: true
                            spacing: 10
                            model: apiClient.liveChannels
                            delegate: ItemDelegate {
                                required property var modelData
                                width: liveList.width
                                highlighted: modelData.id === playbackController.activeContentId && playbackController.activeContentKind === "live"
                                onClicked: playbackController.playChannel(modelData.id)

                                background: Rectangle {
                                    radius: 18
                                    color: parent.highlighted ? "#ff223d" : "#131923"
                                    border.color: parent.highlighted ? "#ff5d74" : "#2a3140"
                                }

                                contentItem: Column {
                                    spacing: 2
                                    Text { text: modelData.title; color: "#f4f7fb"; font.pixelSize: 18; font.bold: true }
                                    Text { text: (modelData.variantGroupKey || "") + "  rank:" + (modelData.qualityRank || -1); color: "#b8c1d2"; font.pixelSize: 13 }
                                }
                            }
                        }

                        ListView {
                            id: movieList
                            clip: true
                            spacing: 10
                            model: apiClient.movies
                            delegate: ItemDelegate {
                                required property var modelData
                                width: movieList.width
                                highlighted: modelData.id === playbackController.activeContentId && playbackController.activeContentKind === "movie"
                                onClicked: playbackController.playVod("movie", modelData.id, modelData.title)

                                background: Rectangle {
                                    radius: 18
                                    color: parent.highlighted ? "#ff223d" : "#131923"
                                    border.color: parent.highlighted ? "#ff5d74" : "#2a3140"
                                }

                                contentItem: Column {
                                    spacing: 2
                                    Text { text: modelData.title; color: "#f4f7fb"; font.pixelSize: 18; font.bold: true }
                                    Text { text: modelData.groupTitle || "Film"; color: "#b8c1d2"; font.pixelSize: 13 }
                                }
                            }
                        }

                        ColumnLayout {
                            spacing: 12

                            ListView {
                                id: seriesList
                                Layout.fillWidth: true
                                Layout.preferredHeight: 250
                                clip: true
                                spacing: 10
                                model: apiClient.series
                                delegate: ItemDelegate {
                                    required property var modelData
                                    width: seriesList.width
                                    highlighted: selectedSeries && modelData.id === selectedSeries.id
                                    onClicked: selectedSeries = modelData

                                    background: Rectangle {
                                        radius: 18
                                        color: parent.highlighted ? "#ff223d" : "#131923"
                                        border.color: parent.highlighted ? "#ff5d74" : "#2a3140"
                                    }

                                    contentItem: Column {
                                        spacing: 2
                                        Text { text: modelData.title; color: "#f4f7fb"; font.pixelSize: 18; font.bold: true }
                                        Text { text: modelData.seasonCount + " sezon, " + modelData.episodeCount + " bolum"; color: "#b8c1d2"; font.pixelSize: 13 }
                                    }
                                }
                            }

                            ScrollView {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                clip: true

                                Column {
                                    width: parent.width
                                    spacing: 12

                                    Text {
                                        text: selectedSeries && selectedSeries.title ? selectedSeries.title : "Dizi secin"
                                        color: "#f4f7fb"
                                        font.pixelSize: 22
                                        font.bold: true
                                    }

                                    Repeater {
                                        model: selectedSeries && selectedSeries.seasons ? selectedSeries.seasons : []
                                        delegate: Rectangle {
                                            required property var modelData
                                            width: parent.width
                                            radius: 18
                                            color: "#121821"
                                            border.color: "#283244"

                                            Column {
                                                anchors.fill: parent
                                                anchors.margins: 12
                                                spacing: 8

                                                Text {
                                                    text: modelData.title + " (" + modelData.episodeCount + " bolum)"
                                                    color: "#f4f7fb"
                                                    font.pixelSize: 17
                                                    font.bold: true
                                                }

                                                Repeater {
                                                    model: modelData.episodes || []
                                                    delegate: Button {
                                                        required property var modelData
                                                        width: parent.width
                                                        text: "B" + modelData.episodeNumber + " • " + modelData.title
                                                        onClicked: playbackController.playVod("episode", modelData.id, modelData.title)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
