import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property var seriesItems: []
    property var seriesGroups: []
    property int seriesTotal: 0
    property string selectedSeriesId: ""
    property string selectedGroup: ""
    property string searchText: ""
    property bool compactWindow: false
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"
    property real shellPadding: 24
    property real sectionSpacing: 20
    property real cardGap: 18
    property real posterCardWidth: 220

    signal searchEdited(string text)
    signal refreshRequested()
    signal clearFiltersRequested()
    signal groupSelected(string group)
    signal seriesSelected(var series)

    function fieldValue(item, key, fallbackValue = null) {
        if (!item || !key || !key.length) {
            return fallbackValue
        }
        const directValue = item[key]
        if (directValue !== undefined && directValue !== null) {
            return directValue
        }
        try {
            if (item.toMap) {
                const mapped = item.toMap()
                const mappedValue = mapped[key]
                if (mappedValue !== undefined && mappedValue !== null) {
                    return mappedValue
                }
            }
        } catch (error) {
        }
        return fallbackValue
    }

    function fieldText(item, key) {
        const value = fieldValue(item, key, "")
        return value === null || value === undefined ? "" : value.toString()
    }

    function fieldNumber(item, key, fallbackValue = 0) {
        const numericValue = Number(fieldValue(item, key, fallbackValue))
        return Number.isFinite(numericValue) ? numericValue : fallbackValue
    }

    function posterUrl(series) {
        if (!series) {
            return ""
        }
        return (series["posterUrl"] || series.posterUrl
            || series["artworkUrl"] || series.artworkUrl
            || series["streamImageUrl"] || series.streamImageUrl
            || series["stream_icon"] || series.stream_icon
            || "").toString()
    }

    function titleText(series) {
        if (!series) {
            return ""
        }
        return (series["title"] || series.title || "").toString()
    }

    function subtitleText(series) {
        if (!series) {
            return "Dizi"
        }
        const seasons = Number(series["seasonCount"] || series.seasonCount || 0)
        const episodes = Number(series["episodeCount"] || series.episodeCount || 0)
        const group = (series["groupTitle"] || series.groupTitle || "").toString()
        if (seasons > 0 || episodes > 0) {
            return `${seasons} sezon | ${episodes} bölüm`
        }
        return group.length ? group : "Dizi"
    }

    function monogram(value) {
        const parts = (value || "").toString().trim().split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < parts.length; index += 1) {
            output += (parts[index][0] || "").toUpperCase()
        }
        return output.length ? output : "FX"
    }

    component PillButton: Button {
        id: pillButton
        property bool secondary: false
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        implicitHeight: 50
        leftPadding: 24
        rightPadding: 24

        background: Rectangle {
            radius: 18
            border.width: 1
            border.color: pillButton.secondary ? "#29384c" : "#ff4553"
            gradient: Gradient {
                GradientStop {
                    position: 0.0
                    color: pillButton.secondary
                           ? (pillButton.down ? "#253244" : "#1b2533")
                           : (pillButton.down ? "#ca1825" : root.accentColor)
                }
                GradientStop {
                    position: 1.0
                    color: pillButton.secondary
                           ? (pillButton.down ? "#18212d" : "#131b27")
                           : (pillButton.down ? "#a90f1b" : "#c91522")
                }
            }

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.42
                radius: parent.radius
                color: pillButton.secondary ? "#12ffffff" : "#26ff9ba3"
            }
        }

        contentItem: Text {
            text: pillButton.text
            color: "#ffffff"
            font.pixelSize: 14
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component SearchField: TextField {
        id: searchField
        implicitHeight: 56
        leftPadding: 52
        rightPadding: 18
        topPadding: 0
        bottomPadding: 0
        verticalAlignment: TextInput.AlignVCenter
        color: root.textPrimary
        placeholderTextColor: "#8f98a8"
        selectionColor: "#55e50914"
        font.pixelSize: 15

        background: Rectangle {
            radius: 18
            color: "#0f141d"
            border.width: 1
            border.color: searchField.activeFocus ? "#4a5f7d" : "#243141"

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.42
                radius: parent.radius
                color: "#12ffffff"
            }

            Canvas {
                anchors.left: parent.left
                anchors.leftMargin: 18
                anchors.verticalCenter: parent.verticalCenter
                width: 18
                height: 18
                onPaint: {
                    const ctx = getContext("2d")
                    ctx.reset()
                    ctx.strokeStyle = "#8f98a8"
                    ctx.lineWidth = 2
                    ctx.lineCap = "round"
                    ctx.beginPath()
                    ctx.arc(width * 0.42, height * 0.42, width * 0.28, 0, Math.PI * 2)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(width * 0.66, height * 0.66)
                    ctx.lineTo(width * 0.9, height * 0.9)
                    ctx.stroke()
                }
            }
        }
    }

    ScrollView {
        anchors.fill: parent
        clip: true

        Column {
            width: Math.max(320, root.width - root.shellPadding * 2)
            x: root.shellPadding
            topPadding: root.compactWindow ? 18 : 22
            bottomPadding: root.compactWindow ? 28 : 34
            spacing: root.sectionSpacing

            Flow {
                width: parent.width
                spacing: 12

                SearchField {
                    width: root.compactWindow ? parent.width : Math.max(340, parent.width - 360)
                    text: root.searchText
                    placeholderText: "Dizi ara..."
                    onTextEdited: root.searchEdited(text)
                }

                PillButton {
                    text: "Yenile"
                    secondary: true
                    implicitWidth: 126
                    onClicked: root.refreshRequested()
                }

                PillButton {
                    text: "Filtreleri Temizle"
                    secondary: true
                    implicitWidth: 170
                    onClicked: root.clearFiltersRequested()
                }
            }

            Flickable {
                width: parent.width
                height: 52
                contentWidth: chipRow.width
                clip: true

                Row {
                    id: chipRow
                    spacing: 10

                    Repeater {
                        model: root.seriesGroups

                        Button {
                            required property var modelData
                            hoverEnabled: true
                            focusPolicy: Qt.NoFocus
                            text: modelData.length ? modelData : "Tüm Diziler"
                            implicitHeight: 42
                            leftPadding: 18
                            rightPadding: 18

                            background: Rectangle {
                                radius: 21
                                border.width: 1
                                border.color: root.selectedGroup === modelData ? root.accentColor : "#1dffffff"
                                color: root.selectedGroup === modelData ? "#22e50914" : "#10161f"
                            }

                            contentItem: Text {
                                text: modelData.length ? modelData : "Tüm Diziler"
                                color: root.selectedGroup === modelData ? root.textPrimary : root.textMuted
                                font.pixelSize: 13
                                font.bold: true
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                            }

                            onClicked: root.groupSelected(modelData)
                        }
                    }
                }
            }

            Flow {
                property int __maxCols: Math.max(1, Math.floor((parent.width + root.cardGap) / (root.posterCardWidth + root.cardGap)))
                property int __actualCols: Math.min(root.seriesItems.length, __maxCols)
                width: __actualCols * root.posterCardWidth + Math.max(0, __actualCols - 1) * root.cardGap
                spacing: root.cardGap
                anchors.horizontalCenter: parent.horizontalCenter

                Repeater {
                    model: root.seriesItems

                    Item {
                        id: seriesCard
                        required property var modelData
                        width: root.posterCardWidth
                        readonly property real posterHeight: Math.round(root.posterCardWidth * 1.48)
                        readonly property string titleValue: root.titleText(modelData)
                        readonly property string subtitleValue: root.subtitleText(modelData)
                        readonly property string posterSource: root.posterUrl(modelData)
                        readonly property string seriesId: ((modelData && (modelData["id"] || modelData.id)) || "").toString()
                        height: posterHeight + 82

                        Rectangle {
                            anchors.fill: parent
                            radius: 24
                            color: root.surfaceColor
                            border.width: 1
                            border.color: root.selectedSeriesId === seriesCard.seriesId
                                          ? root.accentColor
                                          : cardArea.containsMouse ? "#2effffff" : "#18ffffff"
                        }

                        Rectangle {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            height: parent.posterHeight
                            radius: 24
                            clip: true
                            color: "#0a0f16"

                            Image {
                                id: posterImage
                                anchors.fill: parent
                                anchors.margins: 1
                                source: seriesCard.posterSource
                                fillMode: Image.PreserveAspectCrop
                                asynchronous: true
                                cache: true
                                visible: source.toString().length > 0 && status === Image.Ready
                            }

                            Rectangle {
                                anchors.fill: parent
                                visible: !posterImage.visible
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: "#2ce50914" }
                                    GradientStop { position: 0.48; color: "#163364c7" }
                                    GradientStop { position: 1.0; color: "#f0080b11" }
                                }
                            }

                            Rectangle {
                                width: 84
                                height: 84
                                radius: 26
                                anchors.centerIn: parent
                                visible: !posterImage.visible
                                color: "#16ffffff"
                                border.width: 1
                                border.color: "#24ffffff"

                                Text {
                                    anchors.centerIn: parent
                                    text: root.monogram(seriesCard.titleValue)
                                    color: root.textPrimary
                                    font.pixelSize: 28
                                    font.bold: true
                                }
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                height: 100
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: "#0005070b" }
                                    GradientStop { position: 1.0; color: "#ea05070b" }
                                }
                            }

                            Rectangle {
                                width: 64
                                height: 32
                                radius: 16
                                anchors.left: parent.left
                                anchors.top: parent.top
                                anchors.margins: 16
                                color: "#14ffffff"

                                Text {
                                    anchors.centerIn: parent
                                    text: "Dizi"
                                    color: root.textPrimary
                                    font.pixelSize: 12
                                    font.bold: true
                                }
                            }
                        }

                        Column {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            anchors.margins: 14
                            spacing: 4

                            Text {
                                width: parent.width
                                text: seriesCard.titleValue
                                color: root.textPrimary
                                font.pixelSize: 16
                                font.bold: true
                                maximumLineCount: 2
                                wrapMode: Text.WordWrap
                                elide: Text.ElideRight
                            }

                            Text {
                                width: parent.width
                                text: seriesCard.subtitleValue
                                color: root.textMuted
                                font.pixelSize: 12
                                elide: Text.ElideRight
                            }
                        }

                        MouseArea {
                            id: cardArea
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.seriesSelected(modelData)
                        }
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 176
                radius: 28
                color: root.panelColor
                border.width: 1
                border.color: "#16ffffff"
                visible: root.seriesItems.length === 0

                Column {
                    anchors.centerIn: parent
                    spacing: 8

                    Text {
                        text: "Dizi bulunamadı"
                        color: root.textPrimary
                        font.pixelSize: 28
                        font.bold: true
                    }

                    Text {
                        text: "Aramayı veya kategori seçimini değiştirip tekrar deneyin."
                        color: root.textMuted
                        font.pixelSize: 14
                    }
                }
            }
        }
    }
}
