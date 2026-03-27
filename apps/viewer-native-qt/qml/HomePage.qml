import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property var movieItems: []
    property var seriesItems: []
    property var liveItems: []
    property bool compactWindow: false
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"
    property real shellPadding: 24
    property real sectionSpacing: 20
    property real cardGap: 18
    property real cardWidth: 236
    property real cardHeight: 336

    signal movieSelected(var movie)
    signal seriesSelected(var series)
    signal liveSelected(var live)
    signal openMoviesRequested()
    signal openSeriesRequested()
    signal openLiveRequested()

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

    function fieldText(item, key, fallbackValue = "") {
        const value = fieldValue(item, key, fallbackValue)
        return value === null || value === undefined ? "" : value.toString()
    }

    function fieldNumber(item, key, fallbackValue = 0) {
        const numericValue = Number(fieldValue(item, key, fallbackValue))
        return Number.isFinite(numericValue) ? numericValue : fallbackValue
    }

    function itemTitle(item, kind) {
        return fieldText(item, "title") || (kind === "live" ? "Canli TV" : kind === "series" ? "Dizi" : "Film")
    }

    function itemSubtitle(item, kind) {
        if (kind === "series") {
            const seasons = fieldNumber(item, "seasonCount", 0)
            const episodes = fieldNumber(item, "episodeCount", 0)
            if (seasons > 0 || episodes > 0) {
                return `${seasons} sezon | ${episodes} bölüm`
            }
        }
        return fieldText(item, "groupTitle") || (kind === "live" ? "Canli TV" : kind === "series" ? "Dizi" : "Film")
    }

    function itemArtwork(item, kind) {
        if (kind === "live") {
            return fieldText(item, "logoUrl") || fieldText(item, "posterUrl")
        }
        return fieldText(item, "posterUrl")
            || fieldText(item, "artworkUrl")
            || fieldText(item, "streamImageUrl")
            || fieldText(item, "stream_icon")
            || fieldText(item, "logoUrl")
    }

    function itemMonogram(item, kind) {
        const source = itemTitle(item, kind).trim().split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < source.length; index += 1) {
            output += (source[index][0] || "").toUpperCase()
        }
        return output.length ? output : "FX"
    }

    component SectionButton: Button {
        id: sectionButton
        property bool secondary: true
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        implicitHeight: 42
        leftPadding: 18
        rightPadding: 18

        background: Rectangle {
            radius: 16
            border.width: 1
            border.color: sectionButton.secondary ? "#24ffffff" : "transparent"
            color: sectionButton.secondary
                   ? (sectionButton.down ? "#253041" : "#131923")
                   : (sectionButton.down ? "#d71320" : root.accentColor)
        }

        contentItem: Text {
            text: sectionButton.text
            color: "#ffffff"
            font.pixelSize: 13
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component ArrowButton: Button {
        id: arrowButton
        property bool rightSide: false
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        width: 42
        height: 42

        background: Rectangle {
            radius: width / 2
            color: arrowButton.down ? "#2affffff" : "#10ffffff"
            border.width: 1
            border.color: "#24ffffff"
        }

        contentItem: Item {
            Canvas {
                anchors.fill: parent
                onPaint: {
                    const ctx = getContext("2d")
                    ctx.reset()
                    ctx.strokeStyle = "#ffffff"
                    ctx.lineWidth = 2.5
                    ctx.lineCap = "round"
                    ctx.lineJoin = "round"
                    ctx.beginPath()
                    if (arrowButton.rightSide) {
                        ctx.moveTo(width * 0.38, height * 0.28)
                        ctx.lineTo(width * 0.62, height * 0.5)
                        ctx.lineTo(width * 0.38, height * 0.72)
                    } else {
                        ctx.moveTo(width * 0.62, height * 0.28)
                        ctx.lineTo(width * 0.38, height * 0.5)
                        ctx.lineTo(width * 0.62, height * 0.72)
                    }
                    ctx.stroke()
                }
            }
        }
    }

    component HomeCarouselSection: Item {
        id: section
        property string title: ""
        property string kind: "movie"
        property var items: []
        signal activated(var item)
        signal viewAll()

        width: parent ? parent.width : 0
        height: 430
        visible: items.length > 0

        function pageStep() {
            return Math.max(1, Math.floor((carouselView.width - 120) / (root.cardWidth + root.cardGap)))
        }

        function currentIndex() {
            const span = root.cardWidth + root.cardGap
            return span > 0 ? Math.round(carouselView.contentX / span) : 0
        }

        function move(delta) {
            if (!items || !items.length) {
                return
            }
            const target = Math.max(0, Math.min(items.length - 1, currentIndex() + delta))
            carouselView.positionViewAtIndex(target, ListView.Beginning)
        }

        Column {
            anchors.fill: parent
            spacing: 16

            Row {
                width: parent.width
                spacing: 12

                Text {
                    text: section.title
                    color: root.textPrimary
                    font.pixelSize: 28
                    font.bold: true
                }

                Rectangle {
                    width: countText.implicitWidth + 24
                    height: 32
                    radius: 16
                    color: "#12ffffff"
                    anchors.verticalCenter: parent.verticalCenter

                    Text {
                        id: countText
                        anchors.centerIn: parent
                        text: `${section.items.length} içerik`
                        color: root.textMuted
                        font.pixelSize: 12
                        font.bold: true
                    }
                }

                Item {
                    width: 1
                    height: 1
                    Layout.fillWidth: true
                }

                SectionButton {
                    text: "Sayfayı Ziyaret Et"
                    anchors.verticalCenter: parent.verticalCenter
                    onClicked: section.viewAll()
                }
            }

            Item {
                width: parent.width
                height: root.cardHeight

                ListView {
                    id: carouselView
                    anchors.fill: parent
                    anchors.leftMargin: 52
                    anchors.rightMargin: 52
                    orientation: ListView.Horizontal
                    spacing: root.cardGap
                    clip: true
                    model: section.items
                    boundsBehavior: Flickable.StopAtBounds
                    flickDeceleration: 2500
                    maximumFlickVelocity: 6000

                    delegate: Item {
                        id: card
                        required property var modelData
                        width: root.cardWidth
                        height: root.cardHeight

                        Rectangle {
                            anchors.fill: parent
                            radius: 26
                            color: root.surfaceColor
                            border.width: 1
                            border.color: "#18ffffff"
                        }

                        Rectangle {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            height: parent.height - 74
                            radius: 26
                            color: "#090d15"
                            clip: true

                            Image {
                                id: artworkImage
                                anchors.fill: parent
                                anchors.margins: 1
                                source: root.itemArtwork(modelData, section.kind)
                                fillMode: section.kind === "live" ? Image.PreserveAspectFit : Image.PreserveAspectCrop
                                asynchronous: true
                                cache: true
                                visible: source.toString().length > 0 && status === Image.Ready
                            }

                            Rectangle {
                                anchors.fill: parent
                                visible: !artworkImage.visible
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: "#2ce50914" }
                                    GradientStop { position: 0.45; color: "#163364c7" }
                                    GradientStop { position: 1.0; color: "#f0080b11" }
                                }
                            }

                            Rectangle {
                                width: 84
                                height: 84
                                radius: 24
                                anchors.centerIn: parent
                                visible: !artworkImage.visible
                                color: "#16ffffff"
                                border.width: 1
                                border.color: "#24ffffff"

                                Text {
                                    anchors.centerIn: parent
                                    text: root.itemMonogram(modelData, section.kind)
                                    color: root.textPrimary
                                    font.pixelSize: 28
                                    font.bold: true
                                }
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                height: 88
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: "#0005070b" }
                                    GradientStop { position: 1.0; color: "#ea05070b" }
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
                                text: root.itemTitle(modelData, section.kind)
                                width: parent.width
                                wrapMode: Text.WordWrap
                                maximumLineCount: 2
                                elide: Text.ElideRight
                                color: root.textPrimary
                                font.pixelSize: 16
                                font.bold: true
                            }

                            Text {
                                text: root.itemSubtitle(modelData, section.kind)
                                width: parent.width
                                maximumLineCount: 1
                                elide: Text.ElideRight
                                color: root.textMuted
                                font.pixelSize: 12
                                visible: text.length > 0
                            }
                        }

                        MouseArea {
                            id: cardMouse
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: section.activated(modelData)
                        }
                    }
                }

                ArrowButton {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    visible: carouselView.contentX > 2
                    onClicked: section.move(-section.pageStep())
                }

                ArrowButton {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    rightSide: true
                    visible: carouselView.contentWidth - carouselView.width - carouselView.contentX > 2
                    onClicked: section.move(section.pageStep())
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

            HomeCarouselSection {
                title: "Filmler"
                kind: "movie"
                items: root.movieItems
                onActivated: function(item) { root.movieSelected(item) }
                onViewAll: root.openMoviesRequested()
            }

            HomeCarouselSection {
                title: "Diziler"
                kind: "series"
                items: root.seriesItems
                onActivated: function(item) { root.seriesSelected(item) }
                onViewAll: root.openSeriesRequested()
            }

            HomeCarouselSection {
                title: "Canli TV"
                kind: "live"
                items: root.liveItems
                onActivated: function(item) { root.liveSelected(item) }
                onViewAll: root.openLiveRequested()
            }
        }
    }
}
