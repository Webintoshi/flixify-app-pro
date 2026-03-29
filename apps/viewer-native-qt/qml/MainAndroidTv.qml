import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

ApplicationWindow {
    id: window

    visible: true
    visibility: Window.FullScreen
    color: "#05070b"
    title: "Flixify Pro"

    readonly property color panelColor: "#090c13"
    readonly property color surfaceColor: "#131923"
    readonly property color textPrimary: "#f7f8fb"
    readonly property color textMuted: "#b1bac9"
    readonly property color accentColor: "#ff2432"
    readonly property bool compactWindow: width < 1280

    property string currentScreen: "login"
    property string authCode: ""
    property string issuedCode: ""
    property string selectedMovieId: ""
    property string selectedSeriesId: ""
    property string selectedLiveId: ""
    property string selectedMovieGroup: ""
    property string selectedSeriesGroup: ""
    property string selectedLiveGroup: "country:TR"
    property string moviesSearchText: ""
    property string seriesSearchText: ""
    property string liveSearchText: ""
    property bool videoFullscreen: false
    property bool movieWindowFullscreen: false
    property bool seriesWindowFullscreen: false
    property var activeEpisodeData: null
    property var pendingPackage: null
    property string selectedPaymentMethodId: ""
    property string selectedCryptoAssetId: ""
    property var homeMoviePreviewCache: []
    property var homeSeriesPreviewCache: []
    property var homeLivePreviewCache: []

    function safeText(value) {
        return (value || "").toString().trim()
    }

    function normalizeText(value) {
        return safeText(value).toLocaleLowerCase()
    }

    function normalizeAsciiText(value) {
        return normalizeText(value)
            .replace(/[ğ]/g, "g")
            .replace(/[ü]/g, "u")
            .replace(/[ş]/g, "s")
            .replace(/[ı]/g, "i")
            .replace(/[ö]/g, "o")
            .replace(/[ç]/g, "c")
    }

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
        return safeText(fieldValue(item, key, ""))
    }

    function userData() {
        if (apiClient.me && apiClient.me.user) {
            return apiClient.me.user
        }
        return ({})
    }

    function contactData() {
        if (apiClient.me && apiClient.me.contact) {
            return apiClient.me.contact
        }
        return {
            whatsapp: apiClient.publicSettings && apiClient.publicSettings.supportWhatsappUrl ? apiClient.publicSettings.supportWhatsappUrl : "",
            telegram: apiClient.publicSettings && apiClient.publicSettings.supportTelegramUrl ? apiClient.publicSettings.supportTelegramUrl : ""
        }
    }

    function signedOutEntryScreen(preferRegister) {
        if (apiClient.authenticated) {
            return "home"
        }
        if (preferRegister && apiClient.consumeInitialRegisterPrompt()) {
            return "register"
        }
        return "login"
    }

    function openSupportUrl(url) {
        const target = safeText(url)
        if (!target.length) {
            return
        }
        if (target.indexOf("wa.me") !== -1 || target.indexOf("whatsapp") !== -1) {
            const separator = target.indexOf("?") === -1 ? "?" : "&"
            Qt.openUrlExternally(target + separator + "text=" + encodeURIComponent("Daha fazla bilgi alabilir miyim?"))
            return
        }
        Qt.openUrlExternally(target)
    }

    function subscriptionLabel() {
        const user = userData()
        const activePackage = fieldValue(user, "activePackage", null)
        if (fieldValue(user, "hasActiveSubscription", false) && activePackage) {
            const title = fieldText(activePackage, "title") || "Paket"
            const remainingDays = Number(fieldValue(activePackage, "remainingDays", 0) || 0)
            return remainingDays > 0 ? `${title} - ${remainingDays} gün` : title
        }
        return "Yok"
    }

    function paymentMethods() {
        const items = apiClient.paymentMethods || []
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            if (fieldValue(items[index], "enabled", true)) {
                output.push(items[index])
            }
        }
        return output
    }

    function selectedPaymentMethod() {
        const items = paymentMethods()
        for (let index = 0; index < items.length; index += 1) {
            if (fieldText(items[index], "id") === selectedPaymentMethodId) {
                return items[index]
            }
        }
        return null
    }

    function closePaymentModal() {
        pendingPackage = null
        selectedPaymentMethodId = ""
        selectedCryptoAssetId = ""
    }

    function selectPaymentMethod(methodId) {
        selectedPaymentMethodId = safeText(methodId)
        if (selectedPaymentMethodId !== "crypto") {
            selectedCryptoAssetId = ""
            return
        }

        const assets = paymentCryptoAssets()
        if (!assets.length) {
            selectedCryptoAssetId = ""
            return
        }

        if (selectedCryptoAssetId.length) {
            for (let index = 0; index < assets.length; index += 1) {
                if (fieldText(assets[index], "id") === selectedCryptoAssetId) {
                    return
                }
            }
        }

        selectedCryptoAssetId = fieldText(assets[0], "id")
    }

    function packageDurationMonths(packageData) {
        const value = Number(fieldValue(packageData, "durationMonths", 0) || 0)
        return Number.isFinite(value) ? value : 0
    }

    function paymentPackageTitle(packageData) {
        const months = packageDurationMonths(packageData)
        if (months > 0) {
            return `${months} Aylık`
        }
        return fieldText(packageData, "title") || "Premium Paket"
    }

    function paymentAmountLabel(packageData) {
        const raw = safeText(fieldValue(packageData, "priceLabel", ""))
        if (!raw.length) return "-"
        const uppercase = raw.toUpperCase()
        if (raw.indexOf("₺") !== -1 || uppercase.indexOf("TL") !== -1) return raw
        return `${raw} TL`
    }

    function paymentAccountCode() {
        const user = userData()
        return fieldText(user, "kryptoniteCode") || fieldText(user, "code") || fieldText(user, "id") || "-"
    }

    function paymentCryptoAssets() {
        const method = selectedPaymentMethod()
        if (!method || fieldText(method, "id") !== "crypto") return []

        const assets = fieldValue(method, "cryptoAssets", [])
        const output = []
        for (let index = 0; index < assets.length; index += 1) {
            if (safeText(fieldValue(assets[index], "walletAddress", "")).length) {
                output.push(assets[index])
            }
        }
        return output
    }

    function selectedCryptoAsset() {
        const assets = paymentCryptoAssets()
        if (!assets.length) return null
        for (let index = 0; index < assets.length; index += 1) {
            if (fieldText(assets[index], "id") === selectedCryptoAssetId) {
                return assets[index]
            }
        }
        return assets[0]
    }

    function paymentCryptoAssetSymbol(asset) {
        const id = fieldText(asset, "id")
        if (id === "usdt-trc20") return "USDT"
        if (id === "tron") return "TRX"
        if (id === "sol") return "SOL"
        if (id === "btc") return "BTC"
        if (id === "usdc") return "USDC"
        return fieldText(asset, "symbol") || "COIN"
    }

    function paymentCryptoAssetLogo(asset) {
        const id = fieldText(asset, "id")
        if (id === "usdt-trc20") return "qrc:/crypto/tether-logo.png"
        if (id === "tron") return "qrc:/crypto/tron-logo.png"
        if (id === "sol") return "qrc:/crypto/sol-logo.png"
        if (id === "btc") return "qrc:/crypto/btc-logo.png"
        if (id === "usdc") return "qrc:/crypto/usdc-logo.png"
        return ""
    }

    function paymentInstructionRows() {
        const method = selectedPaymentMethod()
        if (!method) return []

        if (fieldText(method, "id") === "bank-transfer-eft") {
            const bank = fieldValue(method, "bankTransfer", {})
            const rows = [
                { label: "Hesap Adı", value: safeText(fieldValue(bank, "recipientName", "-")) || "-" },
                { label: "IBAN", value: safeText(fieldValue(bank, "iban", "-")) || "-" },
                { label: "Ödenecek Tutar", value: paymentAmountLabel(pendingPackage) },
                { label: "Kullanıcı Hesap Numarası", value: paymentAccountCode() }
            ]
            const bankName = safeText(fieldValue(bank, "bankName", ""))
            if (bankName.length) {
                rows.splice(1, 0, { label: "Banka", value: bankName })
            }
            return rows
        }

        if (fieldText(method, "id") === "crypto") {
            const asset = selectedCryptoAsset()
            const rows = []
            if (asset && safeText(fieldValue(asset, "walletAddress", "")).length) {
                rows.push({
                    label: `${fieldText(asset, "label") || paymentCryptoAssetSymbol(asset)} Cüzdan Adresi`,
                    value: safeText(fieldValue(asset, "walletAddress", ""))
                })
            }
            rows.push({ label: "Ödenecek Tutar", value: paymentAmountLabel(pendingPackage) })
            rows.push({ label: "Kullanıcı Hesap Numarası", value: paymentAccountCode() })
            return rows
        }

        return []
    }

    function copyPaymentValue(label, value) {
        apiClient.copyText(safeText(value))
    }

    AndroidPlaybackController { id: moviePlaybackController }
    AndroidPlaybackController { id: seriesPlaybackController }
    AndroidPlaybackController { id: livePlaybackController; videoFillMode: videoFullscreen ? "fill" : "fit" }

    Component {
        id: androidVideoSurfaceComponent
        AndroidVideoSurface {}
    }

    component AppButton: Button {
        id: appButton
        property bool secondary: false
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 54
        leftPadding: 22
        rightPadding: 22
        background: Rectangle {
            radius: 16
            border.width: 1
            border.color: appButton.secondary ? "#2b3a4f" : "#ff2432"
            gradient: Gradient {
                GradientStop { position: 0.0; color: appButton.secondary ? (appButton.down ? "#223041" : "#1b2533") : (appButton.down ? "#ca1825" : "#ff2432") }
                GradientStop { position: 1.0; color: appButton.secondary ? (appButton.down ? "#18222d" : "#131b27") : (appButton.down ? "#a40f19" : "#c91522") }
            }
        }
        contentItem: Text {
            text: appButton.text
            color: "#ffffff"
            font.pixelSize: 17
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component NavButton: Button {
        id: navButton
        property bool active: false
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitWidth: 152
        implicitHeight: 56
        background: Rectangle {
            radius: 18
            color: navButton.active ? "#1dffffff" : "#00000000"
        }
        contentItem: Column {
            spacing: 8
            anchors.centerIn: parent
            Text {
                text: navButton.text
                color: "#ffffff"
                font.pixelSize: 17
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
            }
            Rectangle {
                width: 44
                height: 4
                radius: 2
                color: navButton.active ? accentColor : "#00000000"
                anchors.horizontalCenter: parent.horizontalCenter
            }
        }
    }

    function uniqueGroups(items) {
        const seen = {}
        const output = [""]
        for (let index = 0; index < (items || []).length; index += 1) {
            const title = fieldText(items[index], "groupTitle")
            if (!title.length || seen[title]) {
                continue
            }
            seen[title] = true
            output.push(title)
        }
        return output
    }

    function movieGroupOptions() {
        const options = [""]
        const groups = apiClient.movieGroups || []
        for (let index = 0; index < groups.length; index += 1) {
            const title = safeText(groups[index].title)
            if (title.length) {
                options.push(title)
            }
        }
        return options
    }

    function filteredSeriesItems() {
        const normalizedSearch = normalizeAsciiText(seriesSearchText)
        const normalizedGroup = normalizeAsciiText(selectedSeriesGroup)
        const items = apiClient.series || []
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index]
            const title = fieldText(item, "title")
            const groupTitle = fieldText(item, "groupTitle")
            const matchesSearch = !normalizedSearch.length
                || normalizeAsciiText(title).indexOf(normalizedSearch) !== -1
                || normalizeAsciiText(groupTitle).indexOf(normalizedSearch) !== -1
            const matchesGroup = !normalizedGroup.length || normalizeAsciiText(groupTitle) === normalizedGroup
            if (matchesSearch && matchesGroup) {
                output.push(item)
            }
        }
        return output
    }

    function selectedMovie() {
        const items = apiClient.movies || []
        for (let index = 0; index < items.length; index += 1) {
            if (fieldText(items[index], "id") === selectedMovieId) {
                return items[index]
            }
        }
        return null
    }

    function selectedSeries() {
        const items = apiClient.series || []
        for (let index = 0; index < items.length; index += 1) {
            if (fieldText(items[index], "id") === selectedSeriesId) {
                return items[index]
            }
        }
        return null
    }

    function filteredLiveItems() {
        return apiClient.liveChannels || []
    }

    function selectedLiveItem() {
        const items = filteredLiveItems()
        for (let index = 0; index < items.length; index += 1) {
            if (fieldText(items[index], "id") === selectedLiveId) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
    }

    function canonicalLiveGroupTitle(value) {
        const title = safeText(value)
        const normalized = normalizeAsciiText(title)
        if (normalized === "adults +18" || normalized === "xxx adults" || normalized === "xxx:adults") {
            return "Adults"
        }
        return title
    }

    function parseLiveSpecialFamilyFromGroupTitle(title) {
        const normalizedTitle = normalizeAsciiText(canonicalLiveGroupTitle(title))
        if (normalizedTitle === "adults" || normalizedTitle === "adults +18" || normalizedTitle === "xxx:adults") {
            return "ADULTS"
        }
        return null
    }

    function normalizeLiveCountryCode(value) {
        const sanitized = safeText(value).replace(/[^a-z]/gi, "").toUpperCase()
        if (sanitized.length < 2 || sanitized.length > 3) {
            return null
        }
        return sanitized
    }

    function buildLiveCountryFilter(code) {
        const normalizedCode = normalizeLiveCountryCode(code)
        return normalizedCode ? `country:${normalizedCode}` : "country:TR"
    }

    function parseLiveCountryCodeFromFilter(group) {
        const normalized = normalizeAsciiText(group)
        if (normalized === "turkiye") {
            return "TR"
        }
        if (normalized.indexOf("country:") === 0) {
            return normalizeLiveCountryCode(normalized.slice("country:".length))
        }
        return null
    }

    function parseLiveCountryCodeFromGroupPrefix(title) {
        if (parseLiveSpecialFamilyFromGroupTitle(title)) {
            return null
        }
        const match = normalizeAsciiText(canonicalLiveGroupTitle(title)).match(/^([a-z]{2,3})\s*[:\-]/)
        return match && match[1] ? normalizeLiveCountryCode(match[1]) : null
    }

    function parseLiveCountryCodeFromExplicitGroupTitle(title) {
        if (parseLiveSpecialFamilyFromGroupTitle(title)) {
            return null
        }
        const normalizedTitle = normalizeAsciiText(canonicalLiveGroupTitle(title))
        return /^[a-z]{2,3}$/.test(normalizedTitle) ? normalizeLiveCountryCode(normalizedTitle) : null
    }

    function normalizeLiveCountryFamilyKey(value) {
        const normalized = normalizeAsciiText(value).replace(/\s+/g, " ").trim().toUpperCase()
        return normalized.length ? normalized : null
    }

    function buildLiveCountryFamilyFilter(familyKey) {
        const normalizedFamily = normalizeLiveCountryFamilyKey(familyKey)
        return normalizedFamily ? `family:${normalizedFamily}` : ""
    }

    function parseLiveCountryFamilyFromFilter(group) {
        const normalized = normalizeAsciiText(group)
        return normalized.indexOf("family:") === 0 ? normalizeLiveCountryFamilyKey(normalized.slice("family:".length)) : null
    }

    function parseLiveCountryFamilyFromGroupTitle(title) {
        const specialFamily = parseLiveSpecialFamilyFromGroupTitle(title)
        if (specialFamily) {
            return specialFamily
        }
        const normalizedTitle = normalizeLiveCountryFamilyKey(canonicalLiveGroupTitle(title))
        if (!normalizedTitle || parseLiveCountryCodeFromExplicitGroupTitle(title) || parseLiveCountryCodeFromGroupPrefix(title)) {
            return null
        }
        const roots = ["LATIN AMERICA", "ARAB COUNTRIES", "CZECH AND SLOWAK", "EX-YU"]
        for (let index = 0; index < roots.length; index += 1) {
            if (normalizedTitle === roots[index] || normalizedTitle.indexOf(roots[index] + " ") === 0) {
                return roots[index]
            }
        }
        const firstWord = normalizedTitle.split(" ")[0]
        return firstWord.length && !({"VIP": true, "SPORT": true, "ARABIC": true, "KURDISH": true, "7/24": true}[firstWord]) ? firstWord : null
    }

    function normalizedLiveGroupsData() {
        const source = apiClient.liveGroups || []
        const buckets = {}
        const output = []
        for (let index = 0; index < source.length; index += 1) {
            const title = canonicalLiveGroupTitle(source[index] && source[index].title ? source[index].title : "")
            if (!title.length) {
                continue
            }
            const key = normalizeAsciiText(title)
            if (!buckets[key]) {
                buckets[key] = { title: title, count: 0 }
                output.push(buckets[key])
            }
            buckets[key].count += Number(source[index] && source[index].count ? source[index].count : 0)
        }
        return output
    }

    function liveCountryChips() {
        const groups = normalizedLiveGroupsData()
        const buckets = {}
        function pushBucket(type, key, count) {
            const bucketKey = `${type}:${key}`
            if (!buckets[bucketKey]) {
                buckets[bucketKey] = {
                    type: type,
                    key: key,
                    count: 0,
                    filter: type === "code" ? buildLiveCountryFilter(key) : buildLiveCountryFamilyFilter(key),
                    label: type === "code" ? (key === "TR" ? "Türkiye" : key === "XXX" ? "Adults" : key) : (key === "ADULTS" ? "Adults" : key)
                }
            }
            buckets[bucketKey].count += Number(count || 0)
        }
        for (let index = 0; index < groups.length; index += 1) {
            const title = safeText(groups[index].title)
            const explicitCountryCode = parseLiveCountryCodeFromExplicitGroupTitle(title)
            if (explicitCountryCode) {
                pushBucket("code", explicitCountryCode, groups[index].count)
                continue
            }
            const codeFromPrefix = parseLiveCountryCodeFromGroupPrefix(title)
            if (codeFromPrefix) {
                pushBucket("code", codeFromPrefix, groups[index].count)
                continue
            }
            const familyKey = parseLiveCountryFamilyFromGroupTitle(title)
            if (familyKey) {
                pushBucket("family", familyKey, groups[index].count)
            }
        }
        const chips = Object.keys(buckets).map(function(key) { return buckets[key] })
        chips.sort(function(left, right) {
            if (left.type === "code" && left.key === "TR" && (right.type !== "code" || right.key !== "TR")) return -1
            if (right.type === "code" && right.key === "TR" && (left.type !== "code" || left.key !== "TR")) return 1
            if (right.count !== left.count) return right.count - left.count
            return left.label.localeCompare(right.label, "tr-TR")
        })
        return chips
    }

    function liveSubgroupChips() {
        const selectedCountryCode = parseLiveCountryCodeFromFilter(selectedLiveGroup) || parseLiveCountryCodeFromExplicitGroupTitle(selectedLiveGroup) || parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup)
        const selectedCountryFamily = parseLiveCountryFamilyFromFilter(selectedLiveGroup) || parseLiveCountryFamilyFromGroupTitle(selectedLiveGroup)
        if (!selectedCountryCode && !selectedCountryFamily) {
            return []
        }
        const groups = normalizedLiveGroupsData()
        const output = []
        const seen = {}
        for (let index = 0; index < groups.length; index += 1) {
            const title = canonicalLiveGroupTitle(groups[index].title)
            if (!title.length || parseLiveCountryCodeFromExplicitGroupTitle(title)) {
                continue
            }
            const matchesCountry = selectedCountryCode && parseLiveCountryCodeFromGroupPrefix(title) === selectedCountryCode
            const matchesFamily = !matchesCountry && selectedCountryFamily && parseLiveCountryFamilyFromGroupTitle(title) === selectedCountryFamily && normalizeLiveCountryFamilyKey(title) !== selectedCountryFamily
            if ((!matchesCountry && !matchesFamily) || seen[title]) {
                continue
            }
            seen[title] = true
            output.push({ title: title, count: Number(groups[index].count || 0) })
        }
        output.sort(function(left, right) { return Number(right.count || 0) - Number(left.count || 0) || safeText(left.title).localeCompare(safeText(right.title), "tr-TR") })
        return output
    }

    function syncSelectedLiveSelection() {
        const items = filteredLiveItems()
        if (!items.length) {
            selectedLiveId = ""
            return
        }
        for (let index = 0; index < items.length; index += 1) {
            if (fieldText(items[index], "id") === selectedLiveId) {
                return
            }
        }
        selectedLiveId = fieldText(items[0], "id")
    }

    function applyLiveFilters(search, group) {
        liveSearchText = safeText(search)
        selectedLiveGroup = safeText(group).length ? safeText(group) : buildLiveCountryFilter("TR")
        apiClient.fetchLiveCatalog(1, 300, liveSearchText, selectedLiveGroup)
    }

    function applyMovieFilters(search, group) {
        moviesSearchText = safeText(search)
        selectedMovieGroup = safeText(group)
        apiClient.fetchMovieCatalog(1, 120, moviesSearchText, selectedMovieGroup)
    }

    function applySeriesFilters(search, group) {
        seriesSearchText = safeText(search)
        selectedSeriesGroup = safeText(group)
        apiClient.fetchSeriesCatalog(1, 400, seriesSearchText)
    }

    function buildRandomMoviePreview(limit) { return (apiClient.movies || []).slice(0, Math.max(1, Number(limit) || 12)) }
    function buildRandomSeriesPreview(limit) { return filteredSeriesItems().slice(0, Math.max(1, Number(limit) || 12)) }
    function buildRandomLivePreview(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const items = filteredLiveItems().filter(function(item) { return isTurkishLivePreviewItem(item) })
        return items.slice(0, maxItems)
    }
    function refreshHomePreviewContent() {
        homeMoviePreviewCache = buildRandomMoviePreview(12)
        homeSeriesPreviewCache = buildRandomSeriesPreview(12)
        homeLivePreviewCache = buildRandomLivePreview(12)
    }

    function refreshAuthenticatedShellData() {
        apiClient.fetchAllCatalogs("", 300)
        apiClient.fetchPackages()
        apiClient.fetchPaymentMethods()
        apiClient.fetchPaymentRequests()
        apiClient.fetchPublicSettings()
    }

    function isTurkishLivePreviewItem(item) {
        const groupTitle = fieldText(item, "groupTitle")
        return parseLiveCountryCodeFromFilter(groupTitle) === "TR" || parseLiveCountryCodeFromGroupPrefix(groupTitle) === "TR" || normalizeAsciiText(groupTitle).indexOf("turkiye") !== -1
    }

    function playMovie(movie) {
        const movieId = fieldText(movie, "id")
        if (!movieId.length) return
        currentScreen = "movies"
        selectedMovieId = movieId
        moviePlaybackController.playVod("movie", movieId, fieldText(movie, "title"))
    }

    function closeMoviePlayer() {
        movieWindowFullscreen = false
        selectedMovieId = ""
        if (moviePlaybackController.activeContentKind === "movie") {
            moviePlaybackController.stop()
        }
    }

    function playEpisode(episode, series) {
        const episodeId = fieldText(episode, "id")
        if (!episodeId.length) return
        selectedSeriesId = fieldText(series, "id")
        activeEpisodeData = episode
        currentScreen = "series-detail"
        seriesPlaybackController.playVod("episode", episodeId, fieldText(episode, "title") || fieldText(series, "title"))
    }

    function closeSeriesPlayer() {
        seriesWindowFullscreen = false
        activeEpisodeData = null
        if (seriesPlaybackController.activeContentKind === "episode") {
            seriesPlaybackController.stop()
        }
    }

    function playLive(channel, forceRestart) {
        const channelId = fieldText(channel, "id")
        if (!channelId.length) return
        selectedLiveId = channelId
        currentScreen = "live"
        livePlaybackController.videoFillMode = videoFullscreen ? "fill" : "fit"
        const sameChannel = livePlaybackController.activeContentKind === "live" && safeText(livePlaybackController.activeChannelId) === channelId
        if (sameChannel && !forceRestart) {
            return
        }
        livePlaybackController.playChannel(channelId, fieldText(channel, "title"))
    }

    function closeLivePlayer() {
        videoFullscreen = false
        if (livePlaybackController.activeContentKind === "live") {
            livePlaybackController.stop()
        }
    }

    function openScreen(screenName) {
        if (screenName !== "movies") closeMoviePlayer()
        if (screenName !== "series-detail") closeSeriesPlayer()
        if (screenName !== "live") closeLivePlayer()
        currentScreen = screenName
        if (screenName === "home") refreshHomePreviewContent()
        else if (screenName === "live") applyLiveFilters(liveSearchText, selectedLiveGroup)
        else if (screenName === "movies") applyMovieFilters(moviesSearchText, selectedMovieGroup)
        else if (screenName === "series") applySeriesFilters(seriesSearchText, selectedSeriesGroup)
        else if (screenName === "profile") apiClient.fetchMe()
        else if (screenName === "packages") {
            apiClient.fetchPackages()
            apiClient.fetchPaymentMethods()
        } else if (screenName === "payments") {
            apiClient.fetchPaymentRequests()
        } else if (screenName === "contact") {
            apiClient.fetchPublicSettings()
        }
    }

    function toggleLiveFullscreen() {
        videoFullscreen = !videoFullscreen
        livePlaybackController.liveFullscreenActive = videoFullscreen
        livePlaybackController.videoFillMode = videoFullscreen ? "fill" : "fit"
        livePlaybackController.refreshVideoLayout()
    }

    function userCodeText() {
        const user = userData()
        return fieldText(user, "kryptoniteCode") || fieldText(user, "accountCode") || fieldText(user, "code") || "FLIXIFY"
    }

    function registerAnonymousAccount() {
        apiClient.issueAnonCode("Flixify Android TV", "android-tv")
    }

    function submitLogin() {
        const code = safeText(authCode)
        if (!code.length) return
        apiClient.loginByCode(code, "Flixify Android TV", "android-tv")
    }

    function handleBackAction() {
        if (pendingPackage !== null) {
            closePaymentModal()
            return true
        }
        if (movieWindowFullscreen) {
            movieWindowFullscreen = false
            return true
        }
        if (seriesWindowFullscreen) {
            seriesWindowFullscreen = false
            return true
        }
        if (videoFullscreen) {
            toggleLiveFullscreen()
            return true
        }
        if (currentScreen === "series-detail" && activeEpisodeData) {
            closeSeriesPlayer()
            return true
        }
        if (currentScreen === "series-detail") {
            currentScreen = "series"
            return true
        }
        if (currentScreen === "packages" || currentScreen === "payments" || currentScreen === "contact") {
            openScreen("profile")
            return true
        }
        if (currentScreen === "profile") {
            openScreen("home")
            return true
        }
        if (currentScreen === "movies" && selectedMovieId.length) {
            closeMoviePlayer()
            return true
        }
        if (currentScreen === "live" && livePlaybackController.activeContentKind === "live") {
            closeLivePlayer()
            return true
        }
        if (currentScreen !== "home" && currentScreen !== "login" && currentScreen !== "register") {
            openScreen("home")
            return true
        }
        return false
    }

    // __ANDROID_TV_FUNCTIONS__
    Connections {
        target: apiClient

        function onAuthenticatedChanged() {
            if (apiClient.authenticated) {
                currentScreen = "home"
                refreshAuthenticatedShellData()
            } else {
                currentScreen = signedOutEntryScreen(false)
            }
        }

        function onAnonCodeIssued(code) {
            issuedCode = safeText(code)
            authCode = issuedCode
            currentScreen = "register"
            if (issuedCode.length) {
                apiClient.loginByCode(issuedCode, "Flixify Android TV", "android-tv")
            }
        }

        function onLoginSucceeded() {
            currentScreen = "home"
            refreshAuthenticatedShellData()
        }

        function onLogoutCompleted() {
            authCode = ""
            issuedCode = ""
            selectedMovieId = ""
            selectedSeriesId = ""
            selectedLiveId = ""
            selectedMovieGroup = ""
            selectedSeriesGroup = ""
            selectedLiveGroup = buildLiveCountryFilter("TR")
            moviesSearchText = ""
            seriesSearchText = ""
            liveSearchText = ""
            activeEpisodeData = null
            closePaymentModal()
            closeMoviePlayer()
            closeSeriesPlayer()
            closeLivePlayer()
            currentScreen = "login"
        }

        function onMoviesChanged() {
            refreshHomePreviewContent()
        }

        function onSeriesChanged() {
            refreshHomePreviewContent()
        }

        function onLiveChannelsChanged() {
            refreshHomePreviewContent()
            syncSelectedLiveSelection()
            if (currentScreen === "live") {
                liveAutoplayTimer.restart()
            }
        }
    }

    Timer {
        id: liveAutoplayTimer
        interval: 100
        repeat: false
        onTriggered: {
            const item = selectedLiveItem()
            if (item && fieldText(item, "id").length) {
                playLive(item, false)
            }
        }
    }

    Component.onCompleted: {
        currentScreen = signedOutEntryScreen(true)
        refreshHomePreviewContent()
        apiClient.bootstrap()
        apiClient.fetchPublicSettings()
    }

    Keys.onReleased: function(event) {
        if (event.key === Qt.Key_Back || event.key === Qt.Key_Escape) {
            if (handleBackAction()) {
                event.accepted = true
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#05070b"
    }

    component SupportLinkCard: Button {
        id: supportCard
        property string title: ""
        property string subtitle: ""
        property string iconSource: ""
        property string url: ""
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 112
        background: Rectangle {
            radius: 24
            color: surfaceColor
            border.width: 1
            border.color: "#d8d100"
        }
        contentItem: Row {
            anchors.fill: parent
            anchors.margins: 18
            spacing: 14
            Rectangle {
                width: 56
                height: 56
                radius: 18
                color: "#0d121a"
                anchors.verticalCenter: parent.verticalCenter
                Image {
                    anchors.centerIn: parent
                    width: 34
                    height: 34
                    source: supportCard.iconSource
                    fillMode: Image.PreserveAspectFit
                }
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                Text { text: supportCard.title; color: textPrimary; font.pixelSize: 16; font.bold: true }
                Text { text: supportCard.subtitle; color: "#38d86a"; font.pixelSize: 13; font.bold: true }
            }
        }
        onClicked: openSupportUrl(url)
    }

    component AuthCodeBox: Rectangle {
        id: codeBox
        property string displayText: ""
        width: compactWindow ? 72 : 88
        height: compactWindow ? 56 : 64
        radius: 18
        color: "#182334"
        border.width: 1
        border.color: "#273a58"
        Text {
            anchors.centerIn: parent
            text: codeBox.displayText
            color: "#ffffff"
            font.pixelSize: 28
            font.bold: true
            letterSpacing: 2
        }
    }

    component LiveChipButton: Button {
        id: chipButton
        property bool active: false
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 42
        leftPadding: 18
        rightPadding: 18
        background: Rectangle {
            radius: 14
            border.width: 1
            border.color: chipButton.active ? accentColor : "#314155"
            color: chipButton.active ? "#22e50914" : "#0f141d"
        }
        contentItem: Text {
            text: chipButton.text
            color: "#ffffff"
            font.pixelSize: 14
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component LiveChannelCard: Button {
        id: liveChannelCard
        required property var channelData
        property bool active: false
        hoverEnabled: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 86
        leftPadding: 0
        rightPadding: 0
        background: Rectangle {
            radius: 20
            border.width: 1
            border.color: active ? "#ff4553" : "#273344"
            color: active ? accentColor : surfaceColor
        }
        contentItem: Row {
            anchors.fill: parent
            anchors.margins: 14
            spacing: 14
            Rectangle {
                width: 54
                height: 54
                radius: 16
                color: "#0d121a"
                anchors.verticalCenter: parent.verticalCenter
                clip: true
                Image {
                    id: liveLogo
                    anchors.fill: parent
                    anchors.margins: 8
                    source: fieldText(liveChannelCard.channelData, "logoUrl")
                    fillMode: Image.PreserveAspectFit
                    asynchronous: true
                    cache: true
                    visible: source.toString().length > 0 && status === Image.Ready
                }
                Text {
                    anchors.centerIn: parent
                    visible: !liveLogo.visible
                    text: "TV"
                    color: textPrimary
                    font.pixelSize: 18
                    font.bold: true
                }
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                width: parent.width - 68
                Text { text: fieldText(liveChannelCard.channelData, "title"); color: "#ffffff"; font.pixelSize: 17; font.bold: true; elide: Text.ElideRight; width: parent.width }
                Text { text: fieldText(liveChannelCard.channelData, "groupTitle"); color: active ? "#ffe3e5" : textMuted; font.pixelSize: 13; elide: Text.ElideRight; width: parent.width }
            }
        }
    }

    // __ANDROID_TV_CONNECTIONS__
    component AndroidTopBar: Rectangle {
        color: "#05070b"
        height: 90
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 20
            anchors.rightMargin: 20
            spacing: 18
            Row {
                spacing: 12
                Layout.alignment: Qt.AlignVCenter
                Rectangle {
                    width: 48
                    height: 48
                    radius: 12
                    color: accentColor
                    Image {
                        anchors.centerIn: parent
                        width: 30
                        height: 30
                        source: "qrc:/branding/icon.png"
                        fillMode: Image.PreserveAspectFit
                    }
                }
                Text { anchors.verticalCenter: parent.verticalCenter; text: "FLIXIFY"; color: "#ffffff"; font.pixelSize: 30; font.bold: true }
                Rectangle {
                    width: 54
                    height: 30
                    radius: 14
                    color: accentColor
                    anchors.verticalCenter: parent.verticalCenter
                    Text { anchors.centerIn: parent; text: "PRO"; color: "#ffffff"; font.pixelSize: 13; font.bold: true }
                }
            }
            Item { Layout.fillWidth: true }
            Row {
                spacing: 8
                Layout.alignment: Qt.AlignVCenter
                NavButton { text: "Canlı TV"; active: currentScreen === "live"; onClicked: openScreen("live") }
                NavButton { text: "Film"; active: currentScreen === "movies"; onClicked: openScreen("movies") }
                NavButton { text: "Dizi"; active: currentScreen === "series" || currentScreen === "series-detail"; onClicked: openScreen("series") }
            }
            Item { Layout.fillWidth: true }
            Row {
                spacing: 12
                Layout.alignment: Qt.AlignVCenter
                Rectangle {
                    width: compactWindow ? 240 : 280
                    height: 56
                    radius: 14
                    color: "#0f141d"
                    border.width: 1
                    border.color: "#233243"
                    Row {
                        anchors.fill: parent
                        anchors.margins: 12
                        spacing: 12
                        Rectangle {
                            width: 36
                            height: 36
                            radius: 10
                            color: "#1d2430"
                            anchors.verticalCenter: parent.verticalCenter
                            Text { anchors.centerIn: parent; text: "•"; color: "#ffffff"; font.pixelSize: 24; font.bold: true }
                        }
                        Text { anchors.verticalCenter: parent.verticalCenter; text: userCodeText(); color: "#ffffff"; font.pixelSize: 17; font.bold: true }
                        Button {
                            anchors.fill: parent
                            hoverEnabled: false
                            focusPolicy: Qt.StrongFocus
                            opacity: 0.0
                            onClicked: openScreen("profile")
                        }
                    }
                }
                AppButton { text: "Çıkış"; onClicked: apiClient.logout() }
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        AndroidTopBar {
            Layout.fillWidth: true
            visible: apiClient.authenticated && !movieWindowFullscreen && !seriesWindowFullscreen && !videoFullscreen
        }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            StackLayout {
                anchors.fill: parent
                currentIndex: currentScreen === "register" ? 0
                              : currentScreen === "login" ? 1
                              : currentScreen === "home" ? 2
                              : currentScreen === "live" ? 3
                              : currentScreen === "movies" ? 4
                              : currentScreen === "series" ? 5
                              : currentScreen === "series-detail" ? 6
                              : currentScreen === "profile" ? 7
                              : currentScreen === "packages" ? 8
                              : currentScreen === "payments" ? 9
                              : currentScreen === "contact" ? 10
                              : 2

                Item {
                    Rectangle {
                        anchors.centerIn: parent
                        width: compactWindow ? 700 : 760
                        height: compactWindow ? 620 : 680
                        radius: 28
                        color: panelColor
                        border.width: 1
                        border.color: "#162130"
                        Column {
                            anchors.fill: parent
                            anchors.margins: 28
                            spacing: 18
                            Row {
                                spacing: 14
                                anchors.horizontalCenter: parent.horizontalCenter
                                Rectangle {
                                    width: 54
                                    height: 54
                                    radius: 14
                                    color: accentColor
                                    Image { anchors.centerIn: parent; width: 34; height: 34; source: "qrc:/branding/icon.png"; fillMode: Image.PreserveAspectFit }
                                }
                                Text { anchors.verticalCenter: parent.verticalCenter; text: "FLIXIFY"; color: textPrimary; font.pixelSize: 34; font.bold: true }
                            }
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Anonim ve Takip Edilemez"; color: textPrimary; font.pixelSize: 22; font.bold: true }
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Hiçbir veriniz saklanmaz. %100 gizlilik garantisi."; color: textMuted; font.pixelSize: 15 }
                            Rectangle {
                                width: parent.width
                                height: 180
                                radius: 24
                                color: "#0e141e"
                                border.width: 1
                                border.color: "#203147"
                                Column {
                                    anchors.centerIn: parent
                                    spacing: 18
                                    Row {
                                        spacing: 12
                                        Repeater {
                                            model: 4
                                            AuthCodeBox { displayText: issuedCode.length >= (index + 1) * 4 ? issuedCode.slice(index * 4, (index + 1) * 4).split("").join(" ") : "* * * *" }
                                        }
                                    }
                                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Şifrelenmiş erişim anahtarınız"; color: "#758197"; font.pixelSize: 15 }
                                }
                            }
                            AppButton { width: parent.width; text: "GÜVENLİ HESAP OLUŞTUR"; onClicked: registerAnonymousAccount() }
                            AppButton { width: parent.width; text: "Zaten Hesabım Var"; secondary: true; onClicked: currentScreen = "login" }
                            Row {
                                width: parent.width
                                spacing: 14
                                SupportLinkCard { width: (parent.width - 14) / 2; title: "WhatsApp"; subtitle: "7/24 Anında Yanıt"; iconSource: "qrc:/icons/whatsapp.svg"; url: contactData().whatsapp || "" }
                                SupportLinkCard { width: (parent.width - 14) / 2; title: "Telegram"; subtitle: "Hızlı Destek"; iconSource: "qrc:/icons/telegram.svg"; url: contactData().telegram || "" }
                            }
                        }
                    }
                }

                Item {
                    Rectangle {
                        anchors.centerIn: parent
                        width: compactWindow ? 700 : 760
                        height: compactWindow ? 520 : 560
                        radius: 28
                        color: panelColor
                        border.width: 1
                        border.color: "#162130"
                        Column {
                            anchors.fill: parent
                            anchors.margins: 28
                            spacing: 18
                            Text { text: "Mevcut Hesabınla Giriş Yap"; color: textPrimary; font.pixelSize: 24; font.bold: true }
                            TextField {
                                width: parent.width
                                height: 64
                                color: textPrimary
                                placeholderText: "Kullanıcı kodunu gir"
                                placeholderTextColor: "#8691a1"
                                text: authCode
                                font.pixelSize: 20
                                onTextChanged: authCode = text
                                background: Rectangle { radius: 20; color: "#0f141d"; border.width: 1; border.color: "#273649" }
                            }
                            AppButton { width: parent.width; text: "Giriş Yap"; onClicked: submitLogin() }
                            AppButton { width: parent.width; text: "Yeni Hesap Oluştur"; secondary: true; onClicked: currentScreen = "register" }
                            Row {
                                width: parent.width
                                spacing: 14
                                SupportLinkCard { width: (parent.width - 14) / 2; title: "WhatsApp"; subtitle: "7/24 Anında Yanıt"; iconSource: "qrc:/icons/whatsapp.svg"; url: contactData().whatsapp || "" }
                                SupportLinkCard { width: (parent.width - 14) / 2; title: "Telegram"; subtitle: "Hızlı Destek"; iconSource: "qrc:/icons/telegram.svg"; url: contactData().telegram || "" }
                            }
                            Text { text: safeText(apiClient.lastError); color: "#ff8c95"; font.pixelSize: 15; visible: text.length > 0 }
                        }
                    }
                }

                HomePage {
                    movieItems: homeMoviePreviewCache
                    seriesItems: homeSeriesPreviewCache
                    liveItems: homeLivePreviewCache
                    compactWindow: compactWindow
                    panelColor: panelColor
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    accentColor: accentColor
                    onMovieSelected: playMovie(movie)
                    onSeriesSelected: { selectedSeriesId = fieldText(series, "id"); activeEpisodeData = null; currentScreen = "series-detail" }
                    onLiveSelected: playLive(live, false)
                    onOpenMoviesRequested: openScreen("movies")
                    onOpenSeriesRequested: openScreen("series")
                    onOpenLiveRequested: openScreen("live")
                }

                Item {
                    Column {
                        anchors.fill: parent
                        anchors.margins: compactWindow ? 18 : 24
                        spacing: 16
                        visible: !videoFullscreen
                        Flickable {
                            width: parent.width
                            height: 48
                            contentWidth: countryRow.width
                            clip: true
                            Row {
                                id: countryRow
                                spacing: 10
                                Repeater {
                                    model: liveCountryChips()
                                    LiveChipButton { required property var modelData; text: `${modelData.label} ${Number(modelData.count || 0)}`; active: selectedLiveGroup === modelData.filter; onClicked: applyLiveFilters(liveSearchText, modelData.filter) }
                                }
                            }
                        }
                        Flickable {
                            width: parent.width
                            height: liveSubgroupChips().length ? 48 : 0
                            visible: liveSubgroupChips().length > 0
                            contentWidth: subgroupRow.width
                            clip: true
                            Row {
                                id: subgroupRow
                                spacing: 10
                                Repeater {
                                    model: liveSubgroupChips()
                                    LiveChipButton { required property var modelData; text: modelData.title; active: selectedLiveGroup === modelData.title; onClicked: applyLiveFilters(liveSearchText, modelData.title) }
                                }
                            }
                        }
                    }
                    Row {
                        anchors { top: parent.top; topMargin: videoFullscreen ? 0 : 130; left: parent.left; right: parent.right; bottom: parent.bottom; margins: compactWindow ? 18 : 24 }
                        spacing: 22
                        LiveTvPlayerShell {
                            width: videoFullscreen ? parent.width : Math.max(720, parent.width - rightPanel.width - 22)
                            height: parent.height
                            controller: livePlaybackController
                            videoSurfaceComponent: androidVideoSurfaceComponent
                            textPrimary: textPrimary
                            textMuted: textMuted
                            compactWindow: compactWindow
                            onToggleFullscreenRequested: toggleLiveFullscreen()
                        }
                        Rectangle {
                            id: rightPanel
                            width: videoFullscreen ? 0 : (compactWindow ? 440 : 500)
                            height: parent.height
                            visible: !videoFullscreen
                            radius: 28
                            color: surfaceColor
                            border.width: 1
                            border.color: "#1f2c3e"
                            Column {
                                anchors.fill: parent
                                anchors.margins: 18
                                spacing: 16
                                Row {
                                    width: parent.width
                                    spacing: 12
                                    TextField {
                                        id: liveSearchField
                                        width: parent.width - 114
                                        height: 54
                                        color: textPrimary
                                        placeholderText: "Kanal ara..."
                                        placeholderTextColor: "#8f98a8"
                                        text: liveSearchText
                                        background: Rectangle { radius: 18; color: "#0f141d"; border.width: 1; border.color: "#243141" }
                                    }
                                    AppButton { width: 102; text: "Ara"; onClicked: applyLiveFilters(liveSearchField.text, selectedLiveGroup) }
                                }
                                Text { text: "Kanallar"; color: textPrimary; font.pixelSize: 22; font.bold: true }
                                ListView {
                                    width: parent.width
                                    height: parent.height - 110
                                    clip: true
                                    spacing: 12
                                    model: filteredLiveItems()
                                    delegate: LiveChannelCard { channelData: modelData; width: ListView.view.width; active: fieldText(modelData, "id") === selectedLiveId; onClicked: playLive(modelData, true) }
                                }
                            }
                        }
                    }
                }

                MoviesPage {
                    movieItems: apiClient.movies || []
                    movieGroups: movieGroupOptions()
                    movieTotal: apiClient.movieTotal
                    currentMovie: selectedMovie()
                    playbackController: moviePlaybackController
                    videoSurfaceComponent: androidVideoSurfaceComponent
                    selectedMovieId: selectedMovieId
                    selectedGroup: selectedMovieGroup
                    searchText: moviesSearchText
                    playerVisible: selectedMovieId.length > 0
                    compactWindow: compactWindow
                    movieLoadingMore: apiClient.movieLoadingMore
                    movieHasMore: apiClient.movieHasMore
                    windowIsFullscreen: movieWindowFullscreen
                    panelColor: panelColor
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    accentColor: accentColor
                    onSearchEdited: applyMovieFilters(text, selectedMovieGroup)
                    onRefreshRequested: applyMovieFilters(moviesSearchText, selectedMovieGroup)
                    onClearFiltersRequested: applyMovieFilters("", "")
                    onGroupSelected: applyMovieFilters(moviesSearchText, group)
                    onMovieSelected: playMovie(movie)
                    onLoadMoreRequested: apiClient.loadMoreMovies()
                    onClosePlayerRequested: closeMoviePlayer()
                    onToggleWindowFullscreenRequested: movieWindowFullscreen = !movieWindowFullscreen
                }

                SeriesCatalogPage {
                    seriesItems: filteredSeriesItems()
                    seriesGroups: uniqueGroups(apiClient.series || [])
                    seriesTotal: filteredSeriesItems().length
                    selectedSeriesId: selectedSeriesId
                    selectedGroup: selectedSeriesGroup
                    searchText: seriesSearchText
                    compactWindow: compactWindow
                    panelColor: panelColor
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    accentColor: accentColor
                    onSearchEdited: applySeriesFilters(text, selectedSeriesGroup)
                    onRefreshRequested: applySeriesFilters(seriesSearchText, selectedSeriesGroup)
                    onClearFiltersRequested: applySeriesFilters("", "")
                    onGroupSelected: applySeriesFilters(seriesSearchText, group)
                    onSeriesSelected: { selectedSeriesId = fieldText(series, "id"); activeEpisodeData = null; currentScreen = "series-detail" }
                }

                SeriesDetailPage {
                    activeSeries: selectedSeries()
                    activeEpisode: activeEpisodeData
                    playbackController: seriesPlaybackController
                    videoSurfaceComponent: androidVideoSurfaceComponent
                    playerVisible: activeEpisodeData !== null
                    windowIsFullscreen: seriesWindowFullscreen
                    compactWindow: compactWindow
                    panelColor: panelColor
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    accentColor: accentColor
                    onPlayEpisodeRequested: playEpisode(episode, series)
                    onClosePlayerRequested: closeSeriesPlayer()
                    onExitDetailRequested: { closeSeriesPlayer(); currentScreen = "series" }
                    onToggleWindowFullscreenRequested: seriesWindowFullscreen = !seriesWindowFullscreen
                    onRetryPlaybackRequested: seriesPlaybackController.retryCurrent()
                }

                AndroidProfilePage {
                    userData: userData()
                    subscriptionLabel: subscriptionLabel()
                    compactWindow: compactWindow
                    panelColor: panelColor
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    accentColor: accentColor
                    onPackagesRequested: openScreen("packages")
                    onPaymentsRequested: openScreen("payments")
                    onContactRequested: openScreen("contact")
                }

                AndroidPackagesPage {
                    packages: apiClient.packages || []
                    compactWindow: compactWindow
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    accentColor: accentColor
                    onBackRequested: openScreen("profile")
                    onPackageSelected: function(packageData) {
                        pendingPackage = packageData
                        selectedPaymentMethodId = ""
                        selectedCryptoAssetId = ""
                        apiClient.fetchPaymentMethods()
                    }
                }

                AndroidPaymentsPage {
                    paymentRequests: apiClient.paymentRequests || []
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    onBackRequested: openScreen("profile")
                }

                AndroidContactPage {
                    whatsappUrl: contactData().whatsapp || ""
                    telegramUrl: contactData().telegram || ""
                    surfaceColor: surfaceColor
                    textPrimary: textPrimary
                    textMuted: textMuted
                    onBackRequested: openScreen("profile")
                    onOpenUrl: function(url) { openSupportUrl(url) }
                }
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        visible: pendingPackage !== null
        color: "#d9030508"
        z: 30

        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width - (compactWindow ? 48 : 120), compactWindow ? 860 : 980)
            height: Math.min(parent.height - (compactWindow ? 48 : 120), paymentColumn.implicitHeight + 44)
            radius: 28
            color: "#0b0f17"
            border.width: 1
            border.color: "#1f2c3e"

            Column {
                id: paymentColumn
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 22
                spacing: 18

                Item {
                    width: parent.width
                    height: 46

                    Text {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        text: "Ödeme Yöntemi"
                        color: textMuted
                        font.pixelSize: 13
                        font.bold: true
                    }

                    Button {
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        width: 46
                        height: 46
                        hoverEnabled: false
                        focusPolicy: Qt.StrongFocus
                        background: Rectangle {
                            radius: 23
                            color: "#131923"
                            border.width: 1
                            border.color: parent.activeFocus ? "#44ff2432" : "#2a3140"
                        }
                        contentItem: Canvas {
                            anchors.fill: parent
                            onPaint: {
                                const ctx = getContext("2d")
                                ctx.reset()
                                ctx.strokeStyle = "#f4f6fb"
                                ctx.lineWidth = 2.2
                                ctx.lineCap = "round"
                                ctx.beginPath()
                                ctx.moveTo(14, 14)
                                ctx.lineTo(width - 14, height - 14)
                                ctx.moveTo(width - 14, 14)
                                ctx.lineTo(14, height - 14)
                                ctx.stroke()
                            }
                        }
                        onClicked: closePaymentModal()
                    }
                }

                Text {
                    text: pendingPackage ? `${paymentPackageTitle(pendingPackage)} paketi için ödeme yöntemi seçin` : ""
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: textPrimary
                    font.pixelSize: compactWindow ? 30 : 34
                    font.bold: true
                }

                Flow {
                    width: parent.width
                    spacing: 12

                    Repeater {
                        model: paymentMethods()

                        Button {
                            required property var modelData
                            width: compactWindow ? parent.width : Math.floor((parent.width - 12) / 2)
                            height: 108
                            hoverEnabled: false
                            focusPolicy: Qt.StrongFocus
                            background: Rectangle {
                                radius: 24
                                color: selectedPaymentMethodId === fieldText(modelData, "id") ? "#1be50914" : "#131923"
                                border.width: 1
                                border.color: selectedPaymentMethodId === fieldText(modelData, "id") ? "#b91c1c" : "#2a3140"
                            }
                            contentItem: Column {
                                anchors.fill: parent
                                anchors.margins: 18
                                spacing: 8
                                Text {
                                    text: fieldText(modelData, "label") || fieldText(modelData, "id")
                                    color: textPrimary
                                    font.pixelSize: 20
                                    font.bold: true
                                }
                                Text {
                                    text: fieldText(modelData, "details") || "Ödeme onayı destek ekibi tarafından tamamlanır."
                                    width: parent.width
                                    wrapMode: Text.WordWrap
                                    color: textMuted
                                    font.pixelSize: 13
                                }
                            }
                            onClicked: selectPaymentMethod(fieldText(modelData, "id"))
                        }
                    }
                }

                Rectangle {
                    width: parent.width
                    visible: selectedPaymentMethodId === "crypto" && paymentCryptoAssets().length > 0
                    implicitHeight: cryptoColumn.implicitHeight + 28
                    radius: 24
                    color: "#101620"
                    border.width: 1
                    border.color: "#222b38"

                    Column {
                        id: cryptoColumn
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 14

                        Text {
                            text: "Kripto ödeme bilgileri"
                            color: textPrimary
                            font.pixelSize: 18
                            font.bold: true
                        }

                        Flow {
                            width: parent.width
                            spacing: 12

                            Repeater {
                                model: paymentCryptoAssets()

                                Button {
                                    required property var modelData
                                    width: compactWindow ? parent.width : Math.floor((parent.width - 24) / 3)
                                    height: 92
                                    hoverEnabled: false
                                    focusPolicy: Qt.StrongFocus
                                    background: Rectangle {
                                        radius: 22
                                        color: selectedCryptoAssetId === fieldText(modelData, "id") ? "#142a4d" : "#131923"
                                        border.width: 1
                                        border.color: selectedCryptoAssetId === fieldText(modelData, "id") ? "#2f72ff" : "#263243"
                                    }
                                    contentItem: Row {
                                        anchors.fill: parent
                                        anchors.margins: 16
                                        spacing: 14

                                        Rectangle {
                                            width: 52
                                            height: 52
                                            radius: 26
                                            color: "#ffffff"
                                            anchors.verticalCenter: parent.verticalCenter
                                            clip: true

                                            Image {
                                                id: cryptoLogo
                                                anchors.centerIn: parent
                                                width: 36
                                                height: 36
                                                source: paymentCryptoAssetLogo(modelData)
                                                fillMode: Image.PreserveAspectFit
                                                asynchronous: true
                                                cache: true
                                                visible: source.toString().length > 0 && status === Image.Ready
                                            }

                                            Text {
                                                anchors.centerIn: parent
                                                visible: !cryptoLogo.visible
                                                text: paymentCryptoAssetSymbol(modelData)
                                                color: "#0b0f17"
                                                font.pixelSize: 15
                                                font.bold: true
                                            }
                                        }

                                        Column {
                                            anchors.verticalCenter: parent.verticalCenter
                                            spacing: 6

                                            Text {
                                                text: fieldText(modelData, "label") || paymentCryptoAssetSymbol(modelData)
                                                color: textPrimary
                                                font.pixelSize: 18
                                                font.bold: true
                                            }

                                            Text {
                                                text: paymentCryptoAssetSymbol(modelData)
                                                color: textMuted
                                                font.pixelSize: 13
                                                font.bold: true
                                            }
                                        }
                                    }
                                    onClicked: selectedCryptoAssetId = fieldText(modelData, "id")
                                }
                            }
                        }
                    }
                }

                Rectangle {
                    width: parent.width
                    visible: selectedPaymentMethod() !== null
                    implicitHeight: detailsColumn.implicitHeight + 28
                    radius: 24
                    color: "#101620"
                    border.width: 1
                    border.color: "#222b38"

                    Column {
                        id: detailsColumn
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 12

                        Repeater {
                            model: paymentInstructionRows()

                            Rectangle {
                                required property var modelData
                                width: parent.width
                                height: 72
                                radius: 18
                                color: "#131923"
                                border.width: 1
                                border.color: "#263243"

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 14
                                    spacing: 12

                                    Column {
                                        width: parent.width - 138
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 6

                                        Text {
                                            text: fieldText(modelData, "label")
                                            color: textMuted
                                            font.pixelSize: 12
                                            font.bold: true
                                        }

                                        Text {
                                            text: fieldText(modelData, "value")
                                            width: parent.width
                                            elide: Text.ElideMiddle
                                            color: textPrimary
                                            font.pixelSize: 16
                                            font.bold: true
                                        }
                                    }

                                    AppButton {
                                        width: 112
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: "Kopyala"
                                        secondary: true
                                        onClicked: copyPaymentValue(fieldText(modelData, "label"), fieldText(modelData, "value"))
                                    }
                                }
                            }
                        }
                    }
                }

                Row {
                    width: parent.width
                    spacing: 12

                    AppButton {
                        width: 220
                        text: "Ödeme Bildir"
                        enabled: selectedPaymentMethodId.length > 0
                                 && (selectedPaymentMethodId !== "crypto" || selectedCryptoAsset() !== null)
                        onClicked: {
                            if (!pendingPackage || !selectedPaymentMethodId.length) {
                                return
                            }
                            apiClient.requestPayment(
                                fieldText(pendingPackage, "slug"),
                                selectedPaymentMethodId,
                                selectedPaymentMethodId === "crypto" && selectedCryptoAsset()
                                    ? fieldText(selectedCryptoAsset(), "id")
                                    : ""
                            )
                            closePaymentModal()
                            openScreen("payments")
                        }
                    }

                    AppButton {
                        width: 160
                        text: "Vazgeç"
                        secondary: true
                        onClicked: closePaymentModal()
                    }
                }
            }
        }
    }

    // __ANDROID_TV_UI__
}
