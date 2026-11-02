import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

MenuItem {
    id: control
    property string leadingText: ""
    property string selectionIcon: "check"
    property color selectionColor: "white"
    implicitWidth: 260
    implicitHeight: Math.max(40, label.implicitHeight + 20)
    leftPadding: 10
    rightPadding: 35
    topPadding: 10
    bottomPadding: 10
    hoverEnabled: true
    opacity: enabled ? 1 : 0.7
    contentItem: RowLayout {
        spacing: 12
        Text {
            visible: !!control.leadingText
            text: control.leadingText
            color: "#B3FFFFFF"
            font.family: "Segoe UI"
            font.pixelSize: 13
            Layout.preferredWidth: 40
        }
        Text {
            id: label
            text: control.text
            color: "white"
            font.family: "Segoe UI"
            font.pixelSize: 13
            wrapMode: Text.WordWrap
            maximumLineCount: 2
            elide: Text.ElideRight
            Layout.fillWidth: true
        }
    }
    indicator: PlayerIcon {
        x: control.width - width - 10
        y: (control.height - height) / 2
        width: 17
        height: 17
        name: control.selectionIcon
        ink: control.selectionColor
        visible: control.checkable && control.checked
    }
    background: Rectangle {
        radius: 6
        color: control.down ? "#38FFFFFF" : control.highlighted || control.hovered ? "#21FFFFFF" : "transparent"
        border.width: control.activeFocus ? 1 : 0
        border.color: "white"
    }
    HoverHandler { cursorShape: control.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor }
}
