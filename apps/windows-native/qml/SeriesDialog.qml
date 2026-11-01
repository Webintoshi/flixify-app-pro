import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Popup {
    id: detail
    objectName: "seriesPopup"
    parent: Overlay.overlay
    anchors.centerIn: parent
    width: Math.min(900, parent.width - 60)
    height: Math.min(710, parent.height - 60)
    modal: true
    focus: true
    padding: 28
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    property var data: repository.seriesDetail || ({})
    property var series: data.series || ({})
    property var seasons: data.seasons || []
    property int seasonIndex: 0
    onOpened: seasonIndex = 0
    background: Rectangle {
        color: "#07090C"
        radius: 16
        border.color: "#343D4B"
    }
    ColumnLayout {
        anchors.fill: parent
        spacing: 22
        RowLayout {
            Layout.fillWidth: true
            Text {
                text: "Sezon ve bölümler"
                color: "#A7B0BE"
                font.pixelSize: 13
                Layout.fillWidth: true
            }
            ActionButton {
                text: "Kapat"
                symbol: "×"
                quiet: true
                onClicked: detail.close()
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 24
            Artwork {
                Layout.preferredWidth: 120
                Layout.preferredHeight: 178
                source: detail.series.artworkURL || ""
                title: detail.series.title || ""
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 14
                Text {
                    text: detail.series.title || "Dizi"
                    color: "#F5F6F8"
                    font.pixelSize: 29
                    font.weight: Font.Bold
                    wrapMode: Text.WordWrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                Text {
                    visible: !!detail.series.description
                    text: detail.series.description || ""
                    color: "#A7B0BE"
                    font.pixelSize: 13
                    wrapMode: Text.WordWrap
                    maximumLineCount: 3
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                RowLayout {
                    spacing: 12
                    ActionButton {
                        text: "İzle"
                        symbol: "▶"
                        prominent: true
                        onClicked: {
                            repository.playItem(detail.series);
                            detail.close();
                        }
                    }
                    ActionButton {
                        text: {
                            repository.libraryRevision;
                            return detail.series.id && repository.isFavorite(detail.series) ? "Listemde" : "Listeme ekle";
                        }
                        symbol: "♡"
                        onClicked: repository.toggleFavorite(detail.series)
                    }
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Text {
                text: "Bölümler"
                color: "#F5F6F8"
                font.pixelSize: 23
                font.weight: Font.Bold
                Layout.fillWidth: true
            }
            SelectBox {
                id: seasonPicker
                Layout.preferredWidth: 165
                model: detail.seasons.map(function (s) {
                    return s.number + ". Sezon";
                })
                currentIndex: detail.seasonIndex
                Accessible.name: "Sezon seç"
                onActivated: {
                    detail.seasonIndex = currentIndex;
                    episodes.positionViewAtBeginning();
                }
            }
        }
        ListView {
            id: episodes
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            reuseItems: true
            spacing: 2
            model: detail.seasons.length > detail.seasonIndex ? detail.seasons[detail.seasonIndex].episodes : []
            ScrollBar.vertical: ScrollBar {}
            delegate: Button {
                id: episode
                required property var modelData
                width: episodes.width
                height: 92
                hoverEnabled: true
                Accessible.name: modelData.season + ". Sezon " + modelData.episode + ". Bölüm, " + modelData.title
                onClicked: {
                    repository.playItem(modelData);
                    detail.close();
                }
                background: Rectangle {
                    color: episode.hovered ? "#171E28" : "transparent"
                    radius: 8
                    border.color: episode.activeFocus ? "#F5F6F8" : "transparent"
                    border.width: 2
                }
                contentItem: RowLayout {
                    spacing: 16
                    Text {
                        text: episode.modelData.episode || ""
                        color: "#A7B0BE"
                        font.pixelSize: 21
                        Layout.preferredWidth: 28
                        horizontalAlignment: Text.AlignHCenter
                    }
                    Artwork {
                        source: episode.modelData.artworkURL || detail.series.artworkURL || ""
                        Layout.preferredWidth: 112
                        Layout.preferredHeight: 66
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 6
                        Text {
                            text: episode.modelData.title
                            color: "#F5F6F8"
                            font.pixelSize: 15
                            font.weight: Font.DemiBold
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        Text {
                            text: episode.modelData.season + ". Sezon · " + episode.modelData.episode + ". Bölüm"
                            color: "#A7B0BE"
                            font.pixelSize: 12
                        }
                    }
                    Text {
                        text: "▶"
                        color: "#F5F6F8"
                        font.pixelSize: 16
                        rightPadding: 14
                    }
                }
            }
            Text {
                anchors.centerIn: parent
                visible: episodes.count === 0
                text: repository.busy ? "Bölümler yükleniyor…" : "Bu sezon için bölüm bulunamadı."
                color: "#A7B0BE"
                font.pixelSize: 14
            }
        }
    }
}
