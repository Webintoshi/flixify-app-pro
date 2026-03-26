import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property var movieItems: []
    property var movieGroups: []
    property int movieTotal: 0
    property var currentMovie: null
    property var playbackController: null
    property Component videoSurfaceComponent: null
    property string selectedMovieId: ""
    property string selectedGroup: ""
    property string searchText: ""
    property bool playerVisible: false
    property bool compactWindow: false
    property bool movieLoadingMore: false
    property bool movieHasMore: false
    property bool windowIsFullscreen: false
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
    signal movieSelected(var movie)
    signal loadMoreRequested()
    signal closePlayerRequested()
    signal toggleWindowFullscreenRequested()

    function posterUrl(movie) {
        if (!movie) {
            return ""
        }
        return (movie["posterUrl"] || movie.posterUrl || movie["artworkUrl"] || movie.artworkUrl || movie["streamImageUrl"] || movie.streamImageUrl || movie["stream_icon"] || movie.stream_icon || movie["logoUrl"] || movie.logoUrl || "").toString()
    }

    function movieTitle(movie) {
        if (!movie) {
            return ""
        }
        return movie["title"] || movie.title || ""
    }

    function movieGroup(movie) {
        if (!movie) {
            return ""
        }
        return movie["groupTitle"] || movie.groupTitle || ""
    }

    function monogram(value) {
        const parts = (value || "").toString().trim().split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < parts.length; index += 1) {
            output += (parts[index][0] || "").toUpperCase()
        }
        return output.length ? output : "FX"
    }

    function scrollToPlayer() {
        const flickable = pageScroll.contentItem
        if (!flickable || !playerLoader.active) {
            return
        }
        flickable.contentY = Math.max(0, playerLoader.y - 20)
    }

    onPlayerVisibleChanged: {
        if (playerVisible) {
            Qt.callLater(scrollToPlayer)
        }
    }

    component PillButton: Button {
        id: pillButton
        property bool secondary: false
        hoverEnabled: true
        focusPolicy: Qt.NoFocus
        implicitHeight: 44
        leftPadding: 18
        rightPadding: 18

        background: Rectangle {
            radius: 16
            border.width: pillButton.secondary ? 1 : 0
            border.color: pillButton.secondary ? "#24ffffff" : "transparent"
            color: pillButton.secondary
                   ? (pillButton.down ? "#283243" : pillButton.hovered ? "#212b3b" : "#18212d")
                   : (pillButton.down ? "#d71320" : pillButton.hovered ? "#ef2a37" : root.accentColor)
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

    ScrollView {
        id: pageScroll
        anchors.fill: parent
        clip: true

        Connections {
            target: pageScroll.contentItem ? pageScroll.contentItem : null

            function onContentYChanged() {
                const flickable = pageScroll.contentItem
                if (!flickable || !root.movieHasMore || root.movieLoadingMore) {
                    return
                }
                const contentBottom = flickable.contentY + pageScroll.height
                const totalHeight = flickable.contentHeight || flickable.height || 0
                if (totalHeight > 0 && contentBottom > totalHeight - 360) {
                    root.loadMoreRequested()
                }
            }
        }

        Column {
            id: contentColumn
            width: Math.max(320, root.width - root.shellPadding * 2)
            x: root.shellPadding
            topPadding: root.compactWindow ? 18 : 22
            bottomPadding: root.compactWindow ? 28 : 34
            spacing: root.sectionSpacing

            Rectangle {
                width: parent.width
                height: root.compactWindow ? 170 : 188
                radius: 30
                color: root.panelColor
                border.width: 1
                border.color: "#16ffffff"

                Column {
                    anchors.fill: parent
                    anchors.margins: 22
                    spacing: 12

                    Text {
                        text: "Filmler"
                        color: root.textPrimary
                        font.pixelSize: root.compactWindow ? 34 : 42
                        font.bold: true
                    }

                    Text {
                        width: parent.width * 0.72
                        wrapMode: Text.WordWrap
                        text: "Film sec, player yukarida acilsin. Posterler ve katalog tek hizada, temiz ve ortali kalsin."
                        color: root.textMuted
                        font.pixelSize: 14
                    }

                    Flow {
                        width: parent.width
                        spacing: 10

                        Rectangle {
                            width: movieCountText.implicitWidth + 28
                            height: 36
                            radius: 18
                            color: "#14ffffff"

                            Text {
                                id: movieCountText
                                anchors.centerIn: parent
                                text: `${root.movieTotal > 0 ? root.movieTotal : root.movieItems.length} film`
                                color: root.textPrimary
                                font.pixelSize: 12
                                font.bold: true
                            }
                        }

                        Rectangle {
                            width: groupText.implicitWidth + 28
                            height: 36
                            radius: 18
                            color: "#10161f"
                            border.width: 1
                            border.color: "#1dffffff"

                            Text {
                                id: groupText
                                anchors.centerIn: parent
                                text: root.selectedGroup.length ? root.selectedGroup : "Tum kategoriler"
                                color: root.textMuted
                                font.pixelSize: 12
                                font.bold: true
                            }
                        }

                        Rectangle {
                            width: stageText.implicitWidth + 28
                            height: 36
                            radius: 18
                            color: "#10161f"
                            border.width: 1
                            border.color: "#1dffffff"

                            Text {
                                id: stageText
                                anchors.centerIn: parent
                                text: root.playerVisible ? "Film oynatici aktif" : "Film sec, player yukarida acilsin"
                                color: root.textMuted
                                font.pixelSize: 12
                                font.bold: true
                            }
                        }
                    }
                }
            }

            Flow {
                width: parent.width
                spacing: 12

                TextField {
                    width: root.compactWindow ? parent.width : Math.max(340, parent.width - 360)
                    text: root.searchText
                    placeholderText: "Film ara..."
                    color: root.textPrimary
                    placeholderTextColor: "#8f98a8"
                    selectionColor: "#55e50914"
                    onTextEdited: root.searchEdited(text)

                    background: Rectangle {
                        radius: 16
                        color: "#0dffffff"
                        border.width: 1
                        border.color: parent.activeFocus ? "#40ffffff" : "#1a3140"
                    }
                }

                PillButton {
                    text: "Yenile"
                    secondary: true
                    onClicked: root.refreshRequested()
                }

                PillButton {
                    text: "Filtreleri Temizle"
                    secondary: true
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
                        model: root.movieGroups

                        Button {
                            required property var modelData
                            hoverEnabled: true
                            focusPolicy: Qt.NoFocus
                            text: modelData.length ? modelData : "Tum Filmler"
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
                                text: parent.text
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

            Loader {
                id: playerLoader
                width: parent.width
                active: root.playerVisible
                visible: active
                height: active && item ? item.implicitHeight : 0

                sourceComponent: Component {
                    MoviePlayerShell {
                        width: contentColumn.width
                        controller: root.playbackController
                        movieData: root.currentMovie
                        videoSurfaceComponent: root.videoSurfaceComponent
                        titleText: root.movieTitle(root.currentMovie)
                        subtitleText: root.movieGroup(root.currentMovie) || "Film"
                        artworkUrl: root.posterUrl(root.currentMovie)
                        accentColor: root.accentColor
                        textPrimary: root.textPrimary
                        textMuted: root.textMuted
                        compactWindow: root.compactWindow
                        windowIsFullscreen: root.windowIsFullscreen
                        onCloseRequested: root.closePlayerRequested()
                        onToggleWindowFullscreenRequested: root.toggleWindowFullscreenRequested()
                    }
                }

                onLoaded: Qt.callLater(root.scrollToPlayer)
            }

            Flow {
                property int __maxCols: Math.max(1, Math.floor((parent.width + root.cardGap) / (root.posterCardWidth + root.cardGap)))
                property int __actualCols: Math.min(root.movieItems.length, __maxCols)
                width: __actualCols * root.posterCardWidth + Math.max(0, __actualCols - 1) * root.cardGap
                spacing: root.cardGap
                anchors.horizontalCenter: parent.horizontalCenter

                Repeater {
                    model: root.movieItems

                    Item {
                        id: movieCard
                        required property var modelData
                        width: root.posterCardWidth
                        readonly property real posterHeight: Math.round(root.posterCardWidth * 1.48)
                        readonly property string titleText: root.movieTitle(modelData)
                        readonly property string subtitleText: root.movieGroup(modelData) || "Film"
                        readonly property string posterSource: root.posterUrl(modelData)
                        readonly property string movieId: (modelData && modelData["id"] ? modelData["id"] : "").toString()
                        height: posterHeight + 82

                        Rectangle {
                            anchors.fill: parent
                            radius: 24
                            color: root.surfaceColor
                            border.width: 1
                            border.color: root.selectedMovieId === movieCard.movieId
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
                                source: movieCard.posterSource
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
                                    text: root.monogram(movieCard.titleText)
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
                        }

                        Column {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            anchors.margins: 14
                            spacing: 4

                            Text {
                                width: parent.width
                                text: movieCard.titleText
                                color: root.textPrimary
                                font.pixelSize: 16
                                font.bold: true
                                maximumLineCount: 2
                                wrapMode: Text.WordWrap
                                elide: Text.ElideRight
                            }

                            Text {
                                width: parent.width
                                text: movieCard.subtitleText
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
                            onClicked: root.movieSelected(modelData)
                        }
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 64
                radius: 20
                color: "#0b1018"
                border.width: 1
                border.color: "#16ffffff"
                visible: root.movieLoadingMore

                Row {
                    anchors.centerIn: parent
                    spacing: 12

                    BusyIndicator {
                        running: parent.visible
                    }

                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "Daha fazla film yukleniyor"
                        color: root.textMuted
                        font.pixelSize: 13
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
                visible: !root.movieLoadingMore && root.movieItems.length === 0

                Column {
                    anchors.centerIn: parent
                    spacing: 8

                    Text {
                        text: "Film bulunamadi"
                        color: root.textPrimary
                        font.pixelSize: 28
                        font.bold: true
                    }

                    Text {
                        text: "Aramayi veya kategori secimini degistirip tekrar deneyin."
                        color: root.textMuted
                        font.pixelSize: 14
                    }
                }
            }
        }
    }
}
