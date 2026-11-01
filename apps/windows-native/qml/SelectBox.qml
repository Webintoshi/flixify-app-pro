import QtQuick
import QtQuick.Controls

ComboBox {
    id: selector
    indicator: Canvas {
        id: chevron
        objectName: "selectIndicator"
        x: selector.width - width - 12
        y: (selector.height - height) / 2
        implicitWidth: 16
        implicitHeight: 16
        property color stroke: selector.enabled ? "#A7B0BE" : "#78818F"
        onStrokeChanged: requestPaint()
        onPaint: {
            const context = getContext("2d")
            context.clearRect(0, 0, width, height)
            context.strokeStyle = stroke
            context.lineWidth = 2
            context.lineCap = "round"
            context.lineJoin = "round"
            context.beginPath()
            context.moveTo(3, 6)
            context.lineTo(8, 11)
            context.lineTo(13, 6)
            context.stroke()
        }
    }
}
