import QtQuick
import QtQuick.Controls

Button {
    id: control
    property string iconName: "close"
    property color iconColor: "white"
    property string accessibleLabel: ""
    readonly property bool handlesPlaybackKeys: true
    implicitWidth: 36
    implicitHeight: 36
    padding: 8
    hoverEnabled: true
    focusPolicy: Qt.StrongFocus
    Accessible.name: accessibleLabel
    Accessible.role: Accessible.Button
    opacity: enabled ? 1 : 0.35
    contentItem: PlayerIcon { name: control.iconName; ink: control.iconColor }
    background: Rectangle {
        radius: 10
        color: control.down ? "#38FFFFFF" : control.hovered ? "#24FFFFFF" : "#12FFFFFF"
        border.width: control.activeFocus ? 2 : 0
        border.color: "white"
    }
    HoverHandler { cursorShape: control.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor }
    ToolTip.visible: hovered
    ToolTip.text: accessibleLabel
    ToolTip.delay: 650
}
