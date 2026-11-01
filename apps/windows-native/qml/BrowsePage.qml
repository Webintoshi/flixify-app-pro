import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: page
    objectName: "browsePage"
    signal inspect(var media)
    signal posterFocused
    property bool filtered: repository.query.length > 0 || repository.category.length > 0 || repository.country.length > 0
    property bool liveRoute: repository.route === "live"
    property bool archive: filtered || repository.route !== "home"
    property var featured: repository.hero || ({})
    property string resetKey: [repository.route, repository.query, repository.category, repository.country, repository.scope].join("|")
    property bool pendingReset: true
    onVisibleChanged: if (visible) resetPosition()
    onResetKeyChanged: {
        page.resetPosition();
        filters.close();
    }
    property string routeTitle: ({
            home: "Ana Sayfa",
            live: "Canlı TV",
            movies: "Filmler",
            series: "Diziler",
            favorites: "Favoriler",
            search: "Arama"
        })[repository.route] || "İçerikler"
    function resetPosition() {
        pendingReset = true;
        resetTimer.restart();
    }
    Timer {
        id: resetTimer
        interval: 100
        onTriggered: {
            if (page.pendingReset && page.visible && page.height > 0 && repository.authenticated && !repository.busy) {
                grid.positionViewAtBeginning();
                if (grid.headerItem)
                    grid.contentY = grid.headerItem.y;
                page.pendingReset = false;
            }
        }
    }
    Connections {
        target: repository
        function onStateChanged() {
            if (page.pendingReset)
                resetTimer.restart();
        }
    }
    function selectedTitle(values, value, fallback) {
        for (let i = 0; i < values.length; ++i)
            if (values[i].id === value)
                return values[i].title;
        return fallback;
    }
    GridView {
        id: grid
        objectName: "catalogGrid"
        anchors.fill: parent
        anchors.leftMargin: 30
        anchors.rightMargin: 20
        clip: true
        cellWidth: width / Math.max(1, Math.floor(width / (page.liveRoute ? 220 : 165)))
        cellHeight: page.liveRoute ? (cellWidth - 18) * 0.56 + 89 : (cellWidth - 18) * 1.48 + 89
        model: page.archive ? repository.items : []
        cacheBuffer: Math.max(0, height)
        reuseItems: true
        keyNavigationEnabled: true
        boundsBehavior: Flickable.StopAtBounds
        ScrollBar.vertical: ScrollBar {
            policy: ScrollBar.AsNeeded
        }
        onContentYChanged: if (page.archive && contentY + height > contentHeight - height && repository.hasMore && !repository.loadingMore)
            repository.loadMore()
        header: Column {
            onHeightChanged: if (page.pendingReset)
                resetTimer.restart()
            width: grid.width - 10
            spacing: 26
            topPadding: 24
            bottomPadding: 26
            RowLayout {
                width: parent.width
                spacing: 12
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Text {
                        objectName: "routeHeading"
                        text: page.routeTitle
                        color: "#F5F6F8"
                        font.pixelSize: 31
                        font.weight: Font.Bold
                        Accessible.role: Accessible.Heading
                    }
                    Text {
                        visible: page.filtered
                        text: "Arama ve filtre sonuçları"
                        color: "#A7B0BE"
                        font.pixelSize: 12
                    }
                }
                ActionButton {
                    objectName: "categoryAction"
                    text: repository.category ? page.selectedTitle(repository.categories, repository.category, "Kategori") : "Kategoriler"
                    symbol: "☷"
                    Layout.maximumWidth: 200
                    selected: !!repository.category || !!repository.country
                    onClicked: filters.open()
                }
                ActionButton {
                    symbol: "↻"
                    accessibleLabel: "İçerikleri yenile"
                    enabled: !repository.busy
                    onClicked: repository.refresh()
                }
            }
            RowLayout {
                width: parent.width
                visible: page.filtered
                spacing: 10
                Text {
                    text: (repository.query ? '“' + repository.query + '”' : "") + (repository.country ? " · " + page.selectedTitle(repository.countries, repository.country, "Ülke") : "")
                    color: "#A7B0BE"
                    font.pixelSize: 13
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
                ActionButton {
                    text: "Filtreleri temizle"
                    quiet: true
                    onClicked: {
                        repository.setQuery("");
                        repository.setCategory("");
                        repository.setCountry("");
                    }
                }
            }
            Rectangle {
                width: parent.width
                height: errorRow.implicitHeight + 28
                color: "#181E27"
                radius: 10
                visible: repository.error.length > 0
                RowLayout {
                    id: errorRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.margins: 14
                    Text {
                        text: repository.error
                        color: "#F5F6F8"
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                    ActionButton {
                        text: "Tekrar dene"
                        onClicked: repository.refresh()
                    }
                }
            }
            Item {
                id: hero
                objectName: "catalogHero"
                width: parent.width
                height: visible ? 350 : 0
                visible: !page.filtered && (repository.route === "home" || repository.route === "movies") && !!page.featured.id
                clip: true
                Image {
                    anchors.fill: parent
                    source: page.featured.artworkURL || ""
                    asynchronous: true
                    fillMode: Image.PreserveAspectCrop
                    sourceSize.width: 1200
                    opacity: 0.7
                }
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop {
                            position: 0
                            color: "#07090C"
                        }
                        GradientStop {
                            position: 0.36
                            color: "#F007090C"
                        }
                        GradientStop {
                            position: 0.78
                            color: "#5007090C"
                        }
                        GradientStop {
                            position: 1
                            color: "#1807090C"
                        }
                    }
                }
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop {
                            position: 0.55
                            color: "transparent"
                        }
                        GradientStop {
                            position: 1
                            color: "#07090C"
                        }
                    }
                }
                Column {
                    x: 24
                    anchors.verticalCenter: parent.verticalCenter
                    width: hero.width > 790 ? hero.width * 0.63 : hero.width - 48
                    spacing: 16
                    Text {
                        text: (page.featured.releaseYear > 0 ? page.featured.releaseYear + " · " : "") + (page.featured.kind === "series" ? "Dizi" : "Film")
                        color: "#FF6672"
                        font.pixelSize: 13
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: page.featured.title || ""
                        color: "#F5F6F8"
                        font.pixelSize: hero.width < 800 ? 34 : 43
                        font.weight: Font.Bold
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        lineHeight: 1.06
                    }
                    Text {
                        width: parent.width
                        visible: !!page.featured.description
                        text: page.featured.description || ""
                        color: "#CFD4DD"
                        font.pixelSize: 14
                        wrapMode: Text.WordWrap
                        maximumLineCount: 3
                        elide: Text.ElideRight
                        lineHeight: 1.2
                    }
                    Row {
                        spacing: 12
                        ActionButton {
                            text: "İzle"
                            symbol: "▶"
                            prominent: true
                            width: 110
                            onClicked: repository.playItem(page.featured)
                        }
                        ActionButton {
                            text: page.featured.kind === "series" ? "Bölümler" : "İncele"
                            onClicked: page.inspect(page.featured)
                        }
                        ActionButton {
                            symbol: {
                                repository.libraryRevision;
                                return page.featured.id && repository.isFavorite(page.featured) ? "♥" : "♡";
                            }
                            accessibleLabel: "Favorileri değiştir"
                            onClicked: repository.toggleFavorite(page.featured)
                        }
                    }
                }
                Artwork {
                    visible: hero.width > 790
                    width: 174
                    height: 258
                    anchors.right: parent.right
                    anchors.rightMargin: 28
                    anchors.verticalCenter: parent.verticalCenter
                    source: page.featured.artworkURL || ""
                    title: page.featured.title || ""
                }
            }
            Repeater {
                model: page.filtered || page.liveRoute ? [] : repository.shelves
                delegate: Column {
                    required property var modelData
                    width: grid.width - 10
                    spacing: 16
                    Text {
                        text: modelData.title
                        color: "#F5F6F8"
                        font.pixelSize: 24
                        font.weight: Font.Bold
                        Accessible.role: Accessible.Heading
                    }
                    ListView {
                        width: parent.width
                        height: 304
                        orientation: ListView.Horizontal
                        model: modelData.items
                        spacing: 18
                        clip: true
                        reuseItems: true
                        cacheBuffer: 200
                        boundsBehavior: Flickable.StopAtBounds
                        ScrollBar.horizontal: ScrollBar {}
                        delegate: MediaCard {
                            required property var modelData
                            media: modelData
                            width: 150
                            onInspect: value => page.inspect(value)
                            onFocused: page.posterFocused()
                        }
                    }
                }
            }
            Text {
                visible: page.archive && !page.filtered && !page.liveRoute && repository.items.length > 0
                text: repository.route === "favorites" ? "Tüm favorilerin" : "Tüm içerikler"
                color: "#F5F6F8"
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Column {
                width: parent.width
                spacing: 14
                visible: repository.items.length === 0 && (repository.busy || page.archive || repository.shelves.length === 0)
                topPadding: 55
                bottomPadding: 70
                BusyIndicator {
                    anchors.horizontalCenter: parent.horizontalCenter
                    running: repository.busy
                    visible: running
                    palette.dark: "#FF3545"
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: repository.busy ? "İçerikler yükleniyor…" : repository.route === "favorites" && !page.filtered ? "Listen henüz boş" : "Sonuç bulunamadı"
                    color: "#F5F6F8"
                    font.pixelSize: 21
                    font.weight: Font.DemiBold
                }
                Text {
                    width: Math.min(parent.width - 30, 460)
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: repository.busy ? "Kataloğun hazırlanıyor." : repository.route === "favorites" && !page.filtered ? "Film, dizi ve kanallardaki kalbe basarak favorilerini buraya ekleyebilirsin." : "Başka bir arama veya kategori deneyebilir, listeyi yenileyebilirsin."
                    color: "#A7B0BE"
                    font.pixelSize: 14
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }
        delegate: MediaCard {
            required property var modelData
            width: grid.cellWidth - 18
            media: modelData
            onInspect: value => page.inspect(value)
            onFocused: page.posterFocused()
        }
        footer: Item {
            width: grid.width
            height: repository.loadingMore ? 88 : 32
            BusyIndicator {
                anchors.centerIn: parent
                running: repository.loadingMore
                visible: running
            }
        }
    }
    Popup {
        id: filters
        objectName: "categoryPopup"
        parent: Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(600, parent.width - 48)
        height: Math.min(600, parent.height - 48)
        modal: true
        focus: true
        padding: 24
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        background: Rectangle {
            color: "#13171E"
            radius: 16
            border.color: "#343D4B"
        }
        onOpened: categorySearch.forceActiveFocus()
        ColumnLayout {
            anchors.fill: parent
            spacing: 18
            RowLayout {
                Layout.fillWidth: true
                Text {
                    text: "Kategoriler ve ülkeler"
                    color: "#F5F6F8"
                    font.pixelSize: 24
                    font.weight: Font.Bold
                    Layout.fillWidth: true
                }
                ActionButton {
                    symbol: "×"
                    accessibleLabel: "Filtre panelini kapat"
                    quiet: true
                    onClicked: filters.close()
                }
            }
            TextField {
                id: categorySearch
                Layout.fillWidth: true
                placeholderText: "Kategori ara"
                Accessible.name: "Kategori ara"
                color: "#F5F6F8"
                font.pixelSize: 15
                padding: 14
                background: Rectangle {
                    radius: 8
                    color: "#07090C"
                    border.color: categorySearch.activeFocus ? "#F5F6F8" : "#343D4B"
                }
            }
            SelectBox {
                visible: page.liveRoute || repository.countries.length > 0
                Layout.fillWidth: true
                model: [
                    {
                        id: "",
                        title: "Tüm ülkeler"
                    }
                ].concat(repository.countries)
                textRole: "title"
                valueRole: "id"
                Accessible.name: "Ülke seç"
                currentIndex: {
                    for (let i = 0; i < model.length; i++)
                        if (model[i].id === repository.country)
                            return i;
                    return 0;
                }
                onActivated: repository.setCountry(currentValue)
            }
            ListView {
                objectName: "categoryList"
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                spacing: 4
                reuseItems: true
                model: [
                    {
                        id: "",
                        title: "Tüm kategoriler"
                    }
                ].concat(repository.categories).filter(function (entry) {
                    return !categorySearch.text || entry.title.toLocaleLowerCase("tr-TR").indexOf(categorySearch.text.toLocaleLowerCase("tr-TR")) >= 0;
                })
                ScrollBar.vertical: ScrollBar {}
                delegate: ActionButton {
                    required property var modelData
                    width: ListView.view.width
                    height: 46
                    text: modelData.title
                    selected: repository.category === modelData.id
                    onClicked: {
                        repository.setCategory(modelData.id);
                        filters.close();
                    }
                }
            }
        }
    }
}
