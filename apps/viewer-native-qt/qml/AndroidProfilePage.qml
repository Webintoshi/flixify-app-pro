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

    component StatCard: Rectangle {
        property string label: ""
        property string value: ""
        radius: 24
        color: root.surfaceColor
        border.width: 1
        border.color: "#1f2c3e"

        Column {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 10

            Text {
                text: parent.parent.label
                color: root.textMuted
                font.pixelSize: 13
                font.bold: true
            }

            Text {
                text: parent.parent.value
                width: parent.width
                wrapMode: Text.WordWrap
                color: root.textPrimary
                font.pixelSize: 22
                font.bold: true
            }
        }
    }

    component ActionCard: Button {
        id: actionCard
        property string title: ""
        property string copy: ""
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 168

        background: Rectangle {
            radius: 24
            color: root.surfaceColor
            border.width: 1
            border.color: actionCard.activeFocus ? "#44ff2432" : "#1f2c3e"
        }

        contentItem: Column {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 14

            Text {
                text: actionCard.title
                color: root.textPrimary
                font.pixelSize: 24
                font.bold: true
            }

            Text {
                text: actionCard.copy
                width: parent.width
                wrapMode: Text.WordWrap
                color: root.textMuted
                font.pixelSize: 14
            }

            Item { width: 1; height: 4 }

            Row {
                spacing: 10

                Rectangle {
                    width: 38
                    height: 38
                    radius: 19
                    color: "#1d2430"

                    Canvas {
                        anchors.centerIn: parent
                        width: 16
                        height: 16
                        onPaint: {
                            const ctx = getContext("2d")
                            ctx.reset()
                            ctx.strokeStyle = "#ffffff"
                            ctx.lineWidth = 2.2
                            ctx.lineCap = "round"
                            ctx.lineJoin = "round"
                            ctx.beginPath()
                            ctx.moveTo(3, height * 0.25)
                            ctx.lineTo(width - 3, height * 0.5)
                            ctx.lineTo(3, height * 0.75)
                            ctx.stroke()
                        }
                    }
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Sayfayı Aç"
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

            Text {
                x: 24
                text: "Profil"
                color: root.textPrimary
                font.pixelSize: 42
                font.bold: true
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
                        height: 128
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
