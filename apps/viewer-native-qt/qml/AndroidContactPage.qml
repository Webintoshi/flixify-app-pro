pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls

Item {
    id: root

    property string whatsappUrl: ""
    property string telegramUrl: ""
    property bool compactWindow: false
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"

    signal backRequested()
    signal openUrl(string url)

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

    component ContactCard: Button {
        id: contactCard
        property string title: ""
        property string copy: ""
        property string iconSource: ""
        property string ctaText: "Bağlantıyı Aç"
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 228

        background: Rectangle {
            radius: 26
            color: root.panelColor
            border.width: 1
            border.color: contactCard.activeFocus ? "#44ff2432" : "#1f2c3e"
        }

        contentItem: Column {
            anchors.fill: parent
            anchors.margins: 22
            spacing: 14

            Rectangle {
                width: 64
                height: 64
                radius: 18
                color: "#0f141d"

                Image {
                    anchors.centerIn: parent
                    width: 38
                    height: 38
                    source: contactCard.iconSource
                    fillMode: Image.PreserveAspectFit
                }
            }

            Text {
                text: contactCard.title
                color: root.textPrimary
                font.pixelSize: 26
                font.bold: true
                font.family: "Space Grotesk"
            }

            Text {
                text: contactCard.copy
                width: parent.width
                wrapMode: Text.WordWrap
                color: root.textMuted
                font.pixelSize: 14
                lineHeight: 1.2
            }

            Item {
                width: 1
                height: Math.max(10, parent.height - 138)
            }

            Rectangle {
                width: 168
                height: 46
                radius: 16
                color: "#10141c"
                border.width: 1
                border.color: contactCard.activeFocus ? root.accentColor : "#2a3140"

                Text {
                    anchors.centerIn: parent
                    text: contactCard.ctaText
                    color: root.textPrimary
                    font.pixelSize: 14
                    font.bold: true
                }
            }
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
                    font.family: "Space Grotesk"
                }
            }

            Flow {
                x: 24
                width: root.width - 48
                spacing: 18

                ContactCard {
                    width: root.compactWindow ? root.width - 48 : Math.floor((root.width - 66) / 2)
                    title: "WhatsApp"
                    copy: "Aktivasyon, paket ve ödeme süreçleri için hızlı yanıt al."
                    iconSource: "qrc:/icons/whatsapp.svg"
                    ctaText: "WhatsApp'a Git"
                    onClicked: root.openUrl(root.whatsappUrl)
                }

                ContactCard {
                    width: root.compactWindow ? root.width - 48 : Math.floor((root.width - 66) / 2)
                    title: "Telegram"
                    copy: "Destek ekibine doğrudan yaz ve detaylı bilgi iste."
                    iconSource: "qrc:/icons/telegram.svg"
                    ctaText: "Telegram'a Git"
                    onClicked: root.openUrl(root.telegramUrl)
                }
            }
        }
    }
}
