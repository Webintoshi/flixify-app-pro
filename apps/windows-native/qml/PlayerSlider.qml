import QtQuick
import QtQuick.Controls

Slider {
    id: control
    readonly property bool handlesPlaybackKeys: true
    implicitWidth: 200
    implicitHeight: 22
    padding: 0
    focusPolicy: Qt.StrongFocus
    opacity: enabled ? 1 : 0.35
    background: Rectangle {
        x: control.leftPadding + control.handle.width / 2
        y: control.topPadding + (control.availableHeight - height) / 2
        width: control.availableWidth - control.handle.width
        height: 3
        radius: 1.5
        color: "#66FFFFFF"
        Rectangle {
            width: control.visualPosition * parent.width
            height: parent.height
            radius: parent.radius
            color: "white"
        }
    }
    handle: Rectangle {
        x: control.leftPadding + control.visualPosition * (control.availableWidth - width)
        y: control.topPadding + (control.availableHeight - height) / 2
        width: 13
        height: 13
        radius: 6.5
        color: control.pressed ? "#D9D9D9" : "white"
        Rectangle {
            anchors.fill: parent
            anchors.margins: -4
            radius: width / 2
            color: "transparent"
            border.width: control.activeFocus ? 2 : 0
            border.color: "white"
        }
    }
    HoverHandler { cursorShape: control.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor }
}
