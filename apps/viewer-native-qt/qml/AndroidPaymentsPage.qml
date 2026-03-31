pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls

Item {
    id: root

    property var paymentRequests: []
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"

    signal backRequested()

    component BackButton: Button {
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitWidth: 52
        implicitHeight: 52

        background: Rectangle {
            radius: 26
            color: root.surfaceColor
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
                    font.family: "Space Grotesk"
                }
            }

            Rectangle {
                x: 24
                width: root.width - 48
                height: 168
                visible: root.paymentRequests.length === 0
                radius: 26
                color: root.panelColor
                border.width: 1
                border.color: "#1f2c3e"

                Column {
                    anchors.centerIn: parent
                    spacing: 8

                    Text {
                        text: "Henüz ödeme bildirimi yok"
                        color: root.textPrimary
                        font.pixelSize: 28
                        font.bold: true
                        font.family: "Space Grotesk"
                    }

                    Text {
                        text: "Gönderilen ödeme talepleri burada listelenecek."
                        color: root.textMuted
                        font.pixelSize: 14
                    }
                }
            }

            Repeater {
                model: root.paymentRequests

                Rectangle {
                    x: 24
                    width: root.width - 48
                    height: 126
                    radius: 24
                    color: root.panelColor
                    border.width: 1
                    border.color: "#1f2c3e"

                    Rectangle {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        height: 4
                        radius: 2
                        gradient: Gradient {
                            GradientStop { position: 0.0; color: "#00ffffff" }
                            GradientStop { position: 0.35; color: "#40ff2432" }
                            GradientStop { position: 1.0; color: "#00ffffff" }
                        }
                    }

                    Row {
                        anchors.fill: parent
                        anchors.margins: 20
                        spacing: 18

                        Column {
                            width: parent.width - 188
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 8

                            Text {
                                text: modelData.packageTitle || "Ödeme Talebi"
                                width: parent.width
                                elide: Text.ElideRight
                                color: root.textPrimary
                                font.pixelSize: 24
                                font.bold: true
                                font.family: "Space Grotesk"
                            }

                            Text {
                                text: modelData.createdAt || ""
                                color: "#8e98aa"
                                font.pixelSize: 13
                            }
                        }

                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            width: 150
                            height: 40
                            radius: 20
                            color: "#131923"
                            border.width: 1
                            border.color: "#2a3140"

                            Text {
                                anchors.centerIn: parent
                                text: modelData.status || "-"
                                color: root.textPrimary
                                font.pixelSize: 13
                                font.bold: true
                            }
                        }
                    }
                }
            }
        }
    }
}
