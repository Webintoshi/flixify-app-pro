import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property var activeSeries: null
    property var activeEpisode: null
    property var playbackController: null
    property Component videoSurfaceComponent: null
    property bool playerVisible: false
    property bool windowIsFullscreen: false
    property bool compactWindow: false
    property color panelColor: "#090c13"
    property color surfaceColor: "#131923"
    property color textPrimary: "#f7f8fb"
    property color textMuted: "#b1bac9"
    property color accentColor: "#ff2432"
    property real shellPadding: 24
    property real sectionSpacing: 20

    property int selectedSeasonIndex: 0
    readonly property var seasonsModel: fieldList(activeSeries, "seasons")
    readonly property var selectedSeasonData: seasonsModel.length > 0
                                            ? seasonsModel[Math.max(0, Math.min(selectedSeasonIndex, seasonsModel.length - 1))]
                                            : null
    readonly property var selectedEpisodes: selectedSeasonData ? fieldList(selectedSeasonData, "episodes") : []

    signal playEpisodeRequested(var episode, var series)
    signal closePlayerRequested()
    signal exitDetailRequested()
    signal toggleWindowFullscreenRequested()
    signal retryPlaybackRequested()

    function fieldValue(item, key, fallbackValue) {
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
        return (fieldValue(item, key, "") || "").toString()
    }

    function fieldNumber(item, key, fallbackValue) {
        const numericValue = Number(fieldValue(item, key, fallbackValue))
        return Number.isFinite(numericValue) ? numericValue : fallbackValue
    }

    function fieldList(item, key) {
        const value = fieldValue(item, key, [])
        return value && value.length !== undefined ? value : []
    }

    function posterUrl(series) {
        if (!series) {
            return ""
        }
        return fieldText(series, "posterUrl")
            || fieldText(series, "artworkUrl")
            || fieldText(series, "streamImageUrl")
    }

    function titleText(series) {
        if (!series) {
            return "Dizi seçin"
        }
        return fieldText(series, "title") || "Dizi seçin"
    }

    function monogram(value) {
        const parts = (value || "").toString().trim().split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < parts.length; index += 1) {
            output += (parts[index][0] || "").toUpperCase()
        }
        return output.length ? output : "DZ"
    }

    function episodeKey(item) {
        return `${fieldText(item, "id")}|${fieldNumber(item, "seasonNumber", 0)}|${fieldNumber(item, "episodeNumber", 0)}|${fieldText(item, "title")}`
    }

    function seasonLabel(season, index) {
        const seasonNumber = fieldNumber(season, "seasonNumber", index + 1)
        return `${seasonNumber}. Sezon`
    }

    function episodeLabel(episode, index) {
        const episodeNumber = fieldNumber(episode, "episodeNumber", index + 1)
        return `Bölüm ${episodeNumber}`
    }

    function episodeAllowed(episode) {
        return Boolean(fieldValue(episode, "playbackAllowed", false))
    }

    function episodeSelected(episode) {
        if (!activeEpisode || !episode) {
            return false
        }
        return episodeKey(activeEpisode) === episodeKey(episode)
    }

    function syncSeasonSelection() {
        const seasons = fieldList(activeSeries, "seasons")
        if (!seasons.length) {
            selectedSeasonIndex = 0
            return
        }

        const activeSeasonNumber = fieldNumber(activeEpisode, "seasonNumber", -1)
        if (activeSeasonNumber > 0) {
            for (let index = 0; index < seasons.length; index += 1) {
                if (fieldNumber(seasons[index], "seasonNumber", index + 1) === activeSeasonNumber) {
                    selectedSeasonIndex = index
                    return
                }
            }
        }

        selectedSeasonIndex = Math.max(0, Math.min(selectedSeasonIndex, seasons.length - 1))
    }

    onActiveSeriesChanged: syncSeasonSelection()
    onActiveEpisodeChanged: syncSeasonSelection()
    Component.onCompleted: syncSeasonSelection()

    component PillButton: Button {
        id: pillButton
        property bool selected: false
        property bool compact: false
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        implicitHeight: compact ? 40 : 46
        leftPadding: compact ? 16 : 18
        rightPadding: compact ? 16 : 18

        background: Rectangle {
            radius: compact ? 14 : 16
            border.width: 1
            border.color: pillButton.selected ? "#52ffffff" : "#24ffffff"
            color: !pillButton.enabled ? "#0d1118"
                 : pillButton.selected ? root.accentColor
                 : (pillButton.down ? "#1d2836" : root.surfaceColor)
        }

        contentItem: Text {
            text: pillButton.text
            color: pillButton.enabled ? "#ffffff" : "#5f6878"
            font.pixelSize: pillButton.compact ? 13 : 14
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component CloseIconButton: Button {
        id: closeButton
        implicitWidth: 52
        implicitHeight: 52
        hoverEnabled: false
        focusPolicy: Qt.NoFocus

        background: Rectangle {
            radius: width / 2
            color: closeButton.down ? "#1affffff" : "#10ffffff"
            border.width: 1
            border.color: "#2effffff"
        }

        contentItem: Text {
            text: "X"
            color: root.textPrimary
            font.pixelSize: 22
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    ScrollView {
        anchors.fill: parent
        clip: true
        visible: !root.playerVisible
        enabled: visible

        Column {
            width: Math.max(320, root.width - root.shellPadding * 2)
            x: root.shellPadding
            topPadding: root.compactWindow ? 18 : 22
            bottomPadding: root.compactWindow ? 28 : 34
            spacing: root.sectionSpacing

            Rectangle {
                width: parent.width
                height: root.compactWindow ? 320 : 340
                radius: 30
                color: root.panelColor
                border.width: 1
                border.color: "#16ffffff"
                visible: root.activeSeries !== null

                Row {
                    anchors.fill: parent
                    anchors.margins: 22
                    spacing: 22

                    Rectangle {
                        width: root.compactWindow ? 180 : 220
                        height: parent.height - 44
                        radius: 24
                        color: "#0a0f16"
                        clip: true

                        Image {
                            id: posterImage
                            anchors.fill: parent
                            anchors.margins: 1
                            source: root.posterUrl(root.activeSeries)
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
                            width: 92
                            height: 92
                            radius: 28
                            anchors.centerIn: parent
                            visible: !posterImage.visible
                            color: "#16ffffff"
                            border.width: 1
                            border.color: "#24ffffff"

                            Text {
                                anchors.centerIn: parent
                                text: root.monogram(root.titleText(root.activeSeries))
                                color: root.textPrimary
                                font.pixelSize: 30
                                font.bold: true
                            }
                        }
                    }

                    Item {
                        width: parent.width - (root.compactWindow ? 180 : 220) - 44
                        height: parent.height - 44

                        Text {
                            id: seriesTitle
                            width: parent.width - 96
                            anchors.left: parent.left
                            anchors.top: parent.top
                            text: root.titleText(root.activeSeries)
                            color: root.textPrimary
                            font.pixelSize: root.compactWindow ? 32 : 42
                            font.bold: true
                            wrapMode: Text.WordWrap
                        }

                        CloseIconButton {
                            anchors.top: parent.top
                            anchors.right: parent.right
                            onClicked: root.exitDetailRequested()
                        }

                        Flow {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: seriesTitle.bottom
                            anchors.topMargin: 28
                            spacing: 12
                            visible: root.seasonsModel.length > 0

                            Repeater {
                                model: root.seasonsModel

                                PillButton {
                                    text: root.seasonLabel(modelData, index)
                                    selected: index === root.selectedSeasonIndex
                                    compact: true
                                    onClicked: root.selectedSeasonIndex = index
                                }
                            }
                        }
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 82
                radius: 24
                color: root.panelColor
                border.width: 1
                border.color: "#16ffffff"
                visible: root.playbackController && root.playbackController.lastError.length > 0

                Row {
                    anchors.fill: parent
                    anchors.margins: 18
                    spacing: 14

                    Rectangle {
                        width: 44
                        height: 44
                        radius: 22
                        color: "#26e50914"

                        Text {
                            anchors.centerIn: parent
                            text: "!"
                            color: root.textPrimary
                            font.pixelSize: 22
                            font.bold: true
                        }
                    }

                    Text {
                        width: parent.width - 230
                        anchors.verticalCenter: parent.verticalCenter
                        wrapMode: Text.WordWrap
                        text: root.playbackController ? root.playbackController.lastError : ""
                        color: "#ffb2b8"
                        font.pixelSize: 14
                    }

                    PillButton {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "Tekrar Dene"
                        compact: true
                        onClicked: root.retryPlaybackRequested()
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: episodeContent.implicitHeight + 36
                radius: 26
                color: root.panelColor
                border.width: 1
                border.color: "#14ffffff"
                visible: root.activeSeries !== null

                Column {
                    id: episodeContent
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 18
                    spacing: 14

                    Text {
                        text: root.selectedSeasonData ? root.seasonLabel(root.selectedSeasonData, root.selectedSeasonIndex) : "Bölümler"
                        color: root.textPrimary
                        font.pixelSize: 24
                        font.bold: true
                    }

                    Flow {
                        width: parent.width
                        spacing: 12
                        visible: root.selectedEpisodes.length > 0

                        Repeater {
                            model: root.selectedEpisodes

                            PillButton {
                                text: root.episodeLabel(modelData, index)
                                selected: root.episodeSelected(modelData)
                                enabled: root.episodeAllowed(modelData)
                                onClicked: {
                                    root.activeEpisode = modelData
                                    root.playEpisodeRequested(modelData, root.activeSeries)
                                }
                            }
                        }
                    }

                    Text {
                        visible: root.selectedEpisodes.length === 0
                        text: "Bu sezon için gösterilecek bölüm bulunamadı."
                        color: root.textMuted
                        font.pixelSize: 14
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 180
                radius: 28
                color: root.panelColor
                border.width: 1
                border.color: "#16ffffff"
                visible: root.activeSeries === null

                Column {
                    anchors.centerIn: parent
                    spacing: 8

                    Text {
                        text: "Dizi seçin"
                        color: root.textPrimary
                        font.pixelSize: 28
                        font.bold: true
                    }

                    Text {
                        text: "Bir dizi seçildiğinde sezonlar ve bölümler burada listelenir."
                        color: root.textMuted
                        font.pixelSize: 14
                    }
                }
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        visible: root.playerVisible
        color: "#05070b"
        z: 20

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#f4060910" }
                GradientStop { position: 0.48; color: "#f205070b" }
                GradientStop { position: 1.0; color: "#fa040608" }
            }
        }

        Loader {
            anchors.fill: parent
            active: root.playerVisible
            visible: active

            sourceComponent: Component {
                MoviePlayerShell {
                    width: root.width
                    height: root.height
                    controller: root.playbackController
                    movieData: root.activeEpisode
                    contentKind: "episode"
                    videoSurfaceComponent: root.videoSurfaceComponent
                    titleText: root.activeEpisode ? (root.fieldText(root.activeEpisode, "title") || "Bölüm") : "Bölüm"
                    subtitleText: root.titleText(root.activeSeries)
                    artworkUrl: root.posterUrl(root.activeSeries)
                    textPrimary: root.textPrimary
                    textMuted: root.textMuted
                    compactWindow: root.compactWindow
                    windowIsFullscreen: root.windowIsFullscreen
                    onCloseRequested: root.closePlayerRequested()
                    onToggleWindowFullscreenRequested: root.toggleWindowFullscreenRequested()
                }
            }
        }
    }
}
