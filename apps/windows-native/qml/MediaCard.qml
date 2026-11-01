import QtQuick
import QtQuick.Controls

FocusScope {
    id: card
    property var media: ({})
    property bool channel: media.kind === "live"
    property bool favorite: {
        repository.libraryRevision;
        return media.id ? repository.isFavorite(media) : false;
    }
    signal inspect(var media)
    signal focused
    implicitWidth: channel ? 214 : 150
    implicitHeight: artwork.height + 65
    Accessible.name: media.title || "İçerik"
    Button {
        id: play
        width: parent.width
        height: artwork.height + 44
        focus: true
        hoverEnabled: true
        Accessible.name: (card.media.title || "İçerik") + ", izle"
        background: Item {}
        contentItem: Item {}
        onClicked: repository.playItem(card.media)
        onHoveredChanged: if (hovered)
            card.focused()
        onActiveFocusChanged: if (activeFocus)
            card.focused()
        Artwork {
            id: artwork
            width: parent.width
            height: card.channel ? Math.round(width * 0.56) : Math.round(width * 1.48)
            source: card.media.artworkURL || ""
            title: card.media.title || ""
            landscape: card.channel
            Rectangle {
                anchors.fill: parent
                color: "#36000000"
                visible: play.hovered || play.activeFocus
            }
            Rectangle {
                anchors.centerIn: parent
                width: 44
                height: 44
                radius: 22
                color: "#E8FF3545"
                visible: play.hovered || play.activeFocus
                Text {
                    anchors.centerIn: parent
                    text: "▶"
                    color: "white"
                    font.pixelSize: 18
                }
            }
            Rectangle {
                anchors.fill: parent
                radius: 9
                color: "transparent"
                border.width: 2
                border.color: "#F5F6F8"
                visible: play.activeFocus
            }
        }
        Text {
            y: artwork.height + 10
            width: parent.width
            text: card.media.title || ""
            color: "#F5F6F8"
            font.pixelSize: 13
            font.weight: Font.DemiBold
            maximumLineCount: 2
            wrapMode: Text.WordWrap
            elide: Text.ElideRight
        }
    }
    Row {
        y: artwork.height + 46
        width: parent.width
        spacing: 4
        Text {
            text: card.channel ? "CANLI" : card.media.releaseYear > 0 ? String(card.media.releaseYear) : card.media.kind === "series" ? "Dizi" : "Film"
            color: card.channel ? "#FF6672" : "#A7B0BE"
            font.pixelSize: 11
            width: Math.max(25, parent.width - 78)
            anchors.verticalCenter: parent.verticalCenter
        }
        ActionButton {
            width: 32
            height: 30
            implicitHeight: 30
            padding: 0
            quiet: true
            symbol: card.favorite ? "♥" : "♡"
            accessibleLabel: card.favorite ? "Favorilerden çıkar" : "Favorilere ekle"
            onClicked: repository.toggleFavorite(card.media)
        }
        ActionButton {
            width: 32
            height: 30
            implicitHeight: 30
            padding: 0
            quiet: true
            symbol: "⋯"
            objectName: "inspect-" + card.media.kind + "-" + card.media.id
            accessibleLabel: card.media.kind === "series" ? "Sezon ve bölümler" : card.channel ? "Yayın akışı" : "İçerik bilgisi"
            onClicked: card.inspect(card.media)
        }
    }
}
