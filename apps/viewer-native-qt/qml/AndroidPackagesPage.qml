pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls

Item {
    id: root

    property var packages: []
    property bool compactWindow: false
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"

    signal backRequested()
    signal packageSelected(var packageData)

    function packageDurationMonths(packageData) {
        const value = Number(packageData && packageData.durationMonths !== undefined ? packageData.durationMonths : 0)
        return Number.isFinite(value) ? value : 0
    }

    function orderedPackages() {
        const source = root.packages || []
        const output = source.slice(0)
        output.sort((a, b) => packageDurationMonths(a) - packageDurationMonths(b))
        return output
    }

    function packageDisplayTitle(packageData) {
        const months = packageDurationMonths(packageData)
        if (months > 0) {
            return `${months} Aylık`
        }
        const fallback = packageData && packageData.title ? packageData.title.toString().trim() : ""
        return fallback.length ? fallback : "Premium Paket"
    }

    function packageDisplayPrice(packageData) {
        const raw = packageData && packageData.priceLabel ? packageData.priceLabel.toString().trim() : ""
        if (!raw.length) return "-"
        const uppercase = raw.toUpperCase()
        if (raw.indexOf("₺") !== -1 || uppercase.indexOf("TL") !== -1) return raw
        return `${raw} TL`
    }

    function packageFeatureList(packageData) {
        const months = packageDurationMonths(packageData)
        let durationLine = "Premium katalog erişimi"
        if (months === 1) durationLine = "Hızlı başlangıç ve premium katalog erişimi"
        else if (months === 3) durationLine = "Dengeli premium kullanım"
        else if (months === 6) durationLine = "Uzun vadeli konforlu erişim"
        else if (months === 12) durationLine = "Yıllık premium deneyim"

        return [
            durationLine,
            "Film, dizi ve canlı TV içerikleri",
            "Ödeme bildirimi sonrası hızlı aktivasyon",
            "Tema ile uyumlu sade premium erişim"
        ]
    }

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

    component SelectButton: Button {
        id: selectButton
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 54

        background: Rectangle {
            radius: 18
            border.width: 1
            border.color: "#ff2432"
            gradient: Gradient {
                GradientStop { position: 0.0; color: parent.down ? "#ca1825" : "#111111" }
                GradientStop { position: 1.0; color: parent.down ? "#a40f19" : "#000000" }
            }
        }

        contentItem: Text {
            text: selectButton.text
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
            spacing: 24
            topPadding: 24
            bottomPadding: 32

            Row {
                x: 24
                spacing: 14

                BackButton {}

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Premium Paketler"
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

                Repeater {
                    model: root.orderedPackages()

                    Rectangle {
                        width: root.compactWindow ? Math.floor((root.width - 66) / 2) : Math.floor((root.width - 102) / 4)
                        height: 392
                        radius: 26
                        color: root.panelColor
                        border.width: 1
                        border.color: "#1f2c3e"

                        Rectangle {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            height: 5
                            radius: 3
                            gradient: Gradient {
                                GradientStop { position: 0.0; color: "#00ffffff" }
                                GradientStop { position: 0.35; color: "#3ce50914" }
                                GradientStop { position: 1.0; color: "#00ffffff" }
                            }
                        }

                        Column {
                            anchors.fill: parent
                            anchors.margins: 24
                            spacing: 14

                            Text {
                                width: parent.width
                                text: root.packageDisplayTitle(modelData)
                                color: root.textPrimary
                                font.pixelSize: 34
                                font.bold: true
                                font.family: "Space Grotesk"
                                wrapMode: Text.WordWrap
                            }

                            Row {
                                spacing: 8

                                Text {
                                    text: root.packageDisplayPrice(modelData)
                                    color: root.textPrimary
                                    font.pixelSize: 32
                                    font.bold: true
                                    font.family: "Space Grotesk"
                                }

                                Text {
                                    anchors.baseline: parent.children[0].baseline
                                    text: "tek ödeme"
                                    color: "#95a0b3"
                                    font.pixelSize: 13
                                }
                            }

                            Column {
                                width: parent.width
                                spacing: 12

                                Repeater {
                                    model: root.packageFeatureList(modelData)

                                    Row {
                                        id: featureRow
                                        width: parent.width
                                        spacing: 10

                                        Rectangle {
                                            width: 14
                                            height: 14
                                            radius: 7
                                            anchors.verticalCenter: parent.verticalCenter
                                            color: "#2b3443"

                                            Rectangle {
                                                width: 6
                                                height: 6
                                                radius: 3
                                                anchors.centerIn: parent
                                                color: "#ffffff"
                                            }
                                        }

                                        Text {
                                            width: featureRow.width - 24
                                            wrapMode: Text.WordWrap
                                            text: modelData
                                            color: root.textPrimary
                                            font.pixelSize: 14
                                            lineHeight: 1.2
                                        }
                                    }
                                }
                            }

                            Item { width: 1; height: 12 }
                            Rectangle { width: parent.width; height: 1; color: "#14ffffff" }
                            Item { width: 1; height: 6 }

                            SelectButton {
                                width: parent.width
                                text: "Paketi Seç"
                                onClicked: root.packageSelected(modelData)
                            }
                        }
                    }
                }
            }
        }
    }
}
