import QtQuick

Rectangle {
    id: art
    property string source: ""
    property bool landscape: false
    property string title: ""
    color: landscape ? "#E5E8ED" : "#171D26"
    radius: 9
    clip: true
    Image {
        anchors.fill: parent
        anchors.margins: art.landscape ? 16 : 0
        source: art.source
        asynchronous: true
        cache: true
        fillMode: art.landscape ? Image.PreserveAspectFit : Image.PreserveAspectCrop
        sourceSize.width: Math.ceil(art.width * 1.5)
        sourceSize.height: Math.ceil(art.height * 1.5)
        visible: status === Image.Ready
    }
    Text {
        anchors.centerIn: parent
        width: parent.width - 24
        text: art.title
        color: art.landscape ? "#303744" : "#A7B0BE"
        font.pixelSize: art.landscape ? 17 : 15
        font.weight: Font.DemiBold
        wrapMode: Text.WordWrap
        maximumLineCount: 3
        elide: Text.ElideRight
        horizontalAlignment: Text.AlignHCenter
        visible: !art.source || parent.children[0].status === Image.Error
    }
}
