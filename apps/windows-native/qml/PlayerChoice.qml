import QtQuick
import QtQuick.Controls

Button {
    id: control
    property bool selected: false
    readonly property bool handlesPlaybackKeys: true
    implicitWidth: Math.max(40, contentItem.implicitWidth + 14)
    implicitHeight: 28
    padding: 7
    hoverEnabled: true
    focusPolicy: Qt.StrongFocus
    contentItem: Text {
        text: control.text
        color: "white"
        font.family: "Segoe UI"
        font.pixelSize: 12
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }
    background: Rectangle {
        radius: 5
        color: control.down ? "#4DFFFFFF" : control.selected ? "#38FFFFFF" : control.hovered ? "#2BFFFFFF" : "#17FFFFFF"
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? "white" : control.selected ? "#66FFFFFF" : "#29FFFFFF"
    }
    HoverHandler { cursorShape: Qt.PointingHandCursor }
}
