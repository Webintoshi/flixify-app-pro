pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property var userData: ({})
    property string subscriptionLabel: ""
    property bool compactWindow: false
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"

    signal packagesRequested()
    signal paymentsRequested()
    signal contactRequested()

    function safeText(value, fallbackText) {
        const text = (value === null || value === undefined ? "" : value.toString()).trim()
        return text.length ? text : (fallbackText || "")
    }

    component CardFrame: Rectangle {
        radius: 26
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
    }

    component StatCard: CardFrame {
        id: statCard
        property string label: ""
        property string value: ""

        Column {
            anchors.fill: parent
            anchors.margins: 22
            spacing: 12

            Text {
                text: statCard.label
                color: root.textMuted
                font.pixelSize: 13
                font.bold: true
                font.family: "Space Grotesk"
            }

            Text {
                text: statCard.value
                width: parent.width
                wrapMode: Text.WordWrap
                color: root.textPrimary
                font.pixelSize: 22
                font.bold: true
                font.family: "Space Grotesk"
            }
        }
    }

    component ActionCard: Button {
        id: actionCard
        property string title: ""
        property string copy: ""
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 184

        background: CardFrame {
            border.color: actionCard.activeFocus ? "#44ff2432" : "#1f2c3e"
        }

        contentItem: Column {
            anchors.fill: parent
            anchors.margins: 22
            spacing: 14

            Text {
                text: actionCard.title
                color: root.textPrimary
                font.pixelSize: 26
                font.bold: true
                font.family: "Space Grotesk"
            }

            Text {
                text: actionCard.copy
                width: parent.width
                wrapMode: Text.WordWrap
                color: root.textMuted
                font.pixelSize: 14
                lineHeight: 1.2
            }

            Item {
                width: 1
                Layout.fillHeight: true
                height: Math.max(8, parent.height - 118)
            }

            Rectangle {
                width: 176
                height: 46
                radius: 16
                color: "#10141c"
                border.width: 1
                border.color: actionCard.activeFocus ? root.accentColor : "#2a3140"

                Row {
                    anchors.centerIn: parent
                    spacing: 10

                    Canvas {
                        anchors.verticalCenter: parent.verticalCenter
                        width: 18
                        height: 18
                        onPaint: {
                            const ctx = getContext("2d")
                            ctx.reset()
                            ctx.strokeStyle = "#ffffff"
                            ctx.lineWidth = 2
                            ctx.lineCap = "round"
                            ctx.lineJoin = "round"
                            ctx.beginPath()
                            ctx.moveTo(width * 0.18, height * 0.5)
                            ctx.lineTo(width * 0.82, height * 0.5)
                            ctx.moveTo(width * 0.55, height * 0.24)
                            ctx.lineTo(width * 0.82, height * 0.5)
                            ctx.lineTo(width * 0.55, height * 0.76)
                            ctx.stroke()
                        }
                    }

                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "Sayfayı Ziyaret Et"
                        color: root.textPrimary
                        font.pixelSize: 14
                        font.bold: true
                    }
                }
            }
        }
    }

    ScrollView {
        anchors.fill: parent
        clip: true

        Column {
            width: root.width
            spacing: 22
            topPadding: 24
            bottomPadding: 32

            Text {
                x: 24
                text: "Profil"
                color: root.textPrimary
                font.pixelSize: 42
                font.bold: true
                font.family: "Space Grotesk"
            }

            Flow {
                x: 24
                width: root.width - 48
                spacing: 18

                Repeater {
                    model: [
                        {
                            label: "Kullanıcı Kodu",
                            value: root.safeText(root.userData.kryptoniteCode || root.userData.accountCode || root.userData.code, "-")
                        },
                        {
                            label: "Aktif Paket",
                            value: root.safeText(root.userData.activePackage ? root.userData.activePackage.title : "", "Yok")
                        },
                        {
                            label: "Link Durumu",
                            value: root.userData.hasAssignedLink ? "Bağlı" : "Admin ataması bekleniyor"
                        },
                        {
                            label: "Abonelik",
                            value: root.safeText(root.subscriptionLabel, "Yok")
                        }
                    ]

                    StatCard {
                        width: root.compactWindow ? Math.floor((root.width - 66) / 2) : Math.floor((root.width - 84) / 2)
                        height: 134
                        label: modelData.label
                        value: modelData.value
                    }
                }
            }

            Flow {
                x: 24
                width: root.width - 48
                spacing: 18

                ActionCard {
                    width: root.compactWindow ? root.width - 48 : Math.floor((root.width - 84) / 3)
                    title: "Paketler"
                    copy: "Aktif paketleri görüp satın alım talebi oluştur."
                    onClicked: root.packagesRequested()
                }

                ActionCard {
                    width: root.compactWindow ? root.width - 48 : Math.floor((root.width - 84) / 3)
                    title: "Ödemeler"
                    copy: "Ödeme bildirimlerini ve taleplerini takip et."
                    onClicked: root.paymentsRequested()
                }

                ActionCard {
                    width: root.compactWindow ? root.width - 48 : Math.floor((root.width - 84) / 3)
                    title: "İletişim"
                    copy: "Destek ekibine WhatsApp ve Telegram üzerinden ulaş."
                    onClicked: root.contactRequested()
                }
            }
        }
    }
}
