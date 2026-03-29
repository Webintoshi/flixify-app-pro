import QtQuick
import QtMultimedia

Item {
    id: root

    property var controller: null
    property int slotIndex: 0

    signal pointerActivity()

    function syncSurfaceBinding() {
    }

    Rectangle {
        anchors.fill: parent
        color: "#000000"
    }

    VideoOutput {
        id: videoOutput
        anchors.fill: parent
        source: root.controller ? root.controller.mediaPlayer : null
        fillMode: {
            if (!root.controller) {
                return VideoOutput.PreserveAspectFit
            }
            return root.controller.videoFillMode === "fill"
                ? VideoOutput.PreserveAspectCrop
                : VideoOutput.PreserveAspectFit
        }
    }

    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton
        onEntered: root.pointerActivity()
        onPositionChanged: root.pointerActivity()
        onPressed: root.pointerActivity()
        onClicked: root.pointerActivity()
    }
}
