import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property var paymentRequests: []
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"

    signal backRequested()

    component BackButton: Button {
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitWidth: 52
        implicitHeight: 52
        background: Rectangle {
            radius: 26
            color: "#131923"
            border.width: 1
            border.color: parent.activeFocus ? "#44ff2432" : "#2a3140"
        }
        contentItem: Canvas {
            anchors.fill: parent
            onPaint: {
                const ctx = getContext("2d")
                ctx.reset()
                ctx.strokeStyle = "#ffffff"
                ctx.lineWidth = 2.4
                ctx.lineCap = "round"
                ctx.lineJoin = "round"
                ctx.beginPath()
                ctx.moveTo(width * 0.62, height * 0.25)
                ctx.lineTo(width * 0.38, height * 0.5)
                ctx.lineTo(width * 0.62, height * 0.75)
                ctx.stroke()
            }
        }
        onClicked: root.backRequested()
    }

    ScrollView {
        anchors.fill: parent
        clip: true

        Column {
            width: root.width
            spacing: 20
            topPadding: 24
            bottomPadding: 32

            Row {
                x: 24
                spacing: 14

                BackButton {}

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Ödeme Bildirimleri"
                    color: root.textPrimary
                    font.pixelSize: 42
                    font.bold: true
                }
            }

            Repeater {
                model: root.paymentRequests

                Rectangle {
                    x: 24
                    width: root.width - 48
                    height: 108
                    radius: 24
                    color: root.surfaceColor
                    border.width: 1
                    border.color: "#1f2c3e"

                    Column {
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 6

                        Text {
                            text: modelData.packageTitle || "Ödeme Talebi"
                            color: root.textPrimary
                            font.pixelSize: 22
                            font.bold: true
                        }

                        Text {
                            text: modelData.status || "-"
                            color: root.textMuted
                            font.pixelSize: 14
                        }

                        Text {
                            text: modelData.createdAt || ""
                            color: "#8e98aa"
                            font.pixelSize: 13
                        }
                    }
                }
            }
        }
    }
}
