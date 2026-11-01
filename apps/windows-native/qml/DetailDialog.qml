import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Popup {
    id: detail
    parent: Overlay.overlay
    anchors.centerIn: parent
    width: Math.min(800, parent.width - 60)
    height: Math.min(media.kind === "live" ? 570 : 420, parent.height - 60)
    modal: true
    focus: true
    padding: 28
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    property var media: ({})
    function show(value) {
        media = value;
        if (value.kind === "live")
            repository.loadEpg(value);
        open();
    }
    background: Rectangle {
        color: "#07090C"
        radius: 16
        border.color: "#343D4B"
    }
    ColumnLayout {
        anchors.fill: parent
        spacing: 20
        ActionButton {
            Layout.alignment: Qt.AlignRight
            text: "Kapat"
            symbol: "×"
            quiet: true
            onClicked: detail.close()
        }
        RowLayout {
            spacing: 24
            Layout.fillWidth: true
            Artwork {
                source: detail.media.artworkURL || ""
                title: detail.media.title || ""
                landscape: detail.media.kind === "live"
                Layout.preferredWidth: detail.media.kind === "live" ? 200 : 140
                Layout.preferredHeight: detail.media.kind === "live" ? 113 : 208
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 16
                Text {
                    text: detail.media.title || ""
                    color: "#F5F6F8"
                    font.pixelSize: 29
                    font.weight: Font.Bold
                    wrapMode: Text.WordWrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                Text {
                    visible: detail.media.releaseYear > 0
                    text: detail.media.releaseYear || ""
                    color: "#A7B0BE"
                    font.pixelSize: 14
                }
                Text {
                    visible: !!detail.media.description
                    text: detail.media.description || ""
                    color: "#A7B0BE"
                    font.pixelSize: 13
                    wrapMode: Text.WordWrap
                    maximumLineCount: 5
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                RowLayout {
                    spacing: 12
                    ActionButton {
                        text: detail.media.kind === "live" ? "Canlı izle" : "İzle"
                        symbol: "▶"
                        prominent: true
                        onClicked: {
                            repository.playItem(detail.media);
                            detail.close();
                        }
                    }
                    ActionButton {
                        symbol: {
                            repository.libraryRevision;
                            return detail.media.id && repository.isFavorite(detail.media) ? "♥" : "♡";
                        }
                        accessibleLabel: "Favorileri değiştir"
                        onClicked: repository.toggleFavorite(detail.media)
                    }
                }
            }
        }
        Text {
            visible: detail.media.kind === "live"
            text: "Yayın akışı"
            color: "#F5F6F8"
            font.pixelSize: 23
            font.weight: Font.Bold
        }
        ListView {
            visible: detail.media.kind === "live"
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: repository.programmes
            clip: true
            reuseItems: true
            ScrollBar.vertical: ScrollBar {}
            delegate: RowLayout {
                required property var modelData
                width: ListView.view.width
                height: 45
                spacing: 16
                Text {
                    text: new Date(modelData.startsAt).toLocaleTimeString(Qt.locale("tr_TR"), "HH:mm")
                    color: "#A7B0BE"
                    font.pixelSize: 13
                    Layout.preferredWidth: 48
                }
                Text {
                    text: modelData.title
                    color: "#F5F6F8"
                    font.pixelSize: 14
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                Text {
                    visible: modelData.startsAt <= Date.now() && modelData.endsAt > Date.now()
                    text: "Şimdi"
                    color: "#FF6672"
                    font.pixelSize: 12
                }
            }
            Text {
                anchors.centerIn: parent
                visible: repository.programmes.length === 0
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                text: "Bu kanal için yayın akışı bilgisi bulunmuyor."
                color: "#A7B0BE"
                font.pixelSize: 13
            }
        }
        Item {
            visible: detail.media.kind !== "live"
            Layout.fillHeight: true
        }
    }
}
