import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property string whatsappUrl: ""
    property string telegramUrl: ""
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"

    signal backRequested()
    signal openUrl(string url)

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

    component ContactButton: Button {
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 58
        background: Rectangle {
            radius: 18
            border.width: 1
            border.color: "#2b3a4f"
            color: "#131923"
        }
        contentItem: Text {
            text: parent.text
            color: "#ffffff"
            font.pixelSize: 16
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
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
                    text: "İletişim"
                    color: root.textPrimary
                    font.pixelSize: 42
                    font.bold: true
                }
            }

            Rectangle {
                x: 24
                width: root.width - 48
                height: 214
                radius: 28
                color: root.surfaceColor
                border.width: 1
                border.color: "#1f2c3e"

                Column {
                    anchors.fill: parent
                    anchors.margins: 24
                    spacing: 14

                    Text {
                        text: "Destek ekibine hızlı ulaş"
                        color: root.textPrimary
                        font.pixelSize: 30
                        font.bold: true
                    }

                    Text {
                        text: "Aktivasyon, paket ve ödeme süreçleri için WhatsApp veya Telegram kullan."
                        width: parent.width
                        wrapMode: Text.WordWrap
                        color: root.textMuted
                        font.pixelSize: 15
                    }

                    Row {
                        spacing: 12

                        ContactButton {
                            width: 180
                            text: "WhatsApp"
                            onClicked: root.openUrl(root.whatsappUrl)
                        }

                        ContactButton {
                            width: 180
                            text: "Telegram"
                            onClicked: root.openUrl(root.telegramUrl)
                        }
                    }
                }
            }
        }
    }
}
