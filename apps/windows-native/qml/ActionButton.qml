import QtQuick
import QtQuick.Controls

Button {
    id: control
    property bool prominent: false
    property bool light: false
    property bool selected: false
    property bool quiet: false
    readonly property bool handlesPlaybackKeys: true
    property string symbol: ""
    property string accessibleLabel: text
    hoverEnabled: true
    focusPolicy: Qt.StrongFocus
    implicitHeight: 42
    implicitWidth: Math.max(42, label.implicitWidth + 30)
    padding: 12
    Accessible.name: accessibleLabel
    Accessible.role: Accessible.Button
    contentItem: Text {
        id: label
        text: (control.symbol ? control.symbol + (control.text ? "  " : "") : "") + control.text
        font.family: "Segoe UI"
        font.pixelSize: 14
        font.weight: control.prominent || control.selected ? Font.DemiBold : Font.Normal
        color: !control.enabled ? "#78818F" : control.light || (control.prominent && !control.down) ? "#07090C" : "#F5F6F8"
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }
    background: Rectangle {
        radius: 10
        color: control.down ? (control.light ? "#BEC5CF" : "#A82130") : control.light ? (control.hovered ? "#D9DEE6" : "#F5F6F8") : control.prominent ? (control.hovered ? "#E52D3D" : "#FF3545") : control.hovered || control.selected ? "#252C36" : control.quiet ? "transparent" : "#13171E"
        border.color: control.activeFocus ? "#F5F6F8" : control.selected ? "#758090" : "transparent"
        border.width: control.activeFocus ? 2 : 1
    }
    ToolTip.visible: hovered && accessibleLabel !== text
    ToolTip.text: accessibleLabel
    ToolTip.delay: 650
}
