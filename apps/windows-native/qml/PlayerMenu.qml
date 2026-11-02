import QtQuick
import QtQuick.Controls

Menu {
    id: menu
    popupType: Popup.Item
    width: 300
    padding: 20
    topPadding: 58
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    contentItem: ListView {
        implicitHeight: Math.min(contentHeight, 260)
        model: menu.contentModel
        currentIndex: menu.currentIndex
        spacing: 4
        clip: true
        interactive: contentHeight > height
        boundsBehavior: Flickable.StopAtBounds
        ScrollIndicator.vertical: ScrollIndicator {}
    }
    background: Rectangle {
        radius: 12
        color: "#F2222224"
        border.color: "#29FFFFFF"
        Text {
            x: 20
            y: 20
            width: parent.width - 40
            text: menu.title
            color: "white"
            font.family: "Segoe UI"
            font.pixelSize: 18
            font.weight: Font.Bold
            elide: Text.ElideRight
        }
    }
}
