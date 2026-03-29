import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import Flixify.Native 1.0

ApplicationWindow {
    id: window
    readonly property int desktopBaseWidth: Qt.platform.os === "windows" ? Math.max(1024, Number(desktopWindowWidth) || 1600) : 1600
    readonly property int desktopBaseHeight: Qt.platform.os === "windows" ? Math.max(576, Number(desktopWindowHeight) || 900) : 600
    width: desktopBaseWidth
    height: Qt.platform.os === "windows" ? desktopBaseHeight : 600
    minimumWidth: Qt.platform.os === "windows" ? desktopBaseWidth : 980
    minimumHeight: Qt.platform.os === "windows" ? desktopBaseHeight : 600
    maximumWidth: Qt.platform.os === "windows" ? desktopBaseWidth : 16777215
    maximumHeight: Qt.platform.os === "windows" ? desktopBaseHeight : 16777215
    visible: true
    title: "Flixify Pro"
    color: "#05070b"

    readonly property color panel: "#cc0d121c"
    readonly property color panelSoft: "#131923"
    readonly property color panelStrong: "#f0080b11"
    readonly property color textPrimary: "#f7f8fb"
    readonly property color textMuted: "#b1bac9"
    readonly property color accent: "#e50914"
    readonly property color accentStrong: "#ff2432"
    readonly property color borderSoft: "#1affffff"
    readonly property color success: "#30d19d"
    readonly property color danger: "#ff7d86"
    readonly property color info: "#7cb6ff"
    readonly property bool isMacOS: Qt.platform.os === "osx"
    readonly property bool compactWindow: width < 1180
    readonly property bool mediumWindow: width < 1440
    readonly property bool shortWindow: height < 820
    readonly property real shellPadding: compactWindow ? 18 : 24
    readonly property real sectionSpacing: compactWindow ? 16 : 20

    // Responsive scaling
    readonly property real fontScale: {
        if (width < 1280) return 0.9
        if (width < 1920) return 1.0
        if (width < 2560) return 1.1
        return 1.2
    }
    readonly property real spacingScale: {
        if (height < 800) return 0.9
        if (height < 1080) return 1.0
        return 1.15
    }
    readonly property real heroHeight: compactWindow ? 500 : mediumWindow ? 540 : 580
    readonly property real authPanelWidth: Math.min(width - 32, currentScreen === "register" ? (compactWindow ? 520 : 560) : (compactWindow ? 440 : 460))
    readonly property real restorePanelWidth: Math.min(width - 32, compactWindow ? 460 : 520)
    readonly property real blockedPanelWidth: Math.min(width - 32, compactWindow ? 560 : 720)
    readonly property real modalPanelWidth: Math.min(width - 32, compactWindow ? width - 32 : 740)
    readonly property real premiumPanelWidth: Math.min(width - 32, compactWindow ? width - 32 : 700)
    readonly property real profileTileWidth: compactWindow ? 0 : 1
    readonly property real cardGap: compactWindow ? 16 : 18
    readonly property real posterCardWidth: compactWindow ? 186 : mediumWindow ? 204 : 222
    readonly property real railCardWidth: compactWindow ? 236 : mediumWindow ? 260 : 286
    readonly property real railCardHeight: compactWindow ? 388 : mediumWindow ? 404 : 420
    readonly property real profileCardWidth: compactWindow ? 0 : 1
    function clampValue(value, minValue, maxValue) {
        return Math.max(minValue, Math.min(maxValue, value))
    }

    function pageWidth(containerWidth) {
        return Math.max(320, containerWidth - shellPadding * 2)
    }

    function gridColumns(availableWidth, minCardWidth, maxColumns) {
        return Math.max(1, Math.min(maxColumns, Math.floor((availableWidth + cardGap) / (minCardWidth + cardGap))))
    }

    function gridCardWidth(availableWidth, minCardWidth, maxColumns) {
        const columns = gridColumns(availableWidth, minCardWidth, maxColumns)
        return Math.floor((availableWidth - (columns - 1) * cardGap) / columns)
    }

    property string currentScreen: "login"
    property string authCode: ""
    property bool showAuthCode: false
    property bool authCodeFieldSyncing: false
    property string authDeviceName: "Flixify Native Qt"
    property string registerDeviceName: "Flixify Native Qt"
    property string issuedCode: ""
    property int revealedCount: 0
    property int scrambleSeed: 0
    property int revealWarmupTicks: 0
    property bool registerAcknowledged: false
    property bool playerVisible: false
    property string inlinePlaybackMode: "none"
    property string dismissedUpdateVersion: ""
    property string selectedMovieId: ""
    property string selectedSeriesId: ""
    property string selectedLiveId: ""
    property string selectedMovieGroup: ""
    property string selectedSeriesGroup: ""
    property string selectedLiveGroup: "country:TR"
    property string moviesSearchText: ""
    property string seriesSearchText: ""
    property string liveSearchText: ""
    property string playerSubtitle: ""
    property string playerImageUrl: ""
    property bool videoFullscreen: false
    property bool videoFullscreenOwnsWindow: false
    property bool movieFullscreen: false
    property bool movieFullscreenOwnsWindow: false
    property bool seriesFullscreen: false
    property bool seriesFullscreenOwnsWindow: false
    property var pendingPackage: null
    property string selectedPaymentMethodId: ""
    property string selectedCryptoAssetId: ""
    property string toastMessage: ""
    property color toastColor: info
    property var homeMoviePreviewCache: []
    property var homeSeriesPreviewCache: []
    property var homeLivePreviewCache: []
    property bool lastKnownHasActiveSubscription: false

    onVideoFullscreenChanged: {
        livePlaybackController.liveFullscreenActive = videoFullscreen
        if (inlinePlaybackMode === "live" || livePlaybackController.activeContentKind === "live") {
            livePlaybackController.videoFillMode = videoFullscreen ? "fill" : "fit"
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

    Component.onCompleted: {
        currentScreen = signedOutEntryScreen(true)
        livePlaybackController.liveFullscreenActive = videoFullscreen
        refreshHomePreviewContent()
        apiClient.bootstrap()
    }

    function normalizeText(value) {
        return (value || "").toString().toLocaleLowerCase()
    }

    function normalizeAsciiText(value) {
        const text = (value || "").toString()
        if (!text.length) {
            return ""
        }
        return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
    }

    function sanitizeCode(value) {
        return (value || "").toString().replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16)
    }

    function formatCode(value) {
        const normalized = sanitizeCode(value)
        return normalized.length ? normalized.match(/.{1,4}/g).join(" ") : "---- ---- ---- ----"
    }

    function formatEditableCode(value) {
        const normalized = sanitizeCode(value)
        return normalized.length ? normalized.match(/.{1,4}/g).join(" ") : ""
    }

    function authFieldDisplayText() {
        return showAuthCode ? formatEditableCode(authCode) : sanitizeCode(authCode)
    }

    function authCursorPositionForRawCount(rawCount) {
        const normalizedCount = Math.max(0, Math.min(16, Number(rawCount) || 0))
        if (!showAuthCode) {
            return normalizedCount
        }
        return normalizedCount > 0 ? normalizedCount + Math.floor((normalizedCount - 1) / 4) : 0
    }

    function syncAuthCodeField(moveCursorToEnd) {
        if (!authCodeField) {
            return
        }
        const nextText = authFieldDisplayText()
        const nextCursor = moveCursorToEnd
            ? nextText.length
            : Math.min(authCodeField.cursorPosition, nextText.length)
        if (authCodeField.text === nextText && authCodeField.cursorPosition === nextCursor) {
            return
        }
        authCodeFieldSyncing = true
        authCodeField.text = nextText
        authCodeField.cursorPosition = nextCursor
        authCodeFieldSyncing = false
    }

    function animatedIssuedBuffer() {
        if (!issuedCode.length) {
            return "****************"
        }
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        let buffer = ""
        for (let index = 0; index < 16; index += 1) {
            if (index < issuedCode.length && index < revealedCount) {
                buffer += issuedCode[index]
            } else if (index < issuedCode.length) {
                buffer += alphabet[(scrambleSeed + index * 11) % alphabet.length]
            } else {
                buffer += "*"
            }
        }
        return buffer
    }

    function issuedSegmentText(segmentIndex) {
        const start = Math.max(0, segmentIndex * 4)
        let segment = animatedIssuedBuffer().slice(start, start + 4)
        if (!segment.length) {
            segment = "****"
        }
        return segment.split("").join(" ")
    }

    function issuedSegmentRevealCount(segmentIndex) {
        return Math.max(0, Math.min(4, revealedCount - segmentIndex * 4))
    }

    function issuedSegmentRevealProgress(segmentIndex) {
        return issuedSegmentRevealCount(segmentIndex) / 4
    }

    function issuedSegmentActive(segmentIndex) {
        const count = issuedSegmentRevealCount(segmentIndex)
        return registerRevealBusy() && count > 0 && count < 4
    }

    function progressSegments() {
        return Math.min(Math.ceil(sanitizeCode(authCode).length / 4), 4)
    }

    function registerRevealProgress() {
        return issuedCode.length ? Math.min(1, revealedCount / issuedCode.length) : 0
    }

    function registerRevealComplete() {
        return issuedCode.length > 0 && revealedCount >= issuedCode.length
    }

    function registerRevealBusy() {
        return issuedCode.length > 0 && !registerRevealComplete()
    }

    function safeText(value) {
        return (value || "").toString().trim()
    }

    function isIpOrLocalhostHost(hostname) {
        const normalized = safeText(hostname).toLowerCase()
        if (!normalized.length) {
            return false
        }
        if (normalized === "localhost" || normalized.endsWith(".localhost")) {
            return true
        }
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
            return true
        }
        if (normalized.indexOf(":") !== -1) {
            return /^[0-9a-f:.]+$/i.test(normalized)
        }
        return false
    }

    function resolveArtworkUrl(value) {
        const trimmed = safeText(value)
        if (!trimmed.length) {
            return ""
        }

        if (trimmed.substring(0, 2) === "//") {
            return "https:" + trimmed
        }

        if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
            return trimmed
        }

        const baseUrl = safeText(apiClient.apiBaseUrl)
        if (!baseUrl.length) {
            return trimmed
        }

        const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
        const normalizedPath = trimmed.startsWith("/") ? trimmed.substring(1) : trimmed
        return normalizedBaseUrl + normalizedPath
    }

    function normalizeArtworkUrl(value) {
        const resolved = resolveArtworkUrl(value)
        if (!resolved.length) {
            return ""
        }

        try {
            const parsed = new URL(resolved)
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return ""
            }
            return parsed.toString()
        } catch (error) {
            try {
                return encodeURI(resolved)
            } catch (encodeError) {
                return resolved
            }
        }
    }

    function artworkSource(value) {
        return normalizeArtworkUrl(value)
    }

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
        return safeText(fieldValue(item, key, ""))
    }

    function fieldNumber(item, key, fallbackValue = 0) {
        const numericValue = Number(fieldValue(item, key, fallbackValue))
        return Number.isFinite(numericValue) ? numericValue : fallbackValue
    }

    function fieldList(item, key) {
        const value = fieldValue(item, key, [])
        return value && value.length !== undefined ? value : []
    }

    function movieArtworkUrl(movie) {
        if (!movie) {
            return ""
        }
        return artworkSource(
            fieldValue(movie, "posterUrl", "")
            || fieldValue(movie, "streamImageUrl", "")
            || fieldValue(movie, "stream_icon", "")
            || fieldValue(movie, "logoUrl", "")
        )
    }

    function movieViewItem(movie) {
        if (!movie) {
            return null
        }
        return movie
    }

    function movieViewItems() {
        const items = filteredMovies()
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            const viewItem = movieViewItem(items[index])
            if (viewItem) {
                output.push(viewItem)
            }
        }
        return output
    }

    function artworkMonogram(value) {
        const parts = safeText(value).split(/\s+/).slice(0, 2)
        let output = ""
        for (let index = 0; index < parts.length; index += 1) {
            output += (parts[index][0] || "").toUpperCase()
        }
        return output.length ? output : "FX"
    }

    function artworkLabel(kind) {
        if (kind === "live") return "Canlı Yayın"
        if (kind === "episode") return "Dizi"
        return "Film"
    }

    function playbackKindLabel(kind) {
        if (kind === "live") return "Canlı TV"
        if (kind === "episode") return "Dizi"
        return "Film"
    }

    function formatPlaybackClock(seconds) {
        const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const remainingSeconds = totalSeconds % 60
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
        }
        return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    }

    function playbackProgressRatio() {
        if (playbackController.durationSeconds <= 0) {
            return 0
        }
        return clampValue(playbackController.positionSeconds / playbackController.durationSeconds, 0, 1)
    }

    function showToast(message, color) {
        if (!message || !message.toString().trim().length) {
            return
        }
        toastMessage = message.toString().trim()
        toastColor = color || info
        toastTimer.restart()
    }

    function userData() {
        return apiClient.me && apiClient.me.user ? apiClient.me.user : ({})
    }

    function contactData() {
        if (apiClient.me && apiClient.me.contact) {
            return apiClient.me.contact
        }
        return {
            whatsapp: apiClient.publicSettings && apiClient.publicSettings.supportWhatsappUrl
                ? apiClient.publicSettings.supportWhatsappUrl
                : "",
            telegram: apiClient.publicSettings && apiClient.publicSettings.supportTelegramUrl
                ? apiClient.publicSettings.supportTelegramUrl
                : ""
        }
    }

    function hasLoadedUser() {
        const user = userData()
        return Boolean(user && user.id)
    }

    function subscriptionLabel() {
        const user = userData()
        if (user.hasActiveSubscription && user.activePackage) {
            return `${user.activePackage.title} - ${user.activePackage.remainingDays} gün`
        }
        return "Paket aktif değil"
    }

    function packageDurationMonths(packageData) {
        const value = Number(packageData && packageData.durationMonths !== undefined ? packageData.durationMonths : 0)
        return Number.isFinite(value) ? value : 0
    }

    function orderedPackages() {
        const source = apiClient.packages || []
        const items = []
        for (let index = 0; index < source.length; index += 1) {
            items.push(source[index])
        }
        items.sort(function(a, b) {
            return packageDurationMonths(a) - packageDurationMonths(b)
        })
        return items
    }

    function packageDisplayTitle(packageData) {
        const months = packageDurationMonths(packageData)
        if (months > 0) {
            return `${months} Aylık`
        }
        const fallback = safeText(packageData && packageData.title ? packageData.title : "")
        return fallback.length ? fallback : "Premium Paket"
    }

    function packageDisplayCopy(packageData) {
        const months = packageDurationMonths(packageData)
        if (months === 1) return "Hızlı başlangıç ve premium kataloğa hemen erişim."
        if (months === 3) return "Kısa ve orta vadede en dengeli premium kullanım."
        if (months === 6) return "Daha uzun süre rahat kullanım isteyenler için güçlü seçim."
        if (months === 12) return "Yıl boyu premium deneyim için en avantajlı tercih."
        return "Film, dizi ve canlı TV erişimi için premium paket."
    }

    function packageDisplayPrice(packageData) {
        const raw = safeText(packageData && packageData.priceLabel ? packageData.priceLabel : "")
        if (!raw.length) {
            return "Destek ile iletişime geçin"
        }
        return /[A-Za-z₺$€£]/.test(raw) ? raw : `${raw} TL`
    }

    function packageFeatureList(packageData) {
        const months = packageDurationMonths(packageData)
        let durationLine = "Premium katalog erişimi"
        if (months === 1) durationLine = "Kısa süreli hızlı başlangıç"
        else if (months === 3) durationLine = "Dengeli premium kullanım"
        else if (months === 6) durationLine = "Uzun süre rahat erişim"
        else if (months === 12) durationLine = "En avantajlı uzun dönem paket"
        return [
            "Tüm film, dizi ve canlı TV içerikleri",
            "Paket aktif olduğunda tam katalog erişimi",
            durationLine
        ]
    }

    function packageRecommended(packageData) {
        return packageDurationMonths(packageData) === 12
    }

    function uniqueGroups(items) {
        const seen = {}
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            const title = (items[index].groupTitle || "").toString().trim()
            if (!title.length || seen[title]) {
                continue
            }
            seen[title] = true
            output.push(title)
        }
        return output
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
        if (!normalizedTitle.length) {
            return null
        }
        if (normalizedTitle === "xxx:adults" || normalizedTitle === "adults +18") {
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
        if (!normalized.length) {
            return null
        }
        if (normalized === "turkiye") {
            return "TR"
        }
        const prefixes = ["country:", "ulke:"]
        for (let index = 0; index < prefixes.length; index += 1) {
            const prefix = prefixes[index]
            if (normalized.indexOf(prefix) === 0) {
                return normalizeLiveCountryCode(normalized.slice(prefix.length).trim())
            }
        }
        return null
    }

    function parseLiveCountryCodeFromGroupPrefix(title) {
        if (parseLiveSpecialFamilyFromGroupTitle(title)) {
            return null
        }
        const normalizedTitle = normalizeAsciiText(canonicalLiveGroupTitle(title))
        const match = normalizedTitle.match(/^([a-z]{2,3})\s*[:\-]/)
        if (!match || !match[1]) {
            return null
        }
        return normalizeLiveCountryCode(match[1])
    }

    function parseLiveCountryCodeFromExplicitGroupTitle(title) {
        if (parseLiveSpecialFamilyFromGroupTitle(title)) {
            return null
        }
        const normalizedTitle = normalizeAsciiText(canonicalLiveGroupTitle(title))
        if (!/^[a-z]{2,3}$/.test(normalizedTitle)) {
            return null
        }
        return normalizeLiveCountryCode(normalizedTitle)
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
        if (!normalized.length || normalized.indexOf("family:") !== 0) {
            return null
        }
        return normalizeLiveCountryFamilyKey(normalized.slice("family:".length))
    }

    function parseLiveCountryFamilyFromGroupTitle(title) {
        const specialFamily = parseLiveSpecialFamilyFromGroupTitle(title)
        if (specialFamily) {
            return specialFamily
        }
        const normalizedTitle = normalizeLiveCountryFamilyKey(canonicalLiveGroupTitle(title))
        if (!normalizedTitle) {
            return null
        }
        if (parseLiveCountryCodeFromExplicitGroupTitle(title) || parseLiveCountryCodeFromGroupPrefix(title)) {
            return null
        }

        const multiWordRoots = ["LATIN AMERICA", "ARAB COUNTRIES", "CZECH AND SLOWAK", "EX-YU"]
        for (let index = 0; index < multiWordRoots.length; index += 1) {
            const root = multiWordRoots[index]
            if (normalizedTitle === root || normalizedTitle.indexOf(root + " ") === 0) {
                return root
            }
        }

        const firstWord = normalizedTitle.split(" ")[0]
        const ignoredRoots = {
            "VIP": true,
            "SPORT": true,
            "ARABIC": true,
            "KURDISH": true,
            "7/24": true
        }
        if (!firstWord.length || ignoredRoots[firstWord]) {
            return null
        }
        return firstWord
    }

    function getLiveCountryLabel(code) {
        const normalizedCode = normalizeLiveCountryCode(code)
        if (!normalizedCode) {
            return safeText(code)
        }
        if (normalizedCode === "TR") {
            return "Türkiye"
        }
        return normalizedCode
    }

    function getLiveCountryFamilyLabel(familyKey) {
        const normalizedFamily = normalizeLiveCountryFamilyKey(familyKey)
        return normalizedFamily ? normalizedFamily : safeText(familyKey)
    }

    function liveGroupsData() {
        return apiClient.liveGroups || []
    }

    function liveCountryChips() {
        const groups = normalizedLiveGroupsData()
        const buckets = {}
        const explicitCountryCodes = {}

        function pushBucket(type, key, count) {
            const normalizedCount = Number(count || 0)
            const bucketKey = `${type}:${key}`
            if (!buckets[bucketKey]) {
                buckets[bucketKey] = {
                    type,
                    key,
                    count: 0,
                    filter: type === "code" ? buildLiveCountryFilter(key) : buildLiveCountryFamilyFilter(key),
                    label: type === "code" ? displayLiveCountryLabel(key) : displayLiveCountryFamilyLabel(key)
                }
            }
            buckets[bucketKey].count += normalizedCount
        }

        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            const title = safeText(group.title)
            const groupCount = Number(group.count || 0)
            const explicitCountryCode = parseLiveCountryCodeFromExplicitGroupTitle(group.title)
            if (explicitCountryCode) {
                explicitCountryCodes[explicitCountryCode] = true
                pushBucket("code", explicitCountryCode, groupCount)
                continue
            }
        }

        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            const title = safeText(group.title)
            const groupCount = Number(group.count || 0)
            const countryCodeFromPrefix = parseLiveCountryCodeFromGroupPrefix(title)
            if (countryCodeFromPrefix) {
                if (!explicitCountryCodes[countryCodeFromPrefix]) {
                    pushBucket("code", countryCodeFromPrefix, groupCount)
                }
                continue
            }
            const familyKey = parseLiveCountryFamilyFromGroupTitle(title)
            if (familyKey) {
                pushBucket("family", familyKey, groupCount)
            }
        }

        const chips = Object.keys(buckets).map(function(bucketKey) { return buckets[bucketKey] })

        chips.sort((left, right) => {
            if (left.type === "code" && left.key === "TR" && (right.type !== "code" || right.key !== "TR")) return -1
            if (right.type === "code" && right.key === "TR" && (left.type !== "code" || left.key !== "TR")) return 1
            if (right.count !== left.count) return right.count - left.count
            return left.label.localeCompare(right.label, "tr-TR")
        })

        const activeCountryKey = currentSelectedLiveCountryKey()
        const activeCountryFilter = currentSelectedLiveCountryFilter()
        if (activeCountryKey && activeCountryFilter.length) {
            let exists = false
            for (let index = 0; index < chips.length; index += 1) {
                if (chips[index].key === activeCountryKey) {
                    exists = true
                    break
                }
            }
            if (!exists) {
                const isCode = Boolean(parseLiveCountryCodeFromFilter(activeCountryFilter)) || Boolean(parseLiveCountryCodeFromExplicitGroupTitle(selectedLiveGroup)) || Boolean(parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup))
                chips.unshift({
                    type: isCode ? "code" : "family",
                    key: activeCountryKey,
                    count: 0,
                    filter: activeCountryFilter,
                    label: isCode ? displayLiveCountryLabel(activeCountryKey) : displayLiveCountryFamilyLabel(activeCountryKey)
                })
            }
        }

        return chips
    }

    function currentSelectedLiveCountryKey() {
        const explicitCountryCode = parseLiveCountryCodeFromFilter(selectedLiveGroup)
        if (explicitCountryCode) {
            return explicitCountryCode
        }
        const familyFilter = parseLiveCountryFamilyFromFilter(selectedLiveGroup)
        if (familyFilter) {
            return familyFilter
        }
        const directGroupCode = parseLiveCountryCodeFromExplicitGroupTitle(selectedLiveGroup)
        if (directGroupCode) {
            return directGroupCode
        }
        const prefixedGroupCode = parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup)
        if (prefixedGroupCode) {
            return prefixedGroupCode
        }
        return parseLiveCountryFamilyFromGroupTitle(selectedLiveGroup)
    }

    function currentSelectedLiveCountryFilter() {
        const explicitCountryCode = parseLiveCountryCodeFromFilter(selectedLiveGroup)
        if (explicitCountryCode) {
            return buildLiveCountryFilter(explicitCountryCode)
        }
        const familyFilter = parseLiveCountryFamilyFromFilter(selectedLiveGroup)
        if (familyFilter) {
            return buildLiveCountryFamilyFilter(familyFilter)
        }
        const familyFromGroup = parseLiveCountryFamilyFromGroupTitle(selectedLiveGroup)
        if (familyFromGroup) {
            return buildLiveCountryFamilyFilter(familyFromGroup)
        }
        const directGroupCode = parseLiveCountryCodeFromExplicitGroupTitle(selectedLiveGroup)
        if (directGroupCode) {
            return buildLiveCountryFilter(directGroupCode)
        }
        const prefixedGroupCode = parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup)
        return prefixedGroupCode ? buildLiveCountryFilter(prefixedGroupCode) : ""
    }

    function liveSubgroupChips() {
        const selectedCountryCode =
            parseLiveCountryCodeFromFilter(selectedLiveGroup)
            || parseLiveCountryCodeFromExplicitGroupTitle(selectedLiveGroup)
            || parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup)
        const selectedCountryFamily =
            parseLiveCountryFamilyFromFilter(selectedLiveGroup)
            || parseLiveCountryFamilyFromGroupTitle(selectedLiveGroup)
        if (!selectedCountryCode && !selectedCountryFamily) {
            return []
        }

        const groups = normalizedLiveGroupsData()
        const output = []
        const seenTitles = {}

        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            const title = canonicalLiveGroupTitle(group.title)
            if (!title.length || parseLiveCountryCodeFromExplicitGroupTitle(title)) {
                continue
            }

            let matchesSelectedCountry = false
            if (selectedCountryCode) {
                const groupCountryCode = parseLiveCountryCodeFromGroupPrefix(title)
                if (groupCountryCode === selectedCountryCode) {
                    matchesSelectedCountry = true
                }
            }
            if (!matchesSelectedCountry && selectedCountryFamily) {
                const groupCountryFamily = parseLiveCountryFamilyFromGroupTitle(title)
                if (groupCountryFamily === selectedCountryFamily && normalizeLiveCountryFamilyKey(title) !== selectedCountryFamily) {
                    matchesSelectedCountry = true
                }
            }

            if (!matchesSelectedCountry) {
                continue
            }

            if (seenTitles[title]) {
                continue
            }

            seenTitles[title] = true
            output.push({
                title,
                count: Number(group.count || 0),
                kind: "live"
            })
        }

        output.sort((left, right) => Number(right.count || 0) - Number(left.count || 0) || safeText(left.title).localeCompare(safeText(right.title), "tr-TR"))

        if (safeText(selectedLiveGroup).length && !parseLiveCountryCodeFromFilter(selectedLiveGroup) && !parseLiveCountryFamilyFromFilter(selectedLiveGroup)) {
            let exists = false
            for (let index = 0; index < output.length; index += 1) {
                if (output[index].title === selectedLiveGroup) {
                    exists = true
                    break
                }
            }
            if (!exists && ((selectedCountryCode && parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup) === selectedCountryCode) || (selectedCountryFamily && parseLiveCountryFamilyFromGroupTitle(selectedLiveGroup) === selectedCountryFamily))) {
                output.unshift({ title: selectedLiveGroup, count: 0, kind: "live" })
            }
        }

        return output
    }

    function liveGroupChips() {
        const groups = normalizedLiveGroupsData()
        const output = []
        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            if (parseLiveCountryCodeFromExplicitGroupTitle(group.title)) {
                continue
            }
            if (parseLiveCountryCodeFromGroupPrefix(group.title)) {
                continue
            }
            if (parseLiveCountryFamilyFromGroupTitle(group.title)) {
                continue
            }
            output.push(group)
        }
        output.sort((left, right) => Number(right.count || 0) - Number(left.count || 0) || safeText(left.title).localeCompare(safeText(right.title), "tr-TR"))
        if (safeText(selectedLiveGroup).length && !parseLiveCountryCodeFromFilter(selectedLiveGroup)) {
            let exists = false
            for (let index = 0; index < output.length; index += 1) {
                if (output[index].title === selectedLiveGroup) {
                    exists = true
                    break
                }
            }
            if (!exists) {
                output.unshift({ title: selectedLiveGroup, count: 0, kind: "live" })
            }
        }
        return output
    }

    function displayLiveCountryLabel(code) {
        const normalizedCode = normalizeLiveCountryCode(code)
        if (!normalizedCode) {
            return safeText(code)
        }
        if (normalizedCode === "XXX") {
            return "Adults"
        }
        return getLiveCountryLabel(code)
    }

    function displayLiveCountryFamilyLabel(familyKey) {
        const normalizedFamily = normalizeLiveCountryFamilyKey(familyKey)
        if (normalizedFamily === "ADULTS") {
            return "Adults"
        }
        return getLiveCountryFamilyLabel(familyKey)
    }

    function normalizedLiveGroupsData() {
        const source = liveGroupsData()
        const buckets = {}
        const output = []
        for (let index = 0; index < source.length; index += 1) {
            const group = source[index]
            const title = canonicalLiveGroupTitle(group && group.title ? group.title : "")
            if (!title.length) {
                continue
            }
            const key = normalizeAsciiText(title)
            if (!buckets[key]) {
                buckets[key] = {
                    title,
                    count: 0,
                    kind: group && group.kind ? group.kind : "live"
                }
                output.push(buckets[key])
            }
            buckets[key].count += Number(group && group.count ? group.count : 0)
        }
        return output
    }

    function shouldRenderLiveSubgroupAllChip() {
        const selectedCountryCode =
            parseLiveCountryCodeFromFilter(selectedLiveGroup)
            || parseLiveCountryCodeFromExplicitGroupTitle(selectedLiveGroup)
            || parseLiveCountryCodeFromGroupPrefix(selectedLiveGroup)
        if (selectedCountryCode) {
            return true
        }

        const selectedCountryFamily =
            parseLiveCountryFamilyFromFilter(selectedLiveGroup)
            || parseLiveCountryFamilyFromGroupTitle(selectedLiveGroup)
        if (!selectedCountryFamily) {
            return false
        }

        const groups = normalizedLiveGroupsData()
        for (let index = 0; index < groups.length; index += 1) {
            const title = safeText(groups[index].title)
            if (!title.length) {
                continue
            }
            if (parseLiveCountryCodeFromExplicitGroupTitle(title) || parseLiveCountryCodeFromGroupPrefix(title)) {
                continue
            }
            if (normalizeLiveCountryFamilyKey(title) === selectedCountryFamily) {
                return true
            }
        }
        return false
    }

    function countKeywordMatches(text, keywords) {
        let score = 0
        for (let index = 0; index < keywords.length; index += 1) {
            if (text.indexOf(keywords[index]) !== -1) {
                score += 1
            }
        }
        return score
    }

    function isBeinVipChannel(item) {
        const text = normalizeText(`${item.title || ""} ${item.groupTitle || ""}`)
        return /be[\s.-]*in/.test(text) && /(spor|sport|sports)/.test(text) && /vip/.test(text)
    }

    function isBeinSportsChannel(item) {
        const text = normalizeText(`${item.title || ""} ${item.groupTitle || ""}`)
        return /be[\s.-]*in/.test(text) && /(spor|sport|sports)/.test(text)
    }

    function getLiveSelectionScore(item, preferSports) {
        const text = normalizeText(`${item.title || ""} ${item.groupTitle || ""}`)
        const playbackScore = item.playbackAllowed ? 180 : -220
        const healthScore = item.healthStatus === "healthy"
            ? 90
            : item.healthStatus === "degraded"
                ? 24
                : !item.healthStatus || item.healthStatus === "unknown"
                    ? 8
                    : -320
        const verifiedScore = item.isVerified ? 18 : 0
        const artworkScore = item.logoUrl ? 8 : 0
        const sportsScore = preferSports ? countKeywordMatches(text, ["spor", "sports", "sport", "futbol", "mac", "lig"]) * 24 : 0
        const beinScore = preferSports ? (isBeinVipChannel(item) ? 260 : isBeinSportsChannel(item) ? 140 : 0) : 0
        return playbackScore + healthScore + verifiedScore + artworkScore + sportsScore + beinScore
    }

    function getPreferredLiveItem(items) {
        if (!items.length) {
            return null
        }
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].playbackAllowed !== false) {
                return items[index]
            }
        }
        return items[0]
    }

    function applyLiveFilters(search, group) {
        const normalizedSearch = safeText(search)
        const normalizedGroup = group === "__all__" ? "" : (safeText(group).length ? safeText(group) : buildLiveCountryFilter("TR"))
        liveSearchText = normalizedSearch
        selectedLiveGroup = normalizedGroup
        apiClient.fetchLiveCatalog(1, 300, normalizedSearch, normalizedGroup)
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

    function applyMovieFilters(search, group) {
        const normalizedSearch = safeText(search)
        const normalizedGroup = safeText(group)
        moviesSearchText = normalizedSearch
        selectedMovieGroup = normalizedGroup
        apiClient.fetchMovieCatalog(1, 120, normalizedSearch, normalizedGroup)
    }

    function firstPlayable(items) {
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].playbackAllowed !== false) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
    }

    function homeFeaturedMovies(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const items = apiClient.movies || []
        const playable = []
        const locked = []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].playbackAllowed === false) {
                locked.push(items[index])
            } else {
                playable.push(items[index])
            }
        }
        return playable.concat(locked).slice(0, maxItems)
    }

    function shuffledItems(items) {
        const output = []
        for (let index = 0; index < (items || []).length; index += 1) {
            output.push(items[index])
        }
        for (let index = output.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1))
            const current = output[index]
            output[index] = output[swapIndex]
            output[swapIndex] = current
        }
        return output
    }

    function isTurkishLivePreviewItem(item) {
        const directCode = normalizeLiveCountryCode(
            fieldText(item, "countryCode")
            || fieldText(item, "country_code")
            || fieldText(item, "country")
        )
        if (directCode) {
            return directCode === "TR"
        }

        const groupTitle = fieldText(item, "groupTitle")
        const title = fieldText(item, "title")
        const groupFilterCode = parseLiveCountryCodeFromFilter(groupTitle)
        if (groupFilterCode) {
            return groupFilterCode === "TR"
        }

        const prefixedGroupCode = parseLiveCountryCodeFromGroupPrefix(groupTitle)
        if (prefixedGroupCode) {
            return prefixedGroupCode === "TR"
        }

        const prefixedTitleCode = parseLiveCountryCodeFromGroupPrefix(title)
        if (prefixedTitleCode) {
            return prefixedTitleCode === "TR"
        }

        const normalizedHaystack = normalizeAsciiText(`${groupTitle} ${title}`)
        return normalizedHaystack.indexOf("turkiye") !== -1 || normalizedHaystack.indexOf("turkey") !== -1
    }

    function buildRandomMoviePreview(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const items = apiClient.movies || []
        const playable = []
        const locked = []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].playbackAllowed === false) locked.push(items[index])
            else playable.push(items[index])
        }
        return shuffledItems(playable).concat(shuffledItems(locked)).slice(0, maxItems)
    }

    function homeSeriesPreviewItems(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const items = apiClient.series || []
        const preferred = []
        const fallback = []
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index]
            const featuredEpisode = fieldValue(item, "featuredEpisode", null)
            if (featuredEpisode && fieldText(featuredEpisode, "id").length && fieldValue(featuredEpisode, "playbackAllowed", false) !== false) {
                preferred.push(item)
            } else {
                fallback.push(item)
            }
        }
        return preferred.concat(fallback).slice(0, maxItems)
    }

    function buildRandomSeriesPreview(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const items = apiClient.series || []
        const playable = []
        const fallback = []
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index]
            const featuredEpisode = fieldValue(item, "featuredEpisode", null)
            if (featuredEpisode && fieldText(featuredEpisode, "id").length && fieldValue(featuredEpisode, "playbackAllowed", false) !== false) {
                playable.push(item)
            } else {
                fallback.push(item)
            }
        }
        return shuffledItems(playable).concat(shuffledItems(fallback)).slice(0, maxItems)
    }

    function homeLivePreviewItems(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const sourceItems = apiClient.liveChannels || []
        const items = []
        for (let index = 0; index < sourceItems.length; index += 1) {
            if (isTurkishLivePreviewItem(sourceItems[index])) {
                items.push(sourceItems[index])
            }
        }
        const playable = []
        const locked = []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].playbackAllowed === false) {
                locked.push(items[index])
            } else {
                playable.push(items[index])
            }
        }
        return playable.concat(locked).slice(0, maxItems)
    }

    function buildRandomLivePreview(limit) {
        const maxItems = Math.max(1, Number(limit) || 12)
        const sourceItems = apiClient.liveChannels || []
        const turkishItems = []
        for (let index = 0; index < sourceItems.length; index += 1) {
            if (isTurkishLivePreviewItem(sourceItems[index])) {
                turkishItems.push(sourceItems[index])
            }
        }
        const playable = []
        const locked = []
        for (let index = 0; index < turkishItems.length; index += 1) {
            if (turkishItems[index].playbackAllowed === false) locked.push(turkishItems[index])
            else playable.push(turkishItems[index])
        }
        return shuffledItems(playable).concat(shuffledItems(locked)).slice(0, maxItems)
    }

    function refreshHomePreviewContent() {
        homeMoviePreviewCache = buildRandomMoviePreview(12)
        homeSeriesPreviewCache = buildRandomSeriesPreview(12)
        homeLivePreviewCache = buildRandomLivePreview(12)
    }

    function homeMovieSections(maxSections, itemsPerSection) {
        const sectionLimit = Math.max(1, Number(maxSections) || 3)
        const itemLimit = Math.max(1, Number(itemsPerSection) || 10)
        const groups = apiClient.movieGroups || []
        const movies = apiClient.movies || []
        const sections = []
        const usedGroups = {}

        for (let index = 0; index < groups.length; index += 1) {
            const title = safeText(groups[index].title)
            const normalizedTitle = normalizeText(title)
            if (!normalizedTitle.length || usedGroups[normalizedTitle]) {
                continue
            }
            usedGroups[normalizedTitle] = true

            const items = []
            for (let movieIndex = 0; movieIndex < movies.length; movieIndex += 1) {
                const movie = movies[movieIndex]
                if (normalizeText(movie.groupTitle) !== normalizedTitle) {
                    continue
                }
                items.push(movie)
                if (items.length >= itemLimit) {
                    break
                }
            }

            if (!items.length) {
                continue
            }

            sections.push({
                key: normalizedTitle,
                title: title,
                items
            })

            if (sections.length >= sectionLimit) {
                break
            }
        }

        return sections
    }

    function filterItems(items, search, group) {
        const searchText = normalizeText(search)
        const groupText = normalizeText(group)
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index]
            const haystack = normalizeText(`${fieldText(item, "title")} ${fieldText(item, "groupTitle")}`)
            if (searchText.length && haystack.indexOf(searchText) === -1) {
                continue
            }
            if (groupText.length && normalizeText(fieldText(item, "groupTitle")) !== groupText) {
                continue
            }
            output.push(item)
        }
        return output
    }

    function matchesFilter(item, search, group) {
        if (!item) {
            return false
        }
        const searchText = normalizeText(search)
        const groupText = normalizeText(group)
        const haystack = normalizeText(`${fieldText(item, "title")} ${fieldText(item, "groupTitle")}`)
        if (searchText.length && haystack.indexOf(searchText) === -1) {
            return false
        }
        if (groupText.length && normalizeText(fieldText(item, "groupTitle")) !== groupText) {
            return false
        }
        return true
    }

    function filteredMovies() { return filterItems(apiClient.movies || [], moviesSearchText, selectedMovieGroup) }
    function filteredSeries() { return filterItems(apiClient.series || [], seriesSearchText, selectedSeriesGroup) }
    function filteredLiveItems() { return apiClient.liveChannels || [] }

    function selectedMovie() {
        const items = apiClient.movies || []
        for (let index = 0; index < items.length; index += 1) {
            const itemId = fieldText(items[index], "id")
            if (itemId === selectedMovieId) {
                return items[index]
            }
        }
        return null
    }

    function syncSelectedLiveSelection() {
        const items = filteredLiveItems()
        if (!items.length) {
            selectedLiveId = ""
            return
        }

        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedLiveId) {
                return
            }
        }

        const preferred = getPreferredLiveItem(items)
        if (!safeText(liveSearchText).length && preferred && preferred.id) {
            selectedLiveId = preferred.id
            return
        }

        selectedLiveId = items[0].id
    }

    function selectedSeries() {
        const items = apiClient.series || []
        for (let index = 0; index < items.length; index += 1) {
            if (fieldText(items[index], "id") === selectedSeriesId) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
    }

    function featuredMovieItem() {
        const preferred = selectedMovie()
        if (preferred && matchesFilter(preferred, moviesSearchText, selectedMovieGroup)) {
            return preferred
        }
        return firstPlayable(filteredMovies())
    }

    function seriesLeadEpisode(series) {
        if (!series) {
            return null
        }
        const featuredEpisode = fieldValue(series, "featuredEpisode", null)
        if (featuredEpisode && fieldText(featuredEpisode, "id").length) {
            return featuredEpisode
        }
        const seasons = fieldList(series, "seasons")
        for (let seasonIndex = 0; seasonIndex < seasons.length; seasonIndex += 1) {
            const episodes = fieldList(seasons[seasonIndex], "episodes")
            for (let episodeIndex = 0; episodeIndex < episodes.length; episodeIndex += 1) {
                if (episodes[episodeIndex] && fieldText(episodes[episodeIndex], "id").length) {
                    return episodes[episodeIndex]
                }
            }
        }
        return null
    }

    function featuredSeriesItem() {
        const preferred = selectedSeries()
        if (preferred && matchesFilter(preferred, seriesSearchText, selectedSeriesGroup)) {
            return preferred
        }
        const items = filteredSeries()
        return items.length ? items[0] : null
    }

    function seriesTotalEpisodes(series) {
        if (!series) {
            return 0
        }
        const explicitCount = fieldNumber(series, "episodeCount", 0)
        if (explicitCount > 0) {
            return explicitCount
        }
        const seasons = fieldList(series, "seasons")
        let total = 0
        for (let index = 0; index < seasons.length; index += 1) {
            total += fieldNumber(seasons[index], "episodeCount", fieldList(seasons[index], "episodes").length)
        }
        return total
    }

    function selectedLiveItem() {
        const items = filteredLiveItems()
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedLiveId) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
    }
    
    function featuredSeriesEpisodes() {
        const series = apiClient.series || []
        const output = []
        for (let index = 0; index < series.length; index += 1) {
            const item = series[index]
            const featuredEpisode = fieldValue(item, "featuredEpisode", null)
            const seasons = fieldList(item, "seasons")
            const firstSeasonEpisodes = seasons.length ? fieldList(seasons[0], "episodes") : []
            const episode = featuredEpisode && fieldText(featuredEpisode, "id").length
                          ? featuredEpisode
                          : firstSeasonEpisodes.length
                            ? firstSeasonEpisodes[0]
                            : null
            if (!episode) {
                continue
            }
            output.push({
                id: fieldText(episode, "id"),
                kind: "episode",
                title: fieldText(item, "title"),
                subtitle: `${fieldNumber(item, "seasonCount", 0)} sezon - ${fieldNumber(item, "episodeCount", 0)} bölüm`,
                posterUrl: fieldText(item, "posterUrl"),
                playbackAllowed: Boolean(fieldValue(episode, "playbackAllowed", false)),
                seriesId: fieldText(item, "id")
            })
        }
        return output
    }

    function homeHeroItem() {
        const featuredMovies = homeFeaturedMovies(1)
        if (featuredMovies.length) {
            const movie = featuredMovies[0]
            return {
                id: movie.id,
                kind: "movie",
                title: movie.title,
                subtitle: movie.groupTitle || "Film seçimi",
                posterUrl: movie.posterUrl,
                playbackAllowed: movie.playbackAllowed
            }
        }

        const episodes = featuredSeriesEpisodes()
        if (episodes.length) {
            return firstPlayable(episodes)
        }

        const liveItems = apiClient.liveChannels || []
        if (liveItems.length) {
            const live = firstPlayable(liveItems)
            return {
                id: live.id,
                kind: "live",
                title: live.title,
                subtitle: live.groupTitle || "Canlı TV",
                logoUrl: live.logoUrl,
                playbackAllowed: live.playbackAllowed
            }
        }
        return null
    }

    function paymentMethods() {
        const items = apiClient.paymentMethods || []
        const output = []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].enabled) {
                output.push(items[index])
            }
        }
        return output
    }

    function selectedPaymentMethod() {
        const items = paymentMethods()
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedPaymentMethodId) {
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
        selectedPaymentMethodId = methodId || ""
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
                if ((assets[index].id || "").toString() === selectedCryptoAssetId) {
                    return
                }
            }
        }

        selectedCryptoAssetId = (assets[0].id || "").toString()
    }

    function paymentAmountLabel(packageData) {
        const raw = packageData && packageData.priceLabel ? packageData.priceLabel.toString().trim() : ""
        if (!raw.length) return "-"
        const uppercase = raw.toUpperCase()
        if (raw.indexOf("₺") !== -1 || uppercase.indexOf("TL") !== -1) return raw
        return `${raw} TL`
    }

    function paymentAccountCode() {
        const user = userData()
        return (user.kryptoniteCode || user.code || user.id || "-").toString()
    }

    function paymentCryptoAssets() {
        const method = selectedPaymentMethod()
        if (!method || method.id !== "crypto") return []

        const assets = method.cryptoAssets || []
        const output = []
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index]
            if (asset.walletAddress && asset.walletAddress.toString().trim().length) {
                output.push(asset)
            }
        }
        return output
    }

    function selectedCryptoAsset() {
        const assets = paymentCryptoAssets()
        if (!assets.length) return null
        for (let index = 0; index < assets.length; index += 1) {
            if ((assets[index].id || "").toString() === selectedCryptoAssetId) {
                return assets[index]
            }
        }
        return assets[0]
    }

    function paymentCryptoAssetAccent(assetId) {
        switch ((assetId || "").toString()) {
        case "usdt-trc20":
            return "#22c55e"
        case "tron":
            return "#ef4444"
        case "sol":
            return "#8b5cf6"
        case "btc":
            return "#f59e0b"
        case "usdc":
            return "#2563eb"
        default:
            return "#f4f6fb"
        }
    }

    function paymentCryptoAssetBg(assetId) {
        switch ((assetId || "").toString()) {
        case "usdt-trc20":
            return "#10251a"
        case "tron":
            return "#261112"
        case "sol":
            return "#181327"
        case "btc":
            return "#25180f"
        case "usdc":
            return "#101a2d"
        default:
            return "#131923"
        }
    }

    function paymentCryptoAssetSymbol(asset) {
        const id = (asset && asset.id ? asset.id : "").toString()
        if (id === "usdt-trc20") return "USDT"
        if (id === "tron") return "TRX"
        if (id === "sol") return "SOL"
        if (id === "btc") return "BTC"
        if (id === "usdc") return "USDC"
        return (asset && asset.symbol ? asset.symbol : "COIN").toString()
    }

    function paymentCryptoAssetLogo(asset) {
        const id = (asset && asset.id ? asset.id : "").toString()
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

        if (method.id === "bank-transfer-eft") {
            const bank = method.bankTransfer || ({})
            const rows = [
                { key: "recipient", label: "Hesap Adi", value: (bank.recipientName || "-").toString() },
                { key: "iban", label: "IBAN", value: (bank.iban || "-").toString() },
                { key: "amount", label: "Ödenecek Tutar", value: paymentAmountLabel(pendingPackage) },
                { key: "user-code", label: "Kullanıcı Hesap Numarası", value: paymentAccountCode() }
            ]
            if (bank.bankName && bank.bankName.toString().trim().length) {
                rows.splice(1, 0, { key: "bank-name", label: "Banka", value: bank.bankName.toString() })
            }
            return rows
        }

        if (method.id === "crypto") {
            const asset = selectedCryptoAsset()
            const rows = []
            if (asset && asset.walletAddress && asset.walletAddress.toString().trim().length) {
                rows.push({
                    key: asset.id || "crypto-wallet",
                    label: `${asset.label || asset.symbol || "Cüzdan"} Cüzdan Adresi`,
                    value: asset.walletAddress.toString()
                })
            }
            rows.push({
                key: "amount",
                label: "Ödenecek Tutar",
                value: paymentAmountLabel(pendingPackage)
            })
            rows.push({
                key: "user-code",
                label: "Kullanıcı Hesap Numarası",
                value: paymentAccountCode()
            })
            return rows
        }

        return []
    }

    function copyPaymentValue(label, value) {
        const copied = apiClient.copyText((value || "").toString())
        showToast(copied ? `${label} kopyalandı.` : `${label} kopyalanamadı.`, copied ? success : danger)
    }

    function currentPlaybackItem() {
        if (inlinePlaybackMode === "movie" || moviePlaybackController.activeContentKind === "movie") return selectedMovie() || apiClient.movieById(moviePlaybackController.activeContentId)
        if (inlinePlaybackMode === "episode" || seriesPlaybackController.activeContentKind === "episode") return apiClient.episodeById(seriesPlaybackController.activeContentId)
        if (inlinePlaybackMode === "live" || livePlaybackController.activeContentKind === "live") return apiClient.liveChannelById(livePlaybackController.activeContentId)
        return ({})
    }

    function activeAudioTrackIndex() {
        const tracks = playbackController.audioTracks || []
        for (let index = 0; index < tracks.length; index += 1) {
            if (tracks[index].id === playbackController.selectedAudioTrackId) {
                return index
            }
        }
        return tracks.length ? 0 : -1
    }

    function shouldShowBlocked() {
        const user = userData()
        return apiClient.authenticated && Boolean(user.id) && user.status === "blocked"
    }

    function shouldShowPremiumPopup() {
        const user = userData()
        const popupSuppressedOnScreen =
            currentScreen === "packages" ||
            currentScreen === "payments" ||
            currentScreen === "contact"
        return apiClient.authenticated &&
            Boolean(user.id) &&
            !user.hasActiveSubscription &&
            !pendingPackage &&
            !playerVisible &&
            !popupSuppressedOnScreen
    }
    function inlineLivePlayerVisible() {
        return currentScreen === "live" &&
            playerVisible &&
            inlinePlaybackMode === "live" &&
            selectedLiveItem() !== null &&
            selectedLiveItem().playbackAllowed !== false
    }
    function inlineMoviePlayerVisible() {
        return currentScreen === "movies" &&
            playerVisible &&
            inlinePlaybackMode === "movie" &&
            selectedMovie() !== null
    }
    function inlineEpisodePlayerVisible() {
        return currentScreen === "series-detail" &&
            playerVisible &&
            inlinePlaybackMode === "episode"
    }
    function activeInlinePlaybackVisible() {
        return inlineLivePlayerVisible() || inlineMoviePlayerVisible() || inlineEpisodePlayerVisible()
    }
    function overlayPlayerVisible() {
        return false
    }
    function lockWindowSizeForDesktop() {
        if (Qt.platform.os !== "windows") {
            return
        }
        minimumWidth = desktopBaseWidth
        minimumHeight = desktopBaseHeight
        maximumWidth = desktopBaseWidth
        maximumHeight = desktopBaseHeight
        width = desktopBaseWidth
        height = desktopBaseHeight
    }
    function unlockWindowSizeForFullscreen() {
        if (Qt.platform.os !== "windows") {
            return
        }
        minimumWidth = desktopBaseWidth
        minimumHeight = desktopBaseHeight
        maximumWidth = 16777215
        maximumHeight = 16777215
    }
    function toggleWindowFullscreen() {
        if (window.visibility === Window.FullScreen) {
            window.showNormal()
            lockWindowSizeForDesktop()
            return
        }
        unlockWindowSizeForFullscreen()
        window.showFullScreen()
    }
    function toggleMovieFullscreen() {
        if (movieFullscreen) {
            exitMovieFullscreen()
            return
        }
        movieFullscreen = true
        if (window.visibility !== Window.FullScreen) {
            movieFullscreenOwnsWindow = true
            unlockWindowSizeForFullscreen()
            window.showFullScreen()
        } else {
            movieFullscreenOwnsWindow = false
        }
        if (moviePlaybackController && moviePlaybackController.refreshVideoLayout) {
            moviePlaybackController.refreshVideoLayout()
        }
    }
    function exitMovieFullscreen() {
        movieFullscreen = false
        if (movieFullscreenOwnsWindow && window.visibility === Window.FullScreen) {
            window.showNormal()
            lockWindowSizeForDesktop()
        }
        movieFullscreenOwnsWindow = false
        if (moviePlaybackController && moviePlaybackController.refreshVideoLayout) {
            moviePlaybackController.refreshVideoLayout()
        }
    }
    function toggleSeriesFullscreen() {
        if (seriesFullscreen) {
            exitSeriesFullscreen()
            return
        }
        seriesFullscreen = true
        if (window.visibility !== Window.FullScreen) {
            seriesFullscreenOwnsWindow = true
            unlockWindowSizeForFullscreen()
            window.showFullScreen()
        } else {
            seriesFullscreenOwnsWindow = false
        }
        if (seriesPlaybackController && seriesPlaybackController.refreshVideoLayout) {
            seriesPlaybackController.refreshVideoLayout()
        }
    }
    function exitSeriesFullscreen() {
        seriesFullscreen = false
        if (seriesFullscreenOwnsWindow && window.visibility === Window.FullScreen) {
            window.showNormal()
            lockWindowSizeForDesktop()
        }
        seriesFullscreenOwnsWindow = false
        if (seriesPlaybackController && seriesPlaybackController.refreshVideoLayout) {
            seriesPlaybackController.refreshVideoLayout()
        }
    }
    function toggleVideoFullscreen() {
        if (videoFullscreen) {
            exitVideoFullscreen()
            return
        }
        videoFullscreen = true
        if (window.visibility !== Window.FullScreen) {
            videoFullscreenOwnsWindow = true
            unlockWindowSizeForFullscreen()
            window.showFullScreen()
        } else {
            videoFullscreenOwnsWindow = false
        }
        liveFullscreenRepairTimer.restart()
    }
    function exitVideoFullscreen() {
        videoFullscreen = false
        if (videoFullscreenOwnsWindow && window.visibility === Window.FullScreen) {
            window.showNormal()
            lockWindowSizeForDesktop()
        }
        videoFullscreenOwnsWindow = false
        liveFullscreenRepairTimer.restart()
    }
    function requestAppQuit() {
        if (isMacOS) {
            Qt.quit()
            return
        }
        confirmExitDialog.open()
    }
    function parseVersionParts(version) {
        const normalized = (version || "").toString().trim().split("+")[0].split("-")[0].trim()
        if (!normalized.length || !/^\d+(\.\d+){0,4}$/.test(normalized)) {
            return null
        }
        return normalized.split(".").map(part => Number(part))
    }
    function isUpdateNewerThanCurrent(latestVersion) {
        const currentParts = parseVersionParts(apiClient.appVersion || "")
        const latestParts = parseVersionParts(latestVersion || "")
        if (!currentParts || !latestParts) {
            return (latestVersion || "").toString().trim() !== (apiClient.appVersion || "").toString().trim()
        }
        const length = Math.max(currentParts.length, latestParts.length)
        for (let index = 0; index < length; index += 1) {
            const currentValue = currentParts[index] || 0
            const latestValue = latestParts[index] || 0
            if (latestValue > currentValue) return true
            if (latestValue < currentValue) return false
        }
        return false
    }
    function appUpdatePayload() { return apiClient.appUpdate || ({}) }
    function appUpdateVisible() { return Boolean(appUpdatePayload().updateAvailable && appUpdatePayload().latestVersion && isUpdateNewerThanCurrent(appUpdatePayload().latestVersion) && appUpdatePayload().latestVersion !== dismissedUpdateVersion) }
    function appUpdateBannerVisible() { return appUpdateVisible() || apiClient.updateInProgress || apiClient.updateError.length > 0 }
    function updateProgressPercent() { return Math.max(0, Math.min(100, Math.round((apiClient.updateProgress || 0) * 100))) }
    function updatePrimaryActionLabel() { return isMacOS ? "DMG İndir ve Aç" : "Güncelle ve Yeniden Başlat" }
    function updateBannerProgressText() {
        return isMacOS
            ? "İmzalı DMG indiriliyor. Hazır olduğunda Finder üzerinden açılacak."
            : "Installer indiriliyor. Hazır olunca uygulama kapanıp yeni sürüm kurulumu başlayacak."
    }
    function updateBannerIdleText() {
        return appUpdatePayload().notes || (isMacOS
            ? "Güncelleme imzalı DMG olarak indirilebilir durumda."
            : "Güncelleme uygulama içinden indirilebilir durumda.")
    }
    function platformTrialRequestNote() {
        return isMacOS ? "MacBook native cihazindan test talebi" : "Desktop native cihazindan test talebi"
    }
    function openScreen(screenName) {
        if (screenName !== "movies" && (inlinePlaybackMode === "movie" || moviePlaybackController.activeContentKind === "movie" || selectedMovieId.length > 0)) {
            closeMoviePlayer()
        }
        if (screenName !== "series-detail" && (inlinePlaybackMode === "episode" || seriesPlaybackController.activeContentKind === "episode" || selectedSeriesId.length > 0)) {
            closeVodPlayer()
        }
        if (videoFullscreen && screenName !== "live") {
            exitVideoFullscreen()
        }
        if (movieFullscreen && screenName !== "movies") {
            exitMovieFullscreen()
        }
        if (seriesFullscreen && screenName !== "series-detail") {
            exitSeriesFullscreen()
        }
        if (playerVisible && screenName !== currentScreen) {
            closeActivePlayer()
        }
        currentScreen = screenName
        if (screenName === "home") {
            const defaultLiveFilter = buildLiveCountryFilter("TR")
            const hasActiveFilters =
                safeText(moviesSearchText).length > 0 ||
                safeText(selectedMovieGroup).length > 0 ||
                safeText(seriesSearchText).length > 0 ||
                safeText(selectedSeriesGroup).length > 0 ||
                safeText(liveSearchText).length > 0 ||
                (safeText(selectedLiveGroup).length > 0 && selectedLiveGroup !== defaultLiveFilter)

            if (hasActiveFilters) {
                moviesSearchText = ""
                selectedMovieGroup = ""
                seriesSearchText = ""
                selectedSeriesGroup = ""
                liveSearchText = ""
                selectedLiveGroup = defaultLiveFilter
            }

            if (apiClient.authenticated) {
                refreshHomePreviewContent()
                apiClient.fetchAllCatalogs()
            }
        } else if (screenName === "live") {
            applyLiveFilters(liveSearchText, selectedLiveGroup)
            syncSelectedLiveSelection()
            liveAutoplayTimer.restart()
        } else if (screenName === "packages") {
            apiClient.fetchPackages()
            apiClient.fetchPaymentMethods()
        } else if (screenName === "payments") {
            apiClient.fetchPaymentRequests()
        } else if (screenName === "contact") {
            apiClient.fetchMe()
        }
    }

    onCurrentScreenChanged: {
        if (currentScreen !== "movies" && (inlinePlaybackMode === "movie" || moviePlaybackController.activeContentKind === "movie" || selectedMovieId.length > 0)) {
            closeMoviePlayer()
        }
        if (currentScreen !== "series-detail" && (inlinePlaybackMode === "episode" || seriesPlaybackController.activeContentKind === "episode")) {
            closeVodPlayer()
        }
    }

    function openSeriesDetail(seriesId) {
        if (playerVisible && currentScreen === "series-detail" && selectedSeriesId !== seriesId) {
            closeVodPlayer()
        }
        selectedSeriesId = seriesId
        currentScreen = "series-detail"
    }

    function playMovie(movie) {
        if (!movie) return
        const movieId = fieldText(movie, "id")
        if (!movieId.length) return
        if (playerVisible && (inlinePlaybackMode !== "movie" || currentScreen !== "movies")) {
            closeActivePlayer()
        }
        if (currentScreen !== "movies") {
            currentScreen = "movies"
        }
        selectedMovieId = movieId
        playerSubtitle = fieldText(movie, "groupTitle") || "Film"
        playerImageUrl = movieArtworkUrl(movie)
        playerVisible = true
        inlinePlaybackMode = "movie"
        moviePlaybackController.playVod("movie", movieId, fieldText(movie, "title"))
    }

    function closeMoviePlayer() {
        const hadMovieInlineMode = inlinePlaybackMode === "movie"
        exitMovieFullscreen()
        if (hadMovieInlineMode) {
            playerVisible = false
            inlinePlaybackMode = "none"
        }
        selectedMovieId = ""
        playerSubtitle = ""
        playerImageUrl = ""
        if (moviePlaybackController.activeContentKind === "movie" || hadMovieInlineMode) {
            moviePlaybackController.stop()
        }
    }

    function playEpisode(episode, series) {
        const episodeId = fieldText(episode, "id")
        if (!episodeId.length) return
        if (playerVisible && (inlinePlaybackMode !== "episode" || currentScreen !== "series-detail")) {
            closeActivePlayer()
        }
        const seriesId = fieldText(series, "id")
        if (seriesId.length) {
            selectedSeriesId = seriesId
        }
        if (currentScreen !== "series-detail") {
            currentScreen = "series-detail"
        }
        playerSubtitle = fieldText(series, "title") || "Dizi"
        playerImageUrl = fieldText(series, "posterUrl")
        playerVisible = true
        inlinePlaybackMode = "episode"
        seriesPlaybackController.playVod("episode", episodeId, fieldText(episode, "title") || playerSubtitle)
    }

    function playLive(channel, forceRestart) {
        if (!channel || !channel.id) return
        if (playerVisible && (inlinePlaybackMode !== "live" || currentScreen !== "live")) {
            closeActivePlayer()
        }
        if (currentScreen !== "live") {
            currentScreen = "live"
        }
        selectedLiveId = channel.id
        playerSubtitle = channel.groupTitle || "Canlı TV"
        playerImageUrl = channel.logoUrl || ""
        if (channel.playbackAllowed === false) {
            if (livePlaybackController.activeContentKind === "live") {
                livePlaybackController.stop()
            }
            playerVisible = false
            inlinePlaybackMode = "none"
            return
        }
        playerVisible = true
        inlinePlaybackMode = "live"
        livePlaybackController.videoFillMode = videoFullscreen ? "fill" : "fit"
        const sameChannel = livePlaybackController.activeContentKind === "live" && livePlaybackController.activeChannelId === channel.id
        if (sameChannel && !forceRestart) {
            return
        }
        livePlaybackController.playChannel(channel.id)
    }

    function ensureLiveAutoplay(forceRestart) {
        if (currentScreen !== "live") {
            return
        }
        const channel = selectedLiveItem()
        if (!channel || !channel.id) {
            return
        }
        playLive(channel, forceRestart)
    }

    function closeVodPlayer() {
        const hadEpisodeInlineMode = inlinePlaybackMode === "episode"
        exitSeriesFullscreen()
        if (hadEpisodeInlineMode) {
            playerVisible = false
            inlinePlaybackMode = "none"
        }
        playerSubtitle = ""
        playerImageUrl = ""
        if (seriesPlaybackController.activeContentKind === "episode" || hadEpisodeInlineMode) {
            seriesPlaybackController.stop()
        }
    }

    function closeLivePlayer() {
        const hadLiveInlineMode = inlinePlaybackMode === "live"
        if (hadLiveInlineMode) {
            playerVisible = false
            inlinePlaybackMode = "none"
        }
        if (videoFullscreen) {
            exitVideoFullscreen()
        }
        if (livePlaybackController.activeContentKind === "live" || hadLiveInlineMode) {
            livePlaybackController.stop()
        }
    }

    function closeActivePlayer() {
        if (inlinePlaybackMode === "live" || livePlaybackController.activeContentKind === "live") {
            closeLivePlayer()
            return
        }
        if (inlinePlaybackMode === "movie" || moviePlaybackController.activeContentKind === "movie") {
            closeMoviePlayer()
            return
        }
        if (inlinePlaybackMode === "episode" || seriesPlaybackController.activeContentKind === "episode") {
            closeVodPlayer()
            return
        }
        playerVisible = false
        inlinePlaybackMode = "none"
    }

    function closePlayer() {
        closeActivePlayer()
    }

    Timer {
        id: revealTimer
        interval: 132
        repeat: true
        onTriggered: {
            if (!issuedCode.length) {
                stop()
                return
            }
            scrambleSeed += revealedCount < 4 ? 5 : revealedCount < 10 ? 7 : 9
            if (revealWarmupTicks > 0) {
                revealWarmupTicks -= 1
                interval = Math.max(108, interval - 3)
                return
            }
            if (revealedCount >= issuedCode.length) {
                stop()
                return
            }
            interval = revealedCount < 4 ? 138 : revealedCount < 8 ? 154 : revealedCount < 12 ? 170 : 184
            revealedCount += 1
        }
    }

    Timer {
        id: movieSearchDebounceTimer
        interval: 280
        repeat: false
        onTriggered: applyMovieFilters(moviesSearchText, selectedMovieGroup)
    }

    Timer {
        id: toastTimer
        interval: 3200
        repeat: false
        onTriggered: toastMessage = ""
    }

    Timer {
        id: liveAutoplayTimer
        interval: 120
        repeat: false
        onTriggered: ensureLiveAutoplay(false)
    }

    Timer {
        id: liveFilterDebounceTimer
        interval: 240
        repeat: false
        onTriggered: applyLiveFilters(liveSearchText, selectedLiveGroup)
    }

    Timer {
        id: liveFullscreenRepairTimer
        interval: 220
        repeat: false
        onTriggered: {
            if (!inlineLivePlayerVisible()) {
                return
            }
            if (livePlayerShell && livePlayerShell.refreshSurfaceBinding) {
                livePlayerShell.refreshSurfaceBinding()
            } else {
                livePlaybackController.refreshVideoLayout()
            }
        }
    }

    Timer {
        id: updatePollTimer
        interval: 900000
        repeat: true
        running: apiClient.authenticated
        onTriggered: {
            if (!apiClient.updateInProgress) {
                apiClient.checkAppUpdate()
            }
        }
    }

    Timer {
        id: subscriptionRefreshTimer
        interval: 15000
        repeat: true
        running: apiClient.authenticated
        onTriggered: {
            if (apiClient.authenticated && !apiClient.restoringSession) {
                apiClient.fetchMe()
            }
        }
    }

    Connections {
        target: apiClient
        function onAuthenticatedChanged() {
            if (apiClient.authenticated) {
                if (currentScreen === "login" || currentScreen === "register") {
                    currentScreen = "home"
                }
                return
            }
            lastKnownHasActiveSubscription = false
            if (!apiClient.restoringSession) {
                currentScreen = signedOutEntryScreen(false)
            }
        }
        function onLoginSucceeded() { currentScreen = "home"; lastKnownHasActiveSubscription = false; showAuthCode = false; authCode = "" }
        function onMeChanged() {
            const user = userData()
            const hasActiveSubscription = Boolean(user && user.hasActiveSubscription)
            if (lastKnownHasActiveSubscription !== hasActiveSubscription) {
                if (hasActiveSubscription) {
                    apiClient.fetchAllCatalogs()
                    apiClient.fetchPaymentRequests()
                } else if (lastKnownHasActiveSubscription) {
                    closeActivePlayer()
                }
            }
            lastKnownHasActiveSubscription = hasActiveSubscription
        }
        function onMoviesChanged() {
            refreshHomePreviewContent()
        }
        function onAnonCodeIssued(code) { issuedCode = sanitizeCode(code); revealedCount = 0; scrambleSeed = 0; revealWarmupTicks = 8; registerAcknowledged = false; authCode = ""; showAuthCode = false; currentScreen = "register"; revealTimer.interval = 132; revealTimer.restart() }
        function onSeriesChanged() {
            refreshHomePreviewContent()
            if (!selectedSeriesId && (apiClient.series || []).length) {
                selectedSeriesId = fieldText(apiClient.series[0], "id")
            }
        }
        function onLiveChannelsChanged() {
            refreshHomePreviewContent()
            syncSelectedLiveSelection()
            if (currentScreen === "live") {
                liveAutoplayTimer.restart()
            }
        }
    function onLogoutCompleted() { currentScreen = "login"; authCode = ""; issuedCode = ""; showAuthCode = false; closeActivePlayer(); pendingPackage = null; selectedPaymentMethodId = ""; selectedCryptoAssetId = ""; lastKnownHasActiveSubscription = false }
        function onNoticeChanged() { if (apiClient.notice && apiClient.notice.length) showToast(apiClient.notice, success) }
        function onRequestFailed(context, message) { showToast(message, danger) }
    }

    component AppButton: Button {
        id: control
        property bool secondary: false
        property bool glow: false
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        implicitHeight: 56
        leftPadding: 28
        rightPadding: 28
        topPadding: 0
        bottomPadding: 0
        font.pixelSize: 15
        font.bold: true
        font.family: "Space Grotesk"
        opacity: control.enabled ? 1.0 : 0.45
        scale: control.down ? 0.97 : 1.0
        Behavior on scale { NumberAnimation { duration: 150; easing.type: Easing.OutCubic } }
        
        // Glow efekti (primary butonlar için)
        Rectangle {
            visible: !control.secondary && control.glow
            anchors.fill: parent
            anchors.margins: -4
            radius: parent.radius + 4
            color: "transparent"
            border.width: 2
            border.color: "#ff3b48"
            opacity: control.hovered && control.enabled ? 0.25 : 0
            Behavior on opacity { NumberAnimation { duration: 200 } }
        }
        
        background: Rectangle {
            id: btnBg
            readonly property bool hoverState: false
            readonly property bool pressedState: control.down && control.enabled
            radius: 8
            border.width: 1
            border.color: control.secondary
                ? (pressedState ? "#4a5568" : hoverState ? "#5a708b" : "#2d3748")
                : (pressedState ? "#ff1a25" : hoverState ? "#ff5a65" : "#e50914")
            
            // Gradient - BEYAZ OVERLAY YOK!
            gradient: Gradient {
                GradientStop {
                    position: 0.0
                    color: control.secondary
                        ? (pressedState ? "#252f3f" : hoverState ? "#2d3a4f" : "#1e293b")
                        : (pressedState ? "#b91c1c" : hoverState ? "#ef4444" : "#dc2626")
                }
                GradientStop {
                    position: 1.0
                    color: control.secondary
                        ? (pressedState ? "#1a2230" : hoverState ? "#252f3f" : "#131923")
                        : (pressedState ? "#991b1b" : hoverState ? "#dc2626" : "#b91c1c")
                }
            }
            
            // İnce iç glow (sadece üstte, beyaz değil açık renk)
            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.4
                radius: parent.radius
                gradient: Gradient {
                    GradientStop { position: 0.0; color: control.secondary ? "#30ffffff" : "#40ff7f8a" }
                    GradientStop { position: 1.0; color: "#00ffffff" }
                }
                visible: hoverState
            }
            
        }
        
        contentItem: Text {
            text: control.text
            color: control.secondary ? "#f4f6fb" : "#ffffff"
            font: control.font
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            opacity: control.enabled ? 1.0 : 0.5
        }
    }

    component BackIconButton: Button {
        id: backControl
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        implicitWidth: 58
        implicitHeight: 56
        opacity: backControl.enabled ? 1.0 : 0.45
        scale: backControl.down ? 0.97 : 1.0
        Behavior on scale { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }

        background: Rectangle {
            radius: 12
            border.width: 1
            border.color: backControl.down ? "#3b4557" : "#2a3443"
            gradient: Gradient {
                GradientStop { position: 0.0; color: backControl.down ? "#222c39" : "#1b2432" }
                GradientStop { position: 1.0; color: backControl.down ? "#161d28" : "#101722" }
            }
        }

        contentItem: Item {
            Canvas {
                anchors.centerIn: parent
                width: 22
                height: 18
                onPaint: {
                    var ctx = getContext("2d")
                    ctx.reset()
                    ctx.strokeStyle = "#f4f6fb"
                    ctx.lineWidth = 2.6
                    ctx.lineCap = "round"
                    ctx.lineJoin = "round"

                    ctx.beginPath()
                    ctx.moveTo(17, 2.5)
                    ctx.lineTo(8, 9)
                    ctx.lineTo(17, 15.5)
                    ctx.stroke()

                    ctx.beginPath()
                    ctx.moveTo(8.5, 9)
                    ctx.lineTo(20, 9)
                    ctx.stroke()
                }

                Connections {
                    target: backControl
                    function onDownChanged() { parent.requestPaint() }
                    function onEnabledChanged() { parent.requestPaint() }
                }
            }
        }
    }

    component AppField: TextField {
        implicitHeight: 54
        color: window.textPrimary
        selectedTextColor: window.textPrimary
        selectionColor: "#55e50914"
        placeholderTextColor: "#8f98a8"
        font.pixelSize: 15
        verticalAlignment: TextInput.AlignVCenter
        leftPadding: 16
        rightPadding: 16
        topPadding: Math.max(10, Math.round((height - font.pixelSize - 16) / 2))
        bottomPadding: topPadding
        background: Rectangle {
            radius: 16
            color: "#0dffffff"
            border.width: 1
            border.color: parent.activeFocus ? "#40ffffff" : window.borderSoft
        }
    }

    component CodeSegmentCard: Item {
        id: segmentCard
        property string displayText: "****"
        property real revealProgress: 0
        property bool active: false
        property bool complete: false
        property bool placeholder: false
        width: 0
        height: 72
        scale: active ? 1.028 : 1.0
        Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

        Rectangle {
            anchors.fill: parent
            radius: 18
            border.width: 1
            border.color: segmentCard.complete
                ? "#3b82f6"
                : segmentCard.active
                    ? "#60a5fa"
                    : "#1e293b"
            gradient: Gradient {
                GradientStop {
                    position: 0.0
                    color: segmentCard.complete
                        ? "#1e3a5f"
                        : segmentCard.active
                            ? "#1e3a5f"
                            : "#1e293b"
                }
                GradientStop {
                    position: 1.0
                    color: segmentCard.complete
                        ? "#0f172a"
                        : segmentCard.active
                            ? "#0f172a"
                            : "#0f172a"
                }
            }
            
            // İnce iç glow (beyaz değil, açık mavi/beyaz tonlu)
            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.4
                radius: parent.radius
                gradient: Gradient {
                    GradientStop { 
                        position: 0.0 
                        color: segmentCard.complete 
                            ? "#4060a5fa" 
                            : segmentCard.active 
                                ? "#4060a5fa" 
                                : "#20ffffff" 
                    }
                    GradientStop { position: 1.0; color: "#00ffffff" }
                }
            }
        }

        Rectangle {
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.leftMargin: 6
            anchors.bottomMargin: 6
            width: Math.max(14, (parent.width - 12) * Math.max(0, Math.min(1, segmentCard.revealProgress)))
            height: 4
            radius: 2
            color: segmentCard.complete ? "#47d7ff" : window.accentStrong
            opacity: segmentCard.placeholder ? 0.0 : (segmentCard.complete ? 0.8 : segmentCard.active ? 0.95 : 0.26)
        }

        Rectangle {
            width: parent.width - 22
            height: 2
            x: 11
            y: 12
            radius: 1
            color: "#58ffffff"
            opacity: segmentCard.active ? 0.75 : 0.0

            SequentialAnimation on y {
                loops: Animation.Infinite
                running: segmentCard.active
                NumberAnimation { from: 12; to: segmentCard.height - 14; duration: 520; easing.type: Easing.OutQuad }
                PauseAnimation { duration: 80 }
            }
        }

        Text {
            anchors.centerIn: parent
            text: segmentCard.displayText
            color: segmentCard.placeholder ? "#f7f8fb" : "#ffffff"
            font.pixelSize: segmentCard.placeholder ? 23 : 24
            font.family: "Space Grotesk"
            font.bold: true
            font.letterSpacing: segmentCard.placeholder ? 2 : 1.4
        }
    }

    component SupportLinkCard: Item {
        id: supportLink
        property string title: ""
        property string service: "whatsapp"
        property string url: ""
        property color accentColor: service === "telegram" ? "#229ed9" : "#25d366"
        property bool interactive: safeText(url).length > 0
        property string subtitle: service === "telegram" ? "Hızlı Destek" : "7/24 Anında Yanıt"
        width: 0
        height: 108
        scale: supportMouse.containsMouse && supportLink.interactive ? 1.02 : 1.0
        Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

        Rectangle {
            id: supportSurface
            anchors.fill: parent
            radius: 20
            color: supportMouse.containsMouse && supportLink.interactive ? "#1a2332" : "#131923"
            border.width: 1
            border.color: supportMouse.containsMouse && supportLink.interactive ? supportLink.accentColor : "#ffffff10"
            
            // Gradient overlay
            Rectangle {
                anchors.fill: parent
                radius: parent.radius
                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#08ffffff" }
                    GradientStop { position: 1.0; color: "#00ffffff" }
                }
            }
            
            // Glow border on hover
            Rectangle {
                anchors.fill: parent
                anchors.margins: -2
                radius: parent.radius + 2
                color: "transparent"
                border.width: 2
                border.color: supportLink.accentColor
                opacity: supportMouse.containsMouse && supportLink.interactive ? 0.2 : 0
                Behavior on opacity { NumberAnimation { duration: 200 } }
            }
            
        }

        Row {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 14

            Image {
                width: 56
                height: 56
                anchors.verticalCenter: parent.verticalCenter
                source: supportLink.service === "telegram" ? "qrc:/icons/telegram.svg" : "qrc:/icons/whatsapp.svg"
                fillMode: Image.PreserveAspectFit
                smooth: true
                antialiasing: true
            }

            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4

                Text {
                    text: supportLink.title
                    color: window.textPrimary
                    font.pixelSize: 17
                    font.family: "Space Grotesk"
                    font.bold: true
                }

                Text {
                    text: supportLink.subtitle
                    color: supportLink.accentColor
                    font.pixelSize: 12
                    font.bold: true
                    opacity: 0.9
                }
            }
        }

        MouseArea {
            id: supportMouse
            anchors.fill: parent
            enabled: supportLink.interactive
            hoverEnabled: true
            cursorShape: supportLink.interactive ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: Qt.openUrlExternally(supportLink.url)
        }
    }

    component ChipButton: Button {
        id: chip
        property bool active: false
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        implicitHeight: 42
        leftPadding: 18
        rightPadding: 18
        topPadding: 0
        bottomPadding: 0
        scale: chip.down ? 0.97 : 1.0
        Behavior on scale { NumberAnimation { duration: 150; easing.type: Easing.OutCubic } }
        background: Rectangle {
            readonly property bool hoverState: false
            readonly property bool pressedState: chip.down && chip.enabled
            radius: 8
            border.width: 1
            border.color: chip.active 
                ? (pressedState ? "#ff4757" : hoverState ? "#ff6b7a" : "#e50914")
                : (pressedState ? "#5a708b" : hoverState ? "#6b7d99" : "#3d4d63")
            
            // Gradient - KOYU RENKLER
            gradient: Gradient {
                GradientStop {
                    position: 0.0
                    color: chip.active
                        ? (pressedState ? "#b91c1c" : hoverState ? "#dc2626" : "#991b1b")
                        : (pressedState ? "#2d3a4f" : hoverState ? "#3d4d63" : "#252f3f")
                }
                GradientStop {
                    position: 1.0
                    color: chip.active
                        ? (pressedState ? "#991b1b" : hoverState ? "#b91c1c" : "#7f1d1d")
                        : (pressedState ? "#252f3f" : hoverState ? "#2d3a4f" : "#1a2230")
                }
            }
            
            // Glow EFEKTI - SADECE HOVER'DA VE KIRMIZI/TURUNCU TONLARDA
            Rectangle {
                visible: hoverState
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.35
                radius: parent.radius - 1
                gradient: Gradient {
                    GradientStop { position: 0.0; color: chip.active ? "#60ff7f8a" : "#40ff6b7a" }
                    GradientStop { position: 1.0; color: "#00ffffff" }
                }
            }
        }
        contentItem: Text {
            text: chip.text
            color: chip.active ? "#ffffff" : (chip.hovered ? "#ffffff" : "#e2e8f0")
            font.pixelSize: 13
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    component NavButton: Button {
        id: nav
        property bool active: false
        hoverEnabled: false
        focusPolicy: Qt.NoFocus
        padding: 0
        background: Rectangle {
            radius: 8
            color: nav.active ? "#15ffffff" : "#00000000"
            Behavior on color { ColorAnimation { duration: 150 } }
        }
        contentItem: Column {
            spacing: 6
            anchors.centerIn: parent
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: nav.text
                color: nav.active ? window.textPrimary : "#9aa5b8"
                font.pixelSize: 16 * fontScale
                font.bold: true
                font.family: "Space Grotesk"
                Behavior on color { ColorAnimation { duration: 140 } }
            }
            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: nav.active ? 40 : 0
                height: 3
                radius: 1.5
                color: nav.active ? window.accent : "#00000000"
                opacity: nav.active ? 1.0 : 0.0
                Behavior on width { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
                Behavior on opacity { NumberAnimation { duration: 120 } }
                Behavior on color { ColorAnimation { duration: 120 } }
            }
        }
    }

    component GlassCard: Rectangle {
        radius: 28
        color: window.panel
        border.width: 1
        border.color: window.borderSoft
    }

    component ArtworkPanel: Item {
        id: artwork
        required property string title
        property string subtitle: ""
        property string sourceUrl: ""
        property string kind: "movie"
        property string mode: "poster"
        property real cornerRadius: 28
        property bool compact: false
        readonly property string normalizedSource: window.artworkSource(sourceUrl)
        readonly property bool fallbackVisible: normalizedSource.length === 0 || artworkImage.status === Image.Null || artworkImage.status === Image.Loading || artworkImage.status === Image.Error

        Rectangle {
            anchors.fill: parent
            radius: artwork.cornerRadius
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#1de50914" }
                GradientStop { position: 0.44; color: "#11224dff" }
                GradientStop { position: 1.0; color: "#f0080b11" }
            }
        }

        Image {
            id: artworkImage
            anchors.fill: parent
            anchors.margins: artwork.mode === "logo" ? (artwork.compact ? 10 : 22) : 1
            source: artwork.normalizedSource
            fillMode: artwork.mode === "logo" ? Image.PreserveAspectFit : Image.PreserveAspectCrop
            asynchronous: true
            cache: true
            visible: artwork.normalizedSource.length > 0 && status === Image.Ready
            clip: true
        }

        Rectangle {
            anchors.fill: parent
            radius: artwork.cornerRadius
            gradient: Gradient {
                GradientStop { position: 0.0; color: artwork.compact ? "#1205070b" : "#1805070b" }
                GradientStop { position: 0.58; color: artwork.compact ? "#3205070b" : "#6405070b" }
                GradientStop { position: 1.0; color: "#f005070b" }
            }
        }

        Item {
            anchors.fill: parent
            visible: artwork.fallbackVisible && artwork.compact

            Rectangle {
                width: Math.min(parent.width - 8, parent.height - 8)
                height: width
                radius: Math.max(16, width / 3)
                anchors.centerIn: parent
                color: "#1affffff"
                border.width: 1
                border.color: "#2affffff"

                Text {
                    anchors.centerIn: parent
                    text: window.artworkMonogram(artwork.title)
                    color: window.textPrimary
                    font.pixelSize: Math.max(16, parent.width * 0.34)
                    font.family: "Space Grotesk"
                    font.bold: true
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: artwork.fallbackVisible && !artwork.compact

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 20
                spacing: 10

                Rectangle {
                    width: 72
                    height: 72
                    radius: 22
                    color: "#16ffffff"
                    border.width: 1
                    border.color: "#26ffffff"

                    Text {
                        anchors.centerIn: parent
                        text: window.artworkMonogram(artwork.title)
                        color: window.textPrimary
                        font.pixelSize: 28
                        font.family: "Space Grotesk"
                        font.bold: true
                    }
                }

                Text {
                    text: artwork.title
                    width: parent.width
                    wrapMode: Text.WordWrap
                    maximumLineCount: artwork.mode === "logo" ? 3 : 2
                    elide: Text.ElideRight
                    color: window.textPrimary
                    font.pixelSize: artwork.mode === "logo" ? 24 : 28
                    font.family: "Space Grotesk"
                    font.bold: true
                }

                Text {
                    text: artwork.subtitle.length ? artwork.subtitle : window.artworkLabel(artwork.kind)
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: "#d4dbe8"
                    font.pixelSize: 13
                    visible: text.length > 0
                }
            }
        }
    }

    component HomeContentSection: Column {
        id: section
        property string title: ""
        property var items: []
        property string kind: "movie"
        signal itemClicked(var item)
        signal seeAll()
        
        width: parent.width
        spacing: 16
        visible: items.length > 0
        
        Row {
            width: parent.width
            spacing: 12
            
            Text { 
                text: section.title
                color: window.textPrimary
                font.pixelSize: 26
                font.family: "Space Grotesk"
                font.bold: true
            }
            
            Item { width: 1; height: 1; Layout.fillWidth: true }
            
            AppButton { 
                text: "Tümünü Gör"; 
                secondary: true; 
                implicitWidth: 110; 
                onClicked: section.seeAll()
            }
        }
        
        ListView {
            width: parent.width
            height: 400
            orientation: ListView.Horizontal
            spacing: 18
            clip: true
            model: section.items
            
            delegate: RailCard {
                item: modelData
                cardKind: section.kind
                onActivated: section.itemClicked(modelData)
            }
        }
    }

    component RailCard: Item {
        id: rail
        required property var item
        required property string cardKind
        signal activated(var item)
        width: window.railCardWidth
        height: window.railCardHeight

        Rectangle {
            anchors.fill: parent
            radius: 28
            color: "#0a0e16"
            border.width: 1
            border.color: "#14ffffff"
        }

        ArtworkPanel {
            anchors.fill: parent
            title: rail.item.title || ""
            subtitle: rail.item.subtitle || rail.item.groupTitle || ""
            sourceUrl: rail.item.posterUrl || rail.item.logoUrl || ""
            mode: rail.cardKind === "live" ? "logo" : "poster"
            kind: rail.cardKind
            cornerRadius: 28
        }

        Rectangle {
            anchors.fill: parent
            radius: 28
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#1105070b" }
                GradientStop { position: 0.62; color: "#6605070b" }
                GradientStop { position: 1.0; color: "#f005070b" }
            }
        }

        Column {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 10

            Rectangle {
                width: 64
                height: 32
                radius: 16
                color: "#14ffffff"
                visible: rail.cardKind !== "live"
                Text {
                    anchors.centerIn: parent
                    text: rail.cardKind === "movie" ? "Film" : "Dizi"
                    color: window.textPrimary
                    font.pixelSize: 12
                    font.bold: true
                }
            }

            Item { width: 1; height: 1 }

            Text {
                text: rail.item.title || ""
                width: parent.width
                wrapMode: Text.WordWrap
                color: window.textPrimary
                font.pixelSize: 28
                font.family: "Space Grotesk"
                font.bold: true
            }

            Text {
                text: rail.item.subtitle || rail.item.groupTitle || ""
                width: parent.width
                wrapMode: Text.WordWrap
                color: window.textMuted
                font.pixelSize: 14
                visible: text.length > 0
            }

            Rectangle {
                width: 132
                height: 34
                radius: 17
                color: rail.item.playbackAllowed ? "#2b30d19d" : "#14ffffff"
                Text {
                    anchors.centerIn: parent
                    text: rail.item.playbackAllowed ? "Hazır" : "Paket Gerekli"
                    color: rail.item.playbackAllowed ? "#82ecc4" : window.textPrimary
                    font.pixelSize: 12
                    font.bold: true
                }
            }
        }

        MouseArea {
            anchors.fill: parent
            onClicked: rail.activated(rail.item)
        }
    }

    component PosterGridCard: Item {
        id: posterCard
        property string titleText: ""
        property string subtitleText: ""
        property string artworkUrl: ""
        property bool playbackAllowed: false
        property var payload: ({})
        property string cardKind: "movie"
        signal activated(var item)
        width: window.posterCardWidth
        readonly property real visualHeight: Math.round(window.posterCardWidth * 1.46)
        height: visualHeight + 72
        scale: posterMouse.pressed ? 0.986 : posterMouse.containsMouse ? 1.018 : 1.0
        opacity: posterCard.playbackAllowed ? 1.0 : 0.86
        Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

        Rectangle {
            id: posterVisual
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: posterCard.visualHeight
            radius: 24
            color: "#0a0e16"
            border.width: 1
            border.color: posterMouse.containsMouse ? "#36ffffff" : "#18ffffff"
            layer.enabled: true
            layer.samples: 4
        }

        ArtworkPanel {
            anchors.fill: posterVisual
            title: posterCard.titleText
            subtitle: posterCard.subtitleText
            sourceUrl: posterCard.artworkUrl
            mode: posterCard.cardKind === "live" ? "logo" : "poster"
            kind: posterCard.cardKind
            cornerRadius: 24
        }

        Rectangle {
            anchors.fill: posterVisual
            radius: 24
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#04070b08" }
                GradientStop { position: 0.72; color: "#1405070b" }
                GradientStop { position: 1.0; color: "#4205070b" }
            }
        }

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 58
            radius: 22
            color: "#0c1119"
            border.width: 1
            border.color: posterMouse.containsMouse ? "#2a3142" : "#1b2534"

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 1
                height: parent.height * 0.48
                radius: parent.radius
                color: "#ffffff"
                opacity: posterMouse.containsMouse ? 0.07 : 0.04
            }

            Column {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 4

                Text {
                    text: posterCard.titleText
                    width: parent.width
                    wrapMode: Text.WordWrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    color: window.textPrimary
                    font.pixelSize: 17
                    font.family: "Space Grotesk"
                    font.bold: true
                }

                Text {
                    text: posterCard.subtitleText
                    width: parent.width
                    wrapMode: Text.WordWrap
                    maximumLineCount: 1
                    elide: Text.ElideRight
                    color: window.textMuted
                    font.pixelSize: 12
                    visible: text.length > 0
                }
            }
        }

        MouseArea {
            id: posterMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: posterCard.activated(posterCard.payload)
        }
    }

    // ========== LIVE TV PLAYER CONTROL COMPONENTS ==========
    
    
    
    

    

    Component {
        id: vodVideoSurfaceComponent
        Item {
            property int slotIndex: 0
            property var controller: playbackController
            signal pointerActivity()
            anchors.fill: parent

            function syncSurfaceBinding() {
                if (!controller) {
                    return
                }
                controller.setVideoSurfaceHandle(slotIndex, nativeVideoSurface.surfaceHandle)
                controller.setVideoSurfaceGeometry(slotIndex, nativeVideoSurface.width, nativeVideoSurface.height)
            }

            onSlotIndexChanged: syncSurfaceBinding()

            NativeVideoSurface {
                id: nativeVideoSurface
                anchors.fill: parent
                anchors.margins: 0
                mousePassthrough: true
                frontSurface: parent.controller ? parent.controller.activeVideoSlot === parent.slotIndex : false
                onSurfaceHandleChanged: parent.syncSurfaceBinding()
                onWidthChanged: parent.syncSurfaceBinding()
                onHeightChanged: parent.syncSurfaceBinding()
                onPointerActivity: parent.pointerActivity()
                Component.onCompleted: parent.syncSurfaceBinding()
            }
        }
    }

    Component {
        id: liveVideoSurfaceComponent
        Item {
            property int slotIndex: 0
            property var controller: livePlaybackController
            signal pointerActivity()
            anchors.fill: parent

            function syncSurfaceBinding() {
                if (!controller) {
                    return
                }
                controller.setVideoSurfaceHandle(slotIndex, nativeVideoSurface.surfaceHandle)
                controller.setVideoSurfaceGeometry(slotIndex, nativeVideoSurface.width, nativeVideoSurface.height)
            }

            onSlotIndexChanged: syncSurfaceBinding()

            NativeVideoSurface {
                id: nativeVideoSurface
                anchors.fill: parent
                anchors.margins: 0
                mousePassthrough: true
                frontSurface: parent.controller ? parent.controller.activeVideoSlot === parent.slotIndex : false
                onSurfaceHandleChanged: parent.syncSurfaceBinding()
                onWidthChanged: parent.syncSurfaceBinding()
                onHeightChanged: parent.syncSurfaceBinding()
                onPointerActivity: parent.pointerActivity()
                Component.onCompleted: parent.syncSurfaceBinding()
            }
        }
    }

    Component {
        id: inlineVodPlayerComponent
        GlassCard {
            color: "#090c13"
            implicitHeight: window.compactWindow ? 760 : 820

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 14

                RowLayout {
                    Layout.fillWidth: true

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 4

                        Text {
                            text: playbackKindLabel(playbackController.activeContentKind)
                            color: "#c7ffffff"
                            font.pixelSize: 12
                            font.bold: true
                        }

                        Text {
                                            text: playbackController.activeTitle.length ? playbackController.activeTitle : "Player Hazır"
                            color: window.textPrimary
                            font.pixelSize: window.compactWindow ? 26 : 32
                            font.family: "Space Grotesk"
                            font.bold: true
                            Layout.fillWidth: true
                            elide: Text.ElideRight
                        }

                        Text {
                            text: playerSubtitle
                            color: window.textMuted
                            font.pixelSize: 14
                            visible: text.length > 0
                            Layout.fillWidth: true
                            elide: Text.ElideRight
                        }
                    }

                    AppButton {
                        text: "Kapat"
                        secondary: true
                        implicitWidth: 120
                        onClicked: closeVodPlayer()
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 16

                    GlassCard {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: "#000000"

                        Item {
                            anchors.fill: parent

                            Loader {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.top: parent.top
                                anchors.bottom: parent.bottom
                                anchors.margins: 6
                                anchors.bottomMargin: Number(inlineVodControls.implicitHeight) + 48
                                active: true
                                sourceComponent: vodVideoSurfaceComponent

                                onLoaded: {
                                    if (item) {
                                        item.controller = playbackController
                                        item.slotIndex = 0
                                        if (item.syncSurfaceBinding) {
                                            item.syncSurfaceBinding()
                                        }
                                    }
                                }
                            }

                            Rectangle {
                                anchors.centerIn: parent
                                width: Math.min(parent.width - 48, window.compactWindow ? 320 : 420)
                                height: window.compactWindow ? 250 : 280
                                radius: 26
                                color: "#dc090c13"
                                border.width: 1
                                border.color: "#24ffffff"
                                visible: playbackController.state === "error"

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 22
                                    spacing: 12

                                    Rectangle {
                                        width: 64
                                        height: 64
                                        radius: 22
                                        color: "#16ffffff"
                                        border.width: 1
                                        border.color: "#24ffffff"

                                        Text {
                                            anchors.centerIn: parent
                                            text: window.artworkMonogram(playbackController.activeTitle)
                                            color: window.textPrimary
                                            font.pixelSize: 26
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }
                                    }

                                    Text {
                                        text: "VOD kaynağı açılamadı"
                                        color: window.textPrimary
                                        font.pixelSize: 26
                                        font.family: "Space Grotesk"
                                        font.bold: true
                                    }

                                    Text {
                                        width: parent.width
                                        wrapMode: Text.WordWrap
                                        text: playbackController.lastError.length ? playbackController.lastError : "Kaynak geçici olarak hazırlanamadı."
                                        color: "#ffb2b8"
                                        font.pixelSize: 14
                                    }

                                    Flow {
                                        width: parent.width
                                        spacing: 10

                                        AppButton {
                                            text: "Tekrar Dene"
                                            implicitWidth: 132
                                            onClicked: playbackController.retryCurrent()
                                        }

                                        AppButton {
                                            text: "Kapat"
                                            secondary: true
                                            implicitWidth: 118
                                            onClicked: closeVodPlayer()
                                        }
                                    }
                                }
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.top: parent.top
                                anchors.margins: 18
                                width: inlineVodStateLabel.implicitWidth + 28
                                height: 40
                                radius: 8
                                color: "#c7070a0f"
                                border.width: 1
                                border.color: "#12ffffff"

                                Text {
                                    id: inlineVodStateLabel
                                    anchors.centerIn: parent
                                    text: playbackController.state === "buffering" ? "Buffer dolduruluyor" :
                                          playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazırlanıyor" :
                                          playbackController.state === "error" ? "Yayın açılamadı" :
                                          playbackController.state === "playing" ? "Oynuyor" : "Hazır"
                                    color: window.textPrimary
                                    font.pixelSize: 13
                                    font.bold: true
                                }
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                anchors.margins: 16
                                height: inlineVodControls.implicitHeight + 28
                                radius: 8
                                color: "#c7070a0f"
                                border.width: 1
                                border.color: "#12ffffff"

                                Column {
                                    id: inlineVodControls
                                    anchors.fill: parent
                                    anchors.margins: 14
                                    spacing: 14

                                    Row {
                                        width: parent.width
                                        spacing: 12

                                        Text {
                                            text: formatPlaybackClock(playbackController.positionSeconds)
                                            color: window.textPrimary
                                            font.pixelSize: 13
                                            font.bold: true
                                        }

                                        Rectangle {
                                            width: Math.max(120, parent.width - 260)
                                            height: 6
                                            radius: 3
                                            anchors.verticalCenter: parent.verticalCenter
                                            color: "#24ffffff"

                                            Rectangle {
                                                width: parent.width * playbackProgressRatio()
                                                height: parent.height
                                                radius: parent.radius
                                                color: window.accentStrong
                                            }
                                        }

                                        Text {
                                            text: formatPlaybackClock(playbackController.durationSeconds)
                                            color: window.textMuted
                                            font.pixelSize: 13
                                            font.bold: true
                                        }
                                    }

                                    Flow {
                                        width: parent.width
                                        spacing: 12

                                        AppButton {
                                            text: playbackController.paused ? "Oynat" : "Durdur"
                                            secondary: true
                                            implicitWidth: 118
                                            onClicked: playbackController.togglePause()
                                        }

                                        AppButton {
                                            text: "-10 sn"
                                            secondary: true
                                            implicitWidth: 102
                                            onClicked: playbackController.seekBy(-10)
                                        }

                                        AppButton {
                                            text: "+10 sn"
                                            secondary: true
                                            implicitWidth: 102
                                            onClicked: playbackController.seekBy(10)
                                        }

                                        AppButton {
                                            text: "Tekrar Dene"
                                            secondary: true
                                            implicitWidth: 126
                                            onClicked: playbackController.retryCurrent()
                                        }

                                        AppButton {
                                            text: "Sonraki Bölüm"
                                            implicitWidth: 154
                                            visible: Boolean(playbackController.recommendedNextEpisode.id)
                                            enabled: visible
                                            onClicked: playbackController.playRecommendedNextEpisode()
                                        }

                                        Row {
                                            spacing: 10

                                            Rectangle {
                                                width: 44
                                                height: 44
                                                radius: 22
                                                color: "#16ffffff"
                                                border.width: 1
                                                border.color: "#1effffff"

                                                Canvas {
                                                    anchors.fill: parent
                                                    anchors.margins: 11
                                                    antialiasing: true
                                                    onPaint: {
                                                        const ctx = getContext("2d")
                                                        ctx.reset()
                                                        ctx.clearRect(0, 0, width, height)
                                                        ctx.fillStyle = "#ffffff"
                                                        ctx.strokeStyle = "#ffffff"
                                                        ctx.lineWidth = 2.2
                                                        ctx.lineCap = "round"
                                                        ctx.lineJoin = "round"

                                                        ctx.beginPath()
                                                        ctx.moveTo(width * 0.14, height * 0.38)
                                                        ctx.lineTo(width * 0.34, height * 0.38)
                                                        ctx.lineTo(width * 0.54, height * 0.18)
                                                        ctx.lineTo(width * 0.54, height * 0.82)
                                                        ctx.lineTo(width * 0.34, height * 0.62)
                                                        ctx.lineTo(width * 0.14, height * 0.62)
                                                        ctx.closePath()
                                                        ctx.fill()

                                                        if (!(playbackController.muted || playbackController.volume <= 0)) {
                                                            ctx.beginPath()
                                                            ctx.arc(width * 0.58, height * 0.5, width * 0.12, -0.75, 0.75)
                                                            ctx.stroke()
                                                            ctx.beginPath()
                                                            ctx.arc(width * 0.62, height * 0.5, width * 0.2, -0.75, 0.75)
                                                            ctx.stroke()
                                                        } else {
                                                            ctx.beginPath()
                                                            ctx.moveTo(width * 0.60, height * 0.28)
                                                            ctx.lineTo(width * 0.84, height * 0.72)
                                                            ctx.stroke()
                                                        }
                                                    }
                                                }

                                                MouseArea {
                                                    anchors.fill: parent
                                                    hoverEnabled: true
                                                    cursorShape: Qt.PointingHandCursor
                                                    onClicked: playbackController.toggleMuted()
                                                }
                                            }

                                            Slider {
                                                id: inlineVodVolumeSlider
                                                width: window.compactWindow ? 120 : 160
                                                from: 0
                                                to: 1
                                                value: playbackController.muted ? 0 : playbackController.volume
                                                stepSize: 0.01
                                                onMoved: playbackController.setVolume(value)

                                                background: Rectangle {
                                                    x: inlineVodVolumeSlider.leftPadding
                                                    y: inlineVodVolumeSlider.topPadding + inlineVodVolumeSlider.availableHeight / 2 - height / 2
                                                    implicitWidth: 150
                                                    implicitHeight: 6
                                                    width: inlineVodVolumeSlider.availableWidth
                                                    height: implicitHeight
                                                    radius: 3
                                                    color: "#24ffffff"

                                                    Rectangle {
                                                        width: inlineVodVolumeSlider.visualPosition * parent.width
                                                        height: parent.height
                                                        radius: 3
                                                        color: window.accentStrong
                                                    }
                                                }

                                                handle: Rectangle {
                                                    x: inlineVodVolumeSlider.leftPadding + inlineVodVolumeSlider.visualPosition * (inlineVodVolumeSlider.availableWidth - width)
                                                    y: inlineVodVolumeSlider.topPadding + inlineVodVolumeSlider.availableHeight / 2 - height / 2
                                                    implicitWidth: 16
                                                    implicitHeight: 16
                                                    radius: 8
                                                    color: "#ffffff"
                                                    border.width: 1
                                                    border.color: "#44ffffff"
                                                }
                                            }

                                            ComboBox {
                                                width: window.compactWindow ? 170 : 220
                                                model: playbackController.audioTracks
                                                textRole: "title"
                                                enabled: playbackController.audioTracks.length > 0
                                                currentIndex: activeAudioTrackIndex()
                                                onActivated: function(index) {
                                                    const track = playbackController.audioTracks[index]
                                                    if (track && track.id) playbackController.selectAudioTrack(track.id)
                                                }
                                            }

                                            AppButton {
                                                text: window.visibility === Window.FullScreen ? "Pencereli" : "Tam Ekran"
                                                secondary: true
                                                implicitWidth: 142
                                                onClicked: toggleWindowFullscreen()
                                            }
                                        }
                                    }

                                    Text {
                                        text: playbackController.lastError
                                        color: "#ffb2b8"
                                        font.pixelSize: 13
                                        width: parent.width
                                        wrapMode: Text.WordWrap
                                        visible: playbackController.lastError.length > 0
                                    }
                                }
                            }
                        }

                        Connections {
                            target: playbackController
                            function onVolumeChanged() { inlineVodVolumeSlider.value = playbackController.muted ? 0 : playbackController.volume }
                            function onMutedChanged() { inlineVodVolumeSlider.value = playbackController.muted ? 0 : playbackController.volume }
                        }
                    }

                    GlassCard {
                        Layout.preferredWidth: window.compactWindow ? 260 : 320
                        Layout.fillHeight: true
                        color: "#090c13"

                        Column {
                            anchors.fill: parent
                            anchors.margins: 18
                            spacing: 12

                            Text {
                                text: "Yayin Bilgisi"
                                color: window.textPrimary
                                font.pixelSize: 20
                                font.family: "Space Grotesk"
                                font.bold: true
                            }

                            Rectangle {
                                width: parent.width
                                height: window.compactWindow ? 148 : 180
                                radius: 22
                                color: "#08ffffff"
                                border.width: 1
                                border.color: window.borderSoft

                                ArtworkPanel {
                                    anchors.fill: parent
                                    title: playbackController.activeTitle.length ? playbackController.activeTitle : "Flixify"
                                    subtitle: playerSubtitle
                                    sourceUrl: playerImageUrl
                                    kind: playbackController.activeContentKind || "movie"
                                    mode: playbackController.activeContentKind === "live" ? "logo" : "poster"
                                    cornerRadius: 22
                                }
                            }

                            Text {
                                text: playbackController.lastError.length ? playbackController.lastError : "Native player uygulama içinde hazır."
                                width: parent.width
                                wrapMode: Text.WordWrap
                                color: playbackController.lastError.length ? "#ffb2b8" : window.textMuted
                                font.pixelSize: 14
                            }
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#020307"

        Rectangle {
            width: parent.width * 0.42
            height: width
            x: -width * 0.25
            y: -height * 0.28
            radius: width / 2
            color: "#22e50914"
        }

        Rectangle {
            width: parent.width * 0.24
            height: width
            x: parent.width * 0.76
            y: parent.height * 0.06
            radius: width / 2
            color: "#226e4dff"
        }

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#090d16" }
                GradientStop { position: 0.38; color: "#04050b" }
                GradientStop { position: 1.0; color: "#020307" }
            }
            opacity: 0.95
        }
    }

    Item {
        anchors.fill: parent

        Item {
            anchors.fill: parent
            visible: !apiClient.authenticated && !apiClient.restoringSession

            ColumnLayout {
                anchors.centerIn: parent
                width: window.authPanelWidth
                spacing: 18

                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: authContent.implicitHeight + 44

                    Column {
                        id: authContent
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: window.compactWindow ? 22 : 28
                        spacing: 18

                        Row {
                            anchors.horizontalCenter: parent.horizontalCenter
                            spacing: 12
                            Image { width: 42; height: 42; source: "qrc:/branding/icon.png"; fillMode: Image.PreserveAspectFit }
                            Text { text: "FLIXIFY"; color: window.textPrimary; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                            Rectangle {
                                width: 58; height: 28; radius: 10; color: window.accent
                                anchors.verticalCenter: parent.verticalCenter
                                Text { anchors.centerIn: parent; text: "PRO"; color: "#ffffff"; font.pixelSize: 12; font.bold: true }
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: 8
                            
                            Text {
                                text: currentScreen === "register"
                                      ? (issuedCode.length ? "Hesabınız Oluşturuldu" : "Anonim ve Takip Edilemez")
                                      : "Güvenli Erişim"
                                color: "#ffffff"
                                font.pixelSize: 24
                                font.bold: true
                                font.family: "Space Grotesk"
                                width: parent.width
                                horizontalAlignment: Text.AlignHCenter
                            }
                            
                            Text {
                                text: currentScreen === "register" && !issuedCode.length
                                      ? "Hiçbir veriniz saklanmaz. %100 gizlilik garantisi."
                                      : "16 haneli özel erişim kodunuzu girin"
                                color: "#94a3b8"
                                font.pixelSize: 14
                                width: parent.width
                                horizontalAlignment: Text.AlignHCenter
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "login"

                            Text {
                                text: "Erişim Kodu"
                                color: window.textPrimary
                                font.pixelSize: 16
                                font.bold: true
                            }

                            Item {
                                width: parent.width
                                height: 76

                                AppField {
                                    id: authCodeField
                                    anchors.fill: parent
                                    placeholderText: "X7F2 A9B1 C4D8 E6F0"
                                    echoMode: showAuthCode ? TextInput.Normal : TextInput.Password
                                    passwordCharacter: "•"
                                    passwordMaskDelay: 0
                                    inputMethodHints: Qt.ImhUppercaseOnly | Qt.ImhPreferUppercase | Qt.ImhNoPredictiveText | Qt.ImhSensitiveData
                                    maximumLength: showAuthCode ? 19 : 16
                                    font.pixelSize: 22
                                    font.family: "Space Grotesk"
                                    font.bold: true
                                    font.letterSpacing: showAuthCode ? 1.8 : 1.2
                                    leftPadding: 24
                                    rightPadding: 102
                                    color: "#ffffff"
                                    selectByMouse: true
                                    selectionColor: "#40ffffff"
                                    selectedTextColor: "#ffffff"
                                    cursorDelegate: Rectangle {
                                        width: 2
                                        radius: 1
                                        color: window.textPrimary
                                    }
                                    background: Rectangle {
                                        radius: 18
                                        gradient: Gradient {
                                            GradientStop { position: 0.0; color: "#1a1a22" }
                                            GradientStop { position: 1.0; color: "#171921" }
                                        }
                                        border.width: 2
                                        border.color: authCodeField.activeFocus ? window.accent : "#2e3747"
                                    }
                                    Component.onCompleted: syncAuthCodeField(true)
                                    onActiveFocusChanged: {
                                        if (activeFocus) {
                                            cursorPosition = text.length
                                        }
                                    }
                                    onTextEdited: {
                                        if (authCodeFieldSyncing) {
                                            return
                                        }
                                        const rawCursorCount = sanitizeCode(text.slice(0, cursorPosition)).length
                                        const normalized = sanitizeCode(text)
                                        if (normalized !== authCode) {
                                            authCode = normalized
                                        }
                                        const nextText = showAuthCode ? formatEditableCode(normalized) : normalized
                                        const nextCursor = authCursorPositionForRawCount(rawCursorCount)
                                        if (text !== nextText || cursorPosition !== nextCursor) {
                                            authCodeFieldSyncing = true
                                            text = nextText
                                            cursorPosition = Math.min(nextCursor, nextText.length)
                                            authCodeFieldSyncing = false
                                        }
                                    }
                                }

                                Connections {
                                    target: window
                                    function onAuthCodeChanged() {
                                        syncAuthCodeField(false)
                                    }
                                    function onShowAuthCodeChanged() {
                                        syncAuthCodeField(true)
                                    }
                                }

                                Rectangle {
                                    width: 82
                                    height: 56
                                    radius: 16
                                    anchors.right: parent.right
                                    anchors.rightMargin: 11
                                    anchors.verticalCenter: parent.verticalCenter
                                    gradient: Gradient {
                                        GradientStop { position: 0.0; color: showAuthCode ? "#272b35" : "#222733" }
                                        GradientStop { position: 1.0; color: showAuthCode ? "#1e212a" : "#1a1d25" }
                                    }
                                    border.width: 1
                                    border.color: showAuthCode ? "#40ffffff" : "#26ffffff"

                                    Text {
                                        anchors.centerIn: parent
                                        text: showAuthCode ? "Gizle" : "Göster"
                                        color: "#eef3fb"
                                        font.pixelSize: 13
                                        font.bold: true
                                    }

                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            showAuthCode = !showAuthCode
                                            syncAuthCodeField(true)
                                            authCodeField.forceActiveFocus()
                                        }
                                    }
                                }
                            }

                            Row {
                                width: parent.width
                                spacing: 8
                                Repeater {
                                    model: 4
                                    Rectangle {
                                        width: (parent.width - 24) / 4
                                        height: 8
                                        radius: 4
                                        color: index < progressSegments() ? window.accent : "#14ffffff"
                                    }
                                }
                            }

                            Text { text: `${sanitizeCode(authCode).length}/16`; color: window.textMuted; width: parent.width; horizontalAlignment: Text.AlignRight }
                            Text {
                                width: parent.width
                                visible: apiClient.lastError.length > 0
                                text: apiClient.lastError
                                color: window.danger
                                wrapMode: Text.WordWrap
                                font.pixelSize: 13
                            }
                            AppButton { 
                                width: parent.width; 
                                text: apiClient.busy ? "Giriş Yapılıyor..." : "OTURUM AÇ"; 
                                glow: true;
                                enabled: !apiClient.busy && sanitizeCode(authCode).length === 16; 
                                onClicked: apiClient.loginByCode(sanitizeCode(authCode), authDeviceName) 
                            }
                            Row {
                                anchors.horizontalCenter: parent.horizontalCenter
                                spacing: 6
                                Text { text: "Hesabınız yok mu?"; color: window.textMuted; font.pixelSize: 15 }
                                Text {
                                    text: "Hesap Oluştur"
                                    color: window.accentStrong
                                    font.pixelSize: 15
                                    font.bold: true
                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            issuedCode = ""
                                            revealedCount = 0
                                            scrambleSeed = 0
                                            revealWarmupTicks = 0
                                            registerAcknowledged = false
                                            authCode = ""
                                            showAuthCode = false
                                            currentScreen = "register"
                                        }
                                    }
                                }
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "register" && !issuedCode.length

                            Rectangle {
                                width: parent.width
                                height: 178
                                radius: 24
                                color: "#0b0f17"
                                border.width: 1
                                border.color: "#1dffffff"
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: "#0f1521" }
                                    GradientStop { position: 0.54; color: "#0b0f17" }
                                    GradientStop { position: 1.0; color: "#08101a" }
                                }

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 22
                                    spacing: 20

                                    Row {
                                        width: parent.width
                                        spacing: 10
                                        Repeater {
                                            model: 4

                                            CodeSegmentCard {
                                                width: Math.floor((parent.width - 30) / 4)
                                                height: 62
                                                displayText: "* * * *"
                                                revealProgress: 0
                                                placeholder: true
                                            }
                                        }
                                    }

                                    Text {
                                        text: "Şifrelenmiş erişim anahtarınız"
                                        width: parent.width
                                        horizontalAlignment: Text.AlignHCenter
                                        color: "#64748b"
                                        font.pixelSize: 13
                                        font.letterSpacing: 0.5
                                    }
                                }
                            }

                            AppButton {
                                id: createAccountBtn
                                width: parent.width
                                implicitHeight: 60
                                text: apiClient.busy ? "Şifreli Anahtar Üretiliyor..." : "GÜVENLİ HESAP OLUŞTUR"
                                glow: true
                                enabled: !apiClient.busy
                                onClicked: apiClient.issueAnonCode(registerDeviceName)
                            }

                            AppButton {
                                width: parent.width
                                text: "Zaten Hesabım Var"
                                secondary: true
                                onClicked: {
                                    authCode = ""
                                    showAuthCode = false
                                    currentScreen = "login"
                                }
                            }

                            Row {
                                width: parent.width
                                spacing: 12
                                SupportLinkCard {
                                    width: (parent.width - 12) / 2
                                    title: "WhatsApp"
                                    service: "whatsapp"
                                    url: contactData().whatsapp || ""
                                }
                                SupportLinkCard {
                                    width: (parent.width - 12) / 2
                                    title: "Telegram"
                                    service: "telegram"
                                    url: contactData().telegram || ""
                                }
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: 14
                            visible: currentScreen === "register" && issuedCode.length > 0

                            Rectangle {
                                width: parent.width
                                height: 244
                                radius: 24
                                color: "#0b0f17"
                                border.width: 1
                                border.color: registerRevealComplete() ? "#314d70" : "#22ffffff"
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: registerRevealComplete() ? "#121b29" : "#0e121c" }
                                    GradientStop { position: 1.0; color: "#090d15" }
                                }

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 20
                                    spacing: 16

                                    Row {
                                        width: parent.width
                                        spacing: 10

                                        Text { text: "Erişim Kodunuz"; color: window.textMuted; font.pixelSize: 13; font.bold: true }
                                        Item { width: 1; height: 1 }
                                        Rectangle {
                                            width: revealStatusText.implicitWidth + 28
                                            height: 32
                                            radius: 16
                                            color: registerRevealComplete() ? "#15374f" : "#1ae50914"
                                            border.width: 1
                                            border.color: registerRevealComplete() ? "#2b688c" : "#24ffffff"

                                            Text {
                                                id: revealStatusText
                                                anchors.centerIn: parent
                                                text: registerRevealComplete() ? "Hazır" : "Anahtar Çözülüyor"
                                                color: registerRevealComplete() ? "#9be7ff" : "#ffd7da"
                                                font.pixelSize: 11
                                                font.bold: true
                                            }
                                        }
                                    }

                                    Row {
                                        width: parent.width
                                        spacing: 10
                                        Repeater {
                                            model: 4

                                            CodeSegmentCard {
                                                width: Math.floor((parent.width - 30) / 4)
                                                displayText: issuedSegmentText(index)
                                                revealProgress: issuedSegmentRevealProgress(index)
                                                active: issuedSegmentActive(index)
                                                complete: issuedSegmentRevealCount(index) >= 4
                                            }
                                        }
                                    }

                                    Text {
                                        text: registerRevealComplete() ? "Kod hazır. Kopyalayın veya kaydedin." : "16 hane tek tek doğrulanıyor..."
                                        width: parent.width
                                        horizontalAlignment: Text.AlignHCenter
                                        color: window.textMuted
                                        font.pixelSize: 13
                                    }

                                    Rectangle {
                                        width: parent.width
                                        height: 10
                                        radius: 5
                                        color: "#13ffffff"

                                        Rectangle {
                                            width: parent.width * registerRevealProgress()
                                            height: parent.height
                                            radius: 5
                                            gradient: Gradient {
                                                GradientStop { position: 0.0; color: window.accentStrong }
                                                GradientStop { position: 0.55; color: "#ff4556" }
                                                GradientStop { position: 1.0; color: "#3fd3ff" }
                                            }
                                        }
                                    }

                                    Text {
                                        text: `${revealedCount}/16`
                                        width: parent.width
                                        horizontalAlignment: Text.AlignRight
                                        color: "#b8c4d8"
                                        font.pixelSize: 12
                                        font.bold: true
                                    }
                                }
                            }

                            Rectangle {
                                width: parent.width
                                height: 86
                                radius: 20
                                color: "#0d131d"
                                border.width: 1
                                border.color: "#1dffffff"

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 18
                                    spacing: 14

                                    Rectangle {
                                        width: 42
                                        height: 42
                                        radius: 14
                                        color: "#19e50914"
                                        border.width: 1
                                        border.color: "#20ffffff"
                                        anchors.verticalCenter: parent.verticalCenter

                                        Text {
                                            anchors.centerIn: parent
                                            text: "!"
                                            color: "#ffd7da"
                                            font.pixelSize: 20
                                            font.bold: true
                                        }
                                    }

                                    Column {
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: parent.width - 62
                                        spacing: 4
                                        Text { text: "Önemli"; color: window.textPrimary; font.pixelSize: 15; font.family: "Space Grotesk"; font.bold: true }
                                        Text { text: "Bu kodu kaybetmeyin. Kodunuzu saklamadan ilerlemeyin."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 }
                                    }
                                }
                            }

                            Row {
                                width: parent.width
                                spacing: 12
                                AppButton {
                                    width: (parent.width - 12) / 2
                                    text: "Kopyala"
                                    secondary: true
                                    enabled: registerRevealComplete()
                                    onClicked: {
                                        const copied = apiClient.copyText(issuedCode)
                                        showToast(copied ? "Kod kopyalandı." : "Kod kopyalanamadı.", copied ? success : danger)
                                    }
                                }
                                AppButton {
                                    width: (parent.width - 12) / 2
                                    text: "Kaydet"
                                    secondary: true
                                    enabled: registerRevealComplete()
                                    onClicked: {
                                        const path = apiClient.saveTextFile("flixify-kod", `Flixify Pro Hesap Numarası\nKod: ${formatCode(issuedCode)}\nTam kod: ${issuedCode}\n`)
                                        showToast(path.length ? "Kod dosyası kaydedildi." : "Kod dosyası kaydedilemedi.", path.length ? success : danger)
                                    }
                                }
                            }

                            Rectangle {
                                width: parent.width
                                height: 60
                                radius: 18
                                color: registerAcknowledged ? "#2230d19d" : "#0d131d"
                                border.width: 1
                                border.color: registerAcknowledged ? "#5530d19d" : window.borderSoft

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 16
                                    spacing: 12

                                    Rectangle {
                                        width: 24
                                        height: 24
                                        radius: 12
                                        color: registerAcknowledged ? window.success : "#18ffffff"
                                        anchors.verticalCenter: parent.verticalCenter

                                        Text {
                                            anchors.centerIn: parent
                                            text: registerAcknowledged ? "OK" : ""
                                            color: "#04140d"
                                            font.bold: true
                                        }
                                    }

                                    Text { anchors.verticalCenter: parent.verticalCenter; text: "Hesap numaramı kaydettiğimi onaylıyorum"; color: window.textPrimary; font.pixelSize: 14 }
                                }

                                MouseArea { anchors.fill: parent; enabled: registerRevealComplete(); onClicked: registerAcknowledged = !registerAcknowledged }
                            }

                            AppButton {
                                width: parent.width
                                text: "Giriş Ekranına Geç"
                                enabled: registerRevealComplete() && registerAcknowledged
                                onClicked: {
                                    authCode = ""
                                    showAuthCode = false
                                    currentScreen = "login"
                                }
                            }

                            AppButton {
                                width: parent.width
                                text: "Zaten Hesabım Var"
                                secondary: true
                                onClicked: {
                                    authCode = ""
                                    showAuthCode = false
                                    currentScreen = "login"
                                }
                            }
                        }
                    }
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: apiClient.restoringSession

            ColumnLayout {
                anchors.centerIn: parent
                width: window.restorePanelWidth
                spacing: 18

                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: window.shortWindow ? 196 : 220
                    color: window.panelStrong

                    Column {
                        anchors.centerIn: parent
                        spacing: 18

                        Image {
                            width: 54
                            height: 54
                            source: "qrc:/branding/icon.png"
                            fillMode: Image.PreserveAspectFit
                        }

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "Oturum geri yükleniyor"
                            color: window.textPrimary
                            font.pixelSize: 32
                            font.family: "Space Grotesk"
                            font.bold: true
                        }

                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "Kayıtlı cihaz oturumu doğrulanıyor."
                            color: window.textMuted
                            font.pixelSize: 15
                        }

                        BusyIndicator {
                            anchors.horizontalCenter: parent.horizontalCenter
                            running: apiClient.restoringSession
                            width: 44
                            height: 44
                        }
                    }
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: apiClient.authenticated && !shouldShowBlocked()

            ColumnLayout {
                anchors.fill: parent
                spacing: 0

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: (!videoFullscreen && !movieFullscreen && !seriesFullscreen) ? (window.compactWindow ? 92 : 104) : 0
                    color: "#ee010204"
                    visible: !videoFullscreen && !movieFullscreen && !seriesFullscreen

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: window.compactWindow ? 18 : 28
                        anchors.rightMargin: window.compactWindow ? 18 : 28
                        spacing: window.compactWindow ? 16 : 24

                        Row {
                            id: headerBrandRow
                            spacing: 14
                            Image { width: 36; height: 36; source: "qrc:/branding/icon.png"; fillMode: Image.PreserveAspectFit }
                            Text { text: "FLIXIFY"; color: window.textPrimary; font.pixelSize: 30; font.family: "Space Grotesk"; font.bold: true }
                            Rectangle { width: 58; height: 28; radius: 10; color: window.accent; anchors.verticalCenter: parent.verticalCenter; Text { anchors.centerIn: parent; text: "PRO"; color: "#ffffff"; font.pixelSize: 12; font.bold: true } }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: openScreen("home") }
                        }

                        Item {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            Flickable {
                                id: headerNavFlickable
                                anchors.fill: parent
                                contentWidth: navRow.implicitWidth
                                contentHeight: height
                                clip: true
                                interactive: navRow.implicitWidth > width

                                Row {
                                    id: navRow
                                    width: implicitWidth
                                    anchors.verticalCenter: parent.verticalCenter
                                    x: window.compactWindow || headerNavFlickable.interactive
                                        ? 0
                                        : Math.max(0, (headerNavFlickable.width - implicitWidth) / 2)
                                    spacing: window.compactWindow ? 8 : 12
                                
                                Repeater {
                                    model: [
                                        { key: "live", label: "Canl\u0131 TV" },
                                        { key: "movies", label: "Film" },
                                        { key: "series", label: "Dizi" }
                                    ]
                                    NavButton {
                                        required property var modelData
                                        visible: true
                                        implicitWidth: window.compactWindow ? 104 : 126
                                        implicitHeight: window.compactWindow ? 44 : 52
                                        text: modelData.label
                                        active: modelData.key === "series"
                                            ? (currentScreen === "series" || currentScreen === "series-detail")
                                            : currentScreen === modelData.key
                                        onClicked: openScreen(modelData.key)
                                    }
                                }
                                }
                            }
                        }

                        Rectangle {
                            width: window.compactWindow ? 208 : 248
                            height: window.compactWindow ? 56 : 62
                            radius: 8
                            color: "#0affffff"
                            border.width: 1
                            border.color: window.borderSoft
                            Row {
                                anchors.fill: parent
                                anchors.margins: 6
                                spacing: 12
                                Rectangle {
                                    width: 50
                                    height: 50
                                    radius: 6
                                    color: "#10ffffff"
                                    anchors.verticalCenter: parent.verticalCenter

                                    Canvas {
                                        anchors.centerIn: parent
                                        width: 24
                                        height: 24
                                        onPaint: {
                                            const context = getContext("2d")
                                            context.reset()
                                            context.strokeStyle = "#f4f7fb"
                                            context.lineWidth = 2.25
                                            context.lineCap = "round"
                                            context.beginPath()
                                            context.arc(width / 2, 7.5, 4.1, 0, Math.PI * 2)
                                            context.stroke()
                                            context.beginPath()
                                            context.moveTo(5, 20)
                                            context.quadraticCurveTo(width / 2, 12.8, width - 5, 20)
                                            context.stroke()
                                        }
                                    }
                                }
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: parent.width - 86
                                    elide: Text.ElideRight
                                    text: userData().kryptoniteCode || "Profil"
                                    color: window.textPrimary
                                    font.pixelSize: window.compactWindow ? 13 : 14
                                    font.bold: true
                                }
                            }
                            MouseArea { anchors.fill: parent; onClicked: openScreen("profile") }
                        }

                        AppButton { text: "Çıkış"; secondary: true; implicitWidth: 110; onClicked: apiClient.logout() }
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 0

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: appUpdateBannerVisible() ? 118 : 0
                        color: "#167cb6ff"
                        border.width: appUpdateBannerVisible() ? 1 : 0
                        border.color: "#307cb6ff"
                        visible: appUpdateBannerVisible()
                        Row {
                            anchors.fill: parent; anchors.margins: 18; spacing: 16
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 280
                                spacing: 4
                                Text {
                                    text: apiClient.updateInProgress
                                          ? `Güncelleme indiriliyor... %${updateProgressPercent()}`
                                          : (apiClient.updateError.length
                                             ? "Güncelleme başlatılamadı"
                                             : `Yeni sürüm hazır: v${appUpdatePayload().latestVersion || ""}`)
                                    color: window.textPrimary
                                    font.pixelSize: 16
                                    font.family: "Space Grotesk"
                                    font.bold: true
                                }
                                Text {
                                    text: apiClient.updateInProgress
                                          ? updateBannerProgressText()
                                          : (apiClient.updateError.length
                                             ? apiClient.updateError
                                             : updateBannerIdleText())
                                    width: parent.width
                                    wrapMode: Text.WordWrap
                                    color: window.textMuted
                                    font.pixelSize: 14
                                }
                                Rectangle {
                                    width: parent.width
                                    height: 8
                                    radius: 4
                                    visible: apiClient.updateInProgress
                                    color: "#24ffffff"
                                    Rectangle {
                                        width: parent.width * (apiClient.updateProgress || 0)
                                        height: parent.height
                                        radius: 4
                                        color: window.success
                                    }
                                }
                            }
                            AppButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: apiClient.updateInProgress ? "Indiriliyor..." : updatePrimaryActionLabel()
                                secondary: true
                                implicitWidth: 220
                                enabled: !apiClient.updateInProgress && Boolean(appUpdatePayload().downloadUrl)
                                visible: !apiClient.updateInProgress
                                onClicked: apiClient.installAppUpdate()
                            }
                            AppButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "Daha Sonra"
                                secondary: true
                                implicitWidth: 120
                                enabled: !apiClient.updateInProgress
                                visible: appUpdateVisible()
                                onClicked: {
                                    dismissedUpdateVersion = appUpdatePayload().latestVersion || ""
                                    apiClient.dismissAppUpdate(dismissedUpdateVersion)
                                }
                            }
                        }
                    }

                    StackLayout {
                        id: pageStack
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        currentIndex: ({ "home": 0, "live": 1, "movies": 2, "series": 3, "series-detail": 4, "profile": 5, "packages": 6, "payments": 7, "settings": 8, "contact": 9 })[currentScreen] ?? 0

                        Item {
                            HomePage {
                                anchors.fill: parent
                                z: 10
                                movieItems: homeMoviePreviewCache
                                seriesItems: homeSeriesPreviewCache
                                liveItems: homeLivePreviewCache
                                compactWindow: window.compactWindow
                                panelColor: window.panelStrong
                                surfaceColor: window.panelSoft
                                textPrimary: window.textPrimary
                                textMuted: window.textMuted
                                accentColor: window.accent
                                shellPadding: window.shellPadding
                                sectionSpacing: window.sectionSpacing
                                cardGap: window.cardGap
                                onMovieSelected: function(movie) { playMovie(movie) }
                                onSeriesSelected: function(series) {
                                    const seriesId = fieldText(series, "id")
                                    if (seriesId.length) {
                                        openSeriesDetail(seriesId)
                                    }
                                }
                                onLiveSelected: function(channel) { playLive(channel) }
                                onOpenMoviesRequested: openScreen("movies")
                                onOpenSeriesRequested: openScreen("series")
                                onOpenLiveRequested: openScreen("live")
                            }

                            ScrollView {
                            id: homeScrollView
                            anchors.fill: parent
                            clip: true
                            visible: false
                            enabled: false
                            Connections {
                                target: homeScrollView.contentItem ? homeScrollView.contentItem : null
                                function onContentYChanged() {
                                    const flickable = homeScrollView.contentItem
                                    if (!flickable || !apiClient.movieHasMore || apiClient.movieLoadingMore) {
                                        return
                                    }
                                    const contentBottom = flickable.contentY + homeScrollView.height
                                    const totalHeight = flickable.contentHeight || flickable.height || 0
                                    if (totalHeight > 0 && contentBottom > totalHeight - 500) {
                                        apiClient.loadMoreMovies()
                                    }
                                }
                            }
                            Column {
                                width: pageStack.width
                                topPadding: 0
                                bottomPadding: window.compactWindow ? 24 : 32
                                spacing: 0

                                // HERO SECTION
                                Item {
                                    width: parent.width
                                    height: window.heroHeight + 80
                                    visible: homeHeroItem() !== null
                                    
                                    ArtworkPanel {
                                        anchors.fill: parent
                                        anchors.margins: -40
                                        title: homeHeroItem() ? homeHeroItem().title : "Flixify"
                                        subtitle: homeHeroItem() ? (homeHeroItem().subtitle || "") : ""
                                        sourceUrl: homeHeroItem() ? (homeHeroItem().posterUrl || homeHeroItem().logoUrl || "") : ""
                                        kind: homeHeroItem() ? homeHeroItem().kind : "movie"
                                        mode: homeHeroItem() && homeHeroItem().kind === "live" ? "logo" : "poster"
                                        cornerRadius: 0
                                    }
                                    
                                    Rectangle {
                                        anchors.fill: parent
                                        gradient: Gradient {
                                            GradientStop { position: 0.0; color: "#05070b" }
                                            GradientStop { position: 0.15; color: "#8005070b" }
                                            GradientStop { position: 0.5; color: "#4005070b" }
                                            GradientStop { position: 0.85; color: "#cc05070b" }
                                            GradientStop { position: 1.0; color: "#05070b" }
                                        }
                                    }
                                    
                                    Column {
                                        anchors.left: parent.left
                                        anchors.right: parent.right
                                        anchors.bottom: parent.bottom
                                        anchors.leftMargin: window.shellPadding
                                        anchors.rightMargin: window.shellPadding
                                        anchors.bottomMargin: window.compactWindow ? 30 : 50
                                        spacing: 20
                                        
                                        Rectangle {
                                            width: categoryTag.implicitWidth + 32
                                            height: 36
                                            radius: 18
                                            color: homeHeroItem() && homeHeroItem().kind === "movie" ? "#e50914" : 
                                                   homeHeroItem() && homeHeroItem().kind === "live" ? "#2563eb" : "#7c3aed"
                                            
                                            Text {
                                                id: categoryTag
                                                anchors.centerIn: parent
                                                text: homeHeroItem() && homeHeroItem().kind === "movie" ? "🔥 Öne Çıkan Film" : 
                                                      homeHeroItem() && homeHeroItem().kind === "live" ? "📺 Canlı Yayın" : "🎬 Yeni Bölüm"
                                                color: "#ffffff"
                                                font.pixelSize: 13
                                                font.bold: true
                                            }
                                        }
                                        
                                        Text {
                                            width: parent.width * 0.7
                                            wrapMode: Text.WordWrap
                                            text: homeHeroItem() ? homeHeroItem().title : ""
                                            color: window.textPrimary
                                            font.pixelSize: window.compactWindow ? 48 : window.mediumWindow ? 62 : 72
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }
                                        
                                        Row {
                                            spacing: 16
                                            
                                            Text {
                                                text: homeHeroItem() && homeHeroItem().subtitle ? homeHeroItem().subtitle : ""
                                                color: window.textMuted
                                                font.pixelSize: 16
                                                visible: text.length > 0
                                            }
                                            
                                            Rectangle {
                                                width: subscriptionPill2.implicitWidth + 24
                                                height: 28
                                                radius: 14
                                                color: "#1affffff"
                                                visible: homeHeroItem() && homeHeroItem().playbackAllowed
                                                
                                                Text {
                                                    id: subscriptionPill2
                                                    anchors.centerIn: parent
                                                    text: "HD"
                                                    color: "#82ecc4"
                                                    font.pixelSize: 12
                                                    font.bold: true
                                                }
                                            }
                                        }
                                        
                                        Text {
                                            width: parent.width * (window.compactWindow ? 0.9 : 0.55)
                                            wrapMode: Text.WordWrap
                                            text: homeHeroItem() && homeHeroItem().kind === "movie" ? "Premium film deneyimi ve yüksek kaliteli görüntü ile keyifli bir izleme süreci sizi bekliyor." : 
                                                  homeHeroItem() && homeHeroItem().kind === "live" ? "Canlı yayın keyfi ile anında erişim. Spor, haber ve eğlence kanalları tek noktada." : 
                                                  "Yeni sezon, yeni bölümler. Otomatik sonraki bölüm geçişi ile kesintisiz dizi keyfi."
                                            color: "#b8c0d0"
                                            font.pixelSize: window.compactWindow ? 15 : 16
                                            lineHeight: 1.4
                                        }
                                        
                                        Row {
                                            spacing: 14
                                            topPadding: 10
                                            
                                            AppButton {
                                                text: "▶  " + (homeHeroItem() && homeHeroItem().kind === "live" ? "Canlıyı Aç" : homeHeroItem() && homeHeroItem().kind === "movie" ? "Şimdi İzle" : "Bölümü Oynat")
                                                implicitWidth: 200
                                                onClicked: { 
                                                    if (homeHeroItem().kind === "movie") playMovie(apiClient.movieById(homeHeroItem().id))
                                                    else if (homeHeroItem().kind === "episode") playEpisode(apiClient.episodeById(homeHeroItem().id), apiClient.seriesById(homeHeroItem().seriesId))
                                                    else playLive(apiClient.liveChannelById(homeHeroItem().id))
                                                }
                                            }
                                            
                                            AppButton {
                                                text: "ⓘ  Daha Fazla Bilgi"
                                                secondary: true
                                                implicitWidth: 180
                                                onClicked: {
                                                    if (homeHeroItem().kind === "movie") openScreen("movies")
                                                    else if (homeHeroItem().kind === "episode") openScreen("series")
                                                    else openScreen("live")
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                Item { width: parent.width; height: 20 }

                                // CONTENT SECTIONS
                                Column {
                                    width: parent.width - (window.shellPadding * 2)
                                    anchors.horizontalCenter: parent.horizontalCenter
                                    spacing: window.sectionSpacing * 1.5
                                    
                                    // Popüler Filmler
                                    HomeContentSection {
                                        title: "Sizin İçin Seçilen Filmler"
                                        items: homeFeaturedMovies(12)
                                        kind: "movie"
                                        onItemClicked: function(item) { playMovie(apiClient.movieById(item.id)) }
                                        onSeeAll: openScreen("movies")
                                    }

                                    Repeater {
                                        model: homeMovieSections(3, 10)
                                        HomeContentSection {
                                            required property var modelData
                                            title: modelData.title
                                            items: modelData.items
                                            kind: "movie"
                                            onItemClicked: function(item) { playMovie(apiClient.movieById(item.id)) }
                                            onSeeAll: {
                                                applyMovieFilters("", modelData.title)
                                                openScreen("movies")
                                            }
                                        }
                                    }
                                    
                                    // Öne Çıkan Diziler
                                    HomeContentSection {
                                        title: "📺 Öne Çıkan Diziler"
                                        items: featuredSeriesEpisodes().slice(0, 12)
                                        kind: "episode"
                                        onItemClicked: function(item) { playEpisode(apiClient.episodeById(item.id), apiClient.seriesById(item.seriesId)) }
                                        onSeeAll: openScreen("series")
                                    }
                                    
                                    // Canlı TV
                                    HomeContentSection {
                                        title: "📡 Canlı TV"
                                        items: (apiClient.liveChannels || []).slice(0, 15)
                                        kind: "live"
                                        onItemClicked: function(item) { playLive(apiClient.liveChannelById(item.id)) }
                                        onSeeAll: openScreen("live")
                                    }
                                    
                                    // Tüm Filmler Grid
                                    Column {
                                        width: parent.width
                                        spacing: 20
                                        visible: (apiClient.movies || []).length > 0
                                        
                                        Row {
                                            width: parent.width
                                            Text { 
                                                text: "🎞️ Tüm Filmler"
                                                color: window.textPrimary
                                                font.pixelSize: 28
                                                font.family: "Space Grotesk"
                                                font.bold: true
                                            }
                                            Item { Layout.fillWidth: true; width: 1 }
                                            AppButton { 
                                                text: "Tümünü Gör"; 
                                                secondary: true; 
                                                implicitWidth: 120; 
                                                onClicked: openScreen("movies")
                                            }
                                        }
                                        
                                        Flow {
                                            width: parent.width
                                            spacing: window.cardGap
                                            anchors.horizontalCenter: parent.horizontalCenter
                                            
                                            Repeater {
                                                model: (apiClient.movies || []).slice(0, 20)
                                                PosterGridCard {
                                                    titleText: (modelData && modelData["title"] ? modelData["title"] : "").toString()
                                                    subtitleText: (modelData && modelData["groupTitle"] ? modelData["groupTitle"] : "").toString()
                                                    artworkUrl: window.artworkSource(modelData && modelData["posterUrl"] ? modelData["posterUrl"] : "")
                                                    playbackAllowed: Boolean(modelData && modelData["playbackAllowed"])
                                                    payload: modelData
                                                    cardKind: "movie"
                                                    onActivated: function(item) { playMovie(item) }
                                                }
                                            }
                                        }
                                        
                                        Rectangle {
                                            width: parent.width
                                            height: 80
                                            color: "transparent"
                                            visible: apiClient.movieLoadingMore
                                            
                                            BusyIndicator {
                                                anchors.centerIn: parent
                                                running: parent.visible
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        }

                        Item {
                            ColumnLayout {
                                anchors.fill: parent
                                anchors.margins: videoFullscreen ? 0 : 24
                                spacing: videoFullscreen ? 0 : 18
                                Text {
                                    text: "Canlı TV"
                                    color: window.textPrimary
                                    font.pixelSize: 42
                                    font.family: "Space Grotesk"
                                    font.bold: true
                                    visible: !videoFullscreen
                                }

                                Flickable {
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: videoFullscreen ? 0 : 52
                                    visible: !videoFullscreen
                                    contentWidth: liveChipRow.width
                                    clip: true

                                    Row {
                                        id: liveChipRow
                                        spacing: 10

                                        ChipButton {
                                            text: "Tüm Kanallar"
                                            active: selectedLiveGroup === ""
                                            width: Math.max(112, implicitContentWidth + 28)
                                            onClicked: applyLiveFilters(liveSearchText, "__all__")
                                        }

                                        Repeater {
                                            model: liveCountryChips()
                                            ChipButton {
                                                required property var modelData
                                                text: modelData.count > 0 ? `${modelData.label} ${modelData.count}` : modelData.label
                                                active: currentSelectedLiveCountryKey() === modelData.key
                                                width: Math.max(96, implicitContentWidth + 28)
                                                onClicked: applyLiveFilters(liveSearchText, modelData.filter)
                                            }
                                        }

                                        Repeater {
                                            model: liveGroupChips()
                                            ChipButton {
                                                required property var modelData
                                                text: modelData.count > 0 ? `${modelData.title} ${modelData.count}` : modelData.title
                                                active: selectedLiveGroup === modelData.title
                                                width: Math.max(104, implicitContentWidth + 28)
                                                onClicked: applyLiveFilters(liveSearchText, modelData.title)
                                            }
                                        }
                                    }
                                }

                                Flickable {
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: !videoFullscreen && liveSubgroupChips().length > 0 ? 52 : 0
                                    visible: !videoFullscreen && liveSubgroupChips().length > 0
                                    contentWidth: liveSubgroupRow.width
                                    clip: true

                                    Row {
                                        id: liveSubgroupRow
                                        spacing: 10

                                        Repeater {
                                            model: liveSubgroupChips()
                                            ChipButton {
                                                required property var modelData
                                                text: modelData.title
                                                active: selectedLiveGroup === modelData.title
                                                width: Math.max(120, implicitContentWidth + 28)
                                                onClicked: applyLiveFilters(liveSearchText, modelData.title)
                                            }
                                        }
                                    }
                                }

                                RowLayout {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    spacing: videoFullscreen ? 0 : window.sectionSpacing
                                    GlassCard {
                                        Layout.fillWidth: true
                                        Layout.minimumWidth: videoFullscreen ? 0 : (window.compactWindow ? 600 : 720)
                                        Layout.preferredWidth: videoFullscreen ? 0 : (window.compactWindow ? 700 : 840)
                                        Layout.fillHeight: true
                                        color: videoFullscreen ? "#000000" : "#090c13"
                                        radius: videoFullscreen ? 0 : 8

                                        LiveTvPlayerShell {
                                            id: livePlayerShell
                                            anchors.fill: parent
                                            channelData: selectedLiveItem()
                                            controller: livePlaybackController
                                            videoSurfaceComponent: liveVideoSurfaceComponent
                                            fullscreen: videoFullscreen
                                            playerActive: inlineLivePlayerVisible()
                                            filteredCount: filteredLiveItems().length
                                            onToggleFullscreenRequested: toggleVideoFullscreen()
                                        }

                                        Rectangle {
                                                visible: false
                                                Layout.fillWidth: true
                                                Layout.fillHeight: true
                                                radius: videoFullscreen ? 0 : 8
                                                color: "#000000"
                                                border.width: videoFullscreen ? 0 : 1
                                                border.color: "#14ffffff"
                                                clip: true
                                                
                                                Item {
                                                    id: liveVideoContainer
                                                    anchors.fill: parent
                                                    visible: inlineLivePlayerVisible()
                                                    
                                                    // 1. Video Surface
                                                    Loader {
                                                        anchors.left: parent.left
                                                        anchors.right: parent.right
                                                        anchors.top: parent.top
                                                        anchors.bottom: parent.bottom
                                                        active: false
                                                        sourceComponent: liveVideoSurfaceComponent

                                                        onLoaded: {
                                                            if (item) {
                                                                item.controller = livePlaybackController
                                                                item.slotIndex = 0
                                                                if (item.syncSurfaceBinding) {
                                                                    item.syncSurfaceBinding()
                                                                }
                                                            }
                                                        }
                                                    }
                                                    
                                                    // 2. Player Controls Overlay
                                                    Item {
                                                        anchors.fill: parent
                                                        visible: inlineLivePlayerVisible()
                                                        z: 100
                                                        
                                                        // Modern Buffer/Loading State Indicator
                                                        Rectangle {
                                                            anchors.top: parent.top
                                                            anchors.right: parent.right
                                                            anchors.margins: 24
                                                            width: liveNativeStateText2.implicitWidth + 48
                                                            height: 44
                                                            radius: 22
                                                            color: "#cc0d121c"
                                                            border.width: 1
                                                            border.color: "#30ffffff"
                                                            visible: livePlaybackController.state !== "playing"
                                                            
                                                            Row {
                                                                anchors.centerIn: parent
                                                                spacing: 10
                                                                
                                                                // Animated spinner
                                                                Rectangle {
                                                                    width: 18
                                                                    height: 18
                                                                    radius: 9
                                                                    color: "transparent"
                                                                    border.width: 2
                                                                    border.color: "#e50914"
                                                                    anchors.verticalCenter: parent.verticalCenter
                                                                    
                                                                    Rectangle {
                                                                        width: 6
                                                                        height: 6
                                                                        radius: 3
                                                                        color: "#e50914"
                                                                        anchors.centerIn: parent
                                                                    }
                                                                    
                                                                    RotationAnimation on rotation {
                                                                        loops: Animation.Infinite
                                                                        from: 0
                                                                        to: 360
                                                                        duration: 1000
                                                                    }
                                                                }
                                                                
                                                                Text {
                                                                    id: liveNativeStateText2
                                                                    anchors.verticalCenter: parent.verticalCenter
                                                                    text: livePlaybackController.state === "buffering" ? "Buffer dolduruluyor" :
                                                                          livePlaybackController.state === "resolving" || livePlaybackController.state === "opening" ? "Kaynak hazırlanıyor" :
                                                                          livePlaybackController.state === "error" ? "Yayın açılamadı" : "Bağlanıyor"
                                                                    color: window.textPrimary
                                                                    font.pixelSize: 14
                                                                    font.bold: true
                                                                }
                                                            }
                                                        }
                                                        
                                                    }

                                                }
                                                
                                                Rectangle {
                                                    anchors.horizontalCenter: parent.horizontalCenter
                                                    anchors.bottom: parent.bottom
                                                    anchors.bottomMargin: 140
                                                    width: Math.min(parent.width - 72, liveNativeWarningLabel.implicitWidth + 32)
                                                    height: liveNativeWarningLabel.implicitHeight + 16
                                                    radius: 16
                                                    color: "#cc151a22"
                                                    border.width: 1
                                                    border.color: "#307cb6ff"
                                                    visible: livePlaybackController.lastError.length > 0 &&
                                                             livePlaybackController.state !== "error" &&
                                                             livePlaybackController.activeContentKind === "live" &&
                                                             inlineLivePlayerVisible()
                                                    z: 10

                                                    Text {
                                                        id: liveNativeWarningLabel
                                                        anchors.centerIn: parent
                                                        width: parent.width - 22
                                                        wrapMode: Text.WordWrap
                                                        horizontalAlignment: Text.AlignHCenter
                                                        text: livePlaybackController.lastError
                                                        color: "#d5e6ff"
                                                        font.pixelSize: 12
                                                    }
                                                }

                                                // Error Display (terminal)
                                                Rectangle {
                                                    anchors.horizontalCenter: parent.horizontalCenter
                                                    anchors.bottom: parent.bottom
                                                    anchors.bottomMargin: 140
                                                    width: Math.min(parent.width - 36, liveNativeErrorLabel.implicitWidth + 36)
                                                    height: liveNativeErrorLabel.implicitHeight + 22
                                                    radius: 20
                                                    color: "#cc20070b"
                                                    border.width: 1
                                                    border.color: "#28ff7d86"
                                                    visible: livePlaybackController.lastError.length > 0 &&
                                                             livePlaybackController.state === "error" &&
                                                             livePlaybackController.activeContentKind === "live" &&
                                                             inlineLivePlayerVisible()
                                                    z: 10

                                                    Text {
                                                        id: liveNativeErrorLabel
                                                        anchors.centerIn: parent
                                                        width: parent.width - 26
                                                        wrapMode: Text.WordWrap
                                                        horizontalAlignment: Text.AlignHCenter
                                                        text: livePlaybackController.lastError
                                                        color: "#ffd5da"
                                                        font.pixelSize: 13
                                                    }
                                                }

                                                Column {
                                                    anchors.centerIn: parent
                                                    width: Math.min(parent.width * 0.6, 420)
                                                    spacing: 12
                                                    visible: !inlineLivePlayerVisible() && filteredLiveItems().length === 0

                                                    Text {
                                                        width: parent.width
                                                        horizontalAlignment: Text.AlignHCenter
                                                text: "Filtreye uyan kanal bulunamadı"
                                                        color: window.textPrimary
                                                        font.pixelSize: 28
                                                        font.family: "Space Grotesk"
                                                        font.bold: true
                                                        wrapMode: Text.WordWrap
                                                    }

                                                    Text {
                                                        width: parent.width
                                                        horizontalAlignment: Text.AlignHCenter
                                                    text: "Aramayı temizleyin veya başka bir kategori seçin."
                                                        color: window.textMuted
                                                        font.pixelSize: 14
                                                        wrapMode: Text.WordWrap
                                                    }
                                                }

                                                Item {
                                                    anchors.fill: parent
                                                    visible: !inlineLivePlayerVisible() && filteredLiveItems().length > 0 && selectedLiveItem() !== null && selectedLiveItem().playbackAllowed === false

                                                    Column {
                                                        anchors.centerIn: parent
                                                        width: Math.min(parent.width * 0.62, 460)
                                                        spacing: 12

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Bu kanalı açmak için aktif paket gerekiyor"
                                                            color: window.textPrimary
                                                            font.pixelSize: 30
                                                            font.family: "Space Grotesk"
                                                            font.bold: true
                                                            wrapMode: Text.WordWrap
                                                        }

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Sağ listeden başka kanal seçin ya da paket durumunuzu güncelleyin."
                                                            color: window.textMuted
                                                            font.pixelSize: 14
                                                            wrapMode: Text.WordWrap
                                                        }
                                                    }
                                                }
                                            }

                                        }
                                    GlassCard {
                                        Layout.preferredWidth: videoFullscreen ? 0 : (window.compactWindow ? 500 : 600)
                                        Layout.minimumWidth: videoFullscreen ? 0 : (window.compactWindow ? 470 : 560)
                                        Layout.fillHeight: true
                                        color: "#0a0f18"
                                        visible: !videoFullscreen

                                        ColumnLayout {
                                            anchors.fill: parent
                                            anchors.margins: 18
                                            spacing: 14

                                            RowLayout {
                                                Layout.fillWidth: true
                                                spacing: 10

                                                AppField {
                                                    Layout.fillWidth: true
                                                    placeholderText: "Kanal ara..."
                                                    text: liveSearchText
                                                    onTextChanged: {
                                                        liveSearchText = text
                                                        liveFilterDebounceTimer.restart()
                                                    }
                                                    onAccepted: {
                                                        liveFilterDebounceTimer.stop()
                                                        applyLiveFilters(text, selectedLiveGroup)
                                                    }
                                                }

                                                AppButton {
                                                    text: "Ara"
                                                    secondary: true
                                                    implicitWidth: 86
                                                    onClicked: {
                                                        liveFilterDebounceTimer.stop()
                                                        applyLiveFilters(liveSearchText, selectedLiveGroup)
                                                    }
                                                }

                                                AppButton {
                                                    visible: liveSearchText.length > 0
                                                    enabled: visible
                                                    text: "Temizle"
                                                    secondary: true
                                                    implicitWidth: 108
                                                    onClicked: {
                                                        liveFilterDebounceTimer.stop()
                                                        applyLiveFilters("", selectedLiveGroup)
                                                    }
                                                }
                                            }

                                            RowLayout {
                                                Layout.fillWidth: true

                                                Text {
                                                    text: "Kanallar"
                                                    color: window.textPrimary
                                                    font.pixelSize: 22
                                                    font.family: "Space Grotesk"
                                                    font.bold: true
                                                }

                                                Item { Layout.fillWidth: true }

                                                Text {
                                                    text: apiClient.liveLoadingMore
                                                        ? "Daha fazla yükleniyor"
                                                        : (filteredLiveItems().length ? `${filteredLiveItems().length} kanal` : "Bos")
                                                    color: window.textMuted
                                                    font.pixelSize: 13
                                                }
                                            }

                                            ListView {
                                                id: liveChannelListView
                                                Layout.fillWidth: true
                                                Layout.fillHeight: true
                                                clip: true
                                                spacing: 12
                                                cacheBuffer: 960
                                                boundsBehavior: Flickable.StopAtBounds
                                                model: filteredLiveItems()

                                                function requestMoreIfNeeded() {
                                                    if (!apiClient.liveHasMore || apiClient.liveLoadingMore) {
                                                        return
                                                    }
                                                    if (contentHeight <= height + 8 || contentY + height >= contentHeight - 320) {
                                                        apiClient.loadMoreLive()
                                                    }
                                                }

                                                onContentYChanged: requestMoreIfNeeded()
                                                onContentHeightChanged: requestMoreIfNeeded()
                                                onHeightChanged: requestMoreIfNeeded()
                                                Component.onCompleted: requestMoreIfNeeded()

                                                delegate: Rectangle {
                                                    required property var modelData
                                                    width: ListView.view.width
                                                    height: 88
                                                    radius: 22
                                                    color: selectedLiveId === modelData.id ? "#e50914" : "#131923"
                                                    border.width: 1
                                                    border.color: selectedLiveId === modelData.id ? "#ff5d74" : "#2a3140"

                                                    Row {
                                                        anchors.fill: parent
                                                        anchors.margins: 14
                                                        spacing: 14

                                                        Text {
                                                            anchors.verticalCenter: parent.verticalCenter
                                                            text: index + 1
                                                            color: selectedLiveId === modelData.id ? "#ffffff" : "#9eabba"
                                                            font.pixelSize: 15
                                                            font.bold: true
                                                        }

                                                        Rectangle {
                                                            width: 54
                                                            height: 54
                                                            radius: 18
                                                            color: "#14ffffff"
                                                            anchors.verticalCenter: parent.verticalCenter

                                                            ArtworkPanel {
                                                                anchors.fill: parent
                                                                title: modelData.title || ""
                                                                subtitle: modelData.groupTitle || "Canlı TV"
                                                                sourceUrl: modelData.logoUrl || ""
                                                                kind: "live"
                                                                mode: "logo"
                                                                compact: true
                                                                cornerRadius: 18
                                                            }
                                                        }

                                                        Column {
                                                            anchors.verticalCenter: parent.verticalCenter
                                                            width: parent.width - 120
                                                            spacing: 4

                                                            Text {
                                                                text: modelData.title
                                                                width: parent.width
                                                                elide: Text.ElideRight
                                                                color: "#ffffff"
                                                                font.pixelSize: 18
                                                                font.bold: true
                                                            }

                                                            Text {
                                                                text: modelData.groupTitle || "Canlı TV"
                                                                width: parent.width
                                                                elide: Text.ElideRight
                                                                color: selectedLiveId === modelData.id ? "#ffe8eb" : window.textMuted
                                                                font.pixelSize: 13
                                                            }
                                                        }
                                                    }

                                                    MouseArea {
                                                        anchors.fill: parent
                                                        onClicked: playLive(modelData)
                                                    }
                                                }

                                                footer: Item {
                                                    width: liveChannelListView.width
                                                    height: apiClient.liveHasMore || apiClient.liveLoadingMore ? 58 : 12

                                                    Rectangle {
                                                        anchors.horizontalCenter: parent.horizontalCenter
                                                        anchors.verticalCenter: parent.verticalCenter
                                                        width: liveLoadingLabel.implicitWidth + 24
                                                        height: 34
                                                        radius: 17
                                                        color: "#10ffffff"
                                                        border.width: 1
                                                        border.color: "#18ffffff"
                                                        visible: apiClient.liveHasMore || apiClient.liveLoadingMore

                                                        Text {
                                                            id: liveLoadingLabel
                                                            anchors.centerIn: parent
                                                            text: apiClient.liveLoadingMore ? "Kanallar yükleniyor" : "Daha fazla kanal için kaydırın"
                                                            color: window.textMuted
                                                            font.pixelSize: 12
                                                            font.bold: true
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        MoviesPage {
                            id: moviesPage
                            movieItems: filteredMovies()
                            movieGroups: movieGroupOptions()
                            movieTotal: apiClient.movieTotal
                            currentMovie: selectedMovie()
                            playbackController: moviePlaybackController
                            videoSurfaceComponent: vodVideoSurfaceComponent
                            selectedMovieId: selectedMovieId
                            selectedGroup: selectedMovieGroup
                            searchText: moviesSearchText
                            playerVisible: inlineMoviePlayerVisible()
                            windowIsFullscreen: movieFullscreen
                            compactWindow: window.compactWindow
                            movieLoadingMore: apiClient.movieLoadingMore
                            movieHasMore: apiClient.movieHasMore
                            panelColor: window.panelStrong
                            surfaceColor: window.panelSoft
                            textPrimary: window.textPrimary
                            textMuted: window.textMuted
                            accentColor: window.accentStrong
                            shellPadding: window.shellPadding
                            sectionSpacing: window.sectionSpacing
                            cardGap: window.cardGap
                            posterCardWidth: window.posterCardWidth
                            onSearchEdited: {
                                moviesSearchText = text
                                movieSearchDebounceTimer.restart()
                            }
                            onRefreshRequested: apiClient.fetchMovieCatalog(1, 120, moviesSearchText, selectedMovieGroup)
                            onClearFiltersRequested: applyMovieFilters("", "")
                            onGroupSelected: function(group) { applyMovieFilters(moviesSearchText, group) }
                            onMovieSelected: function(movie) { playMovie(movie) }
                            onLoadMoreRequested: apiClient.loadMoreMovies()
                            onClosePlayerRequested: closeMoviePlayer()
                            onToggleWindowFullscreenRequested: toggleMovieFullscreen()
                        }

                        Item {
                            anchors.fill: parent

                            ScrollView {
                                anchors.fill: parent
                                clip: true
                                visible: false
                                enabled: false
                                height: 0
                                opacity: 0
                                z: -100

                                Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                property var spotlightSeries: featuredSeriesItem()
                                property var spotlightEpisode: seriesLeadEpisode(spotlightSeries)

                                GlassCard {
                                    width: parent.width
                                    height: window.compactWindow ? 430 : 360
                                    radius: 32
                                    color: "#090c13"
                                    clip: true
                                    visible: spotlightSeries !== null

                                    ArtworkPanel {
                                        anchors.fill: parent
                                        title: spotlightSeries ? spotlightSeries.title || "" : "Diziler"
                                        subtitle: spotlightSeries ? spotlightSeries.groupTitle || "Dizi" : "Dizi"
                                        sourceUrl: spotlightSeries ? (spotlightSeries.posterUrl || "") : ""
                                        kind: "episode"
                                        mode: "poster"
                                        cornerRadius: 32
                                    }

                                    Rectangle {
                                        anchors.fill: parent
                                        gradient: Gradient {
                                            GradientStop { position: 0.0; color: "#1205070b" }
                                            GradientStop { position: 0.30; color: "#2d0c1220" }
                                            GradientStop { position: 0.76; color: "#d105070b" }
                                            GradientStop { position: 1.0; color: "#f0080b11" }
                                        }
                                    }

                                    Column {
                                        anchors.fill: parent
                                        anchors.margins: window.compactWindow ? 22 : 28
                                        spacing: 14

                                        Row {
                                            spacing: 10

                                            Rectangle {
                                                width: 112
                                                height: 34
                                                radius: 17
                                                color: "#1b7cb6ff"
                                                border.width: 1
                                                border.color: "#397cb6ff"

                                                Text {
                                                    anchors.centerIn: parent
                                                    text: "Dizi Hub"
                                                    color: window.textPrimary
                                                    font.pixelSize: 12
                                                    font.bold: true
                                                }
                                            }

                                            Rectangle {
                                                width: seriesMetaBadge.implicitWidth + 24
                                                height: 34
                                                radius: 17
                                                color: "#14ffffff"

                                                Text {
                                                    id: seriesMetaBadge
                                                    anchors.centerIn: parent
                                                    text: spotlightSeries ? `${Number(spotlightSeries.seasonCount || 0)} sezon • ${seriesTotalEpisodes(spotlightSeries)} bölüm` : "Dizi seçin"
                                                    color: window.textPrimary
                                                    font.pixelSize: 12
                                                    font.bold: true
                                                }
                                            }
                                        }

                                        Item { width: 1; height: 1 }

                                        Text {
                                            text: spotlightSeries ? spotlightSeries.title || "Dizi seçin" : "Dizi seçin"
                                            width: parent.width * (window.compactWindow ? 0.96 : 0.68)
                                            wrapMode: Text.WordWrap
                                            color: window.textPrimary
                                            font.pixelSize: window.compactWindow ? 34 : 48
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }

                                        Text {
                                            text: spotlightSeries ? (spotlightSeries.groupTitle || "Seçili dizi vitrini") : ""
                                            color: "#d3d9e8"
                                            font.pixelSize: 15
                                            visible: text.length > 0
                                        }

                                        Text {
                                            width: parent.width * (window.compactWindow ? 0.98 : 0.6)
                                            wrapMode: Text.WordWrap
                                            color: "#bcc5d6"
                                            font.pixelSize: 15
                                            lineHeight: 1.35
                                            text: spotlightSeries
                                                  ? "Sezonlar, öne çıkan bölüm ve detay akışı aynı hizada açık kalır. Dizi seçip detay ekranına geçiş yapmak artık daha doğrudan."
                                                  : "Dizi kataloğu hazır olduğunda buradan seçili diziyi öne çıkaracağız."
                                        }

                                        Flow {
                                            width: parent.width
                                            spacing: 12

                                            AppButton {
                                                text: "Detayı Aç"
                                                implicitWidth: 156
                                                enabled: spotlightSeries && fieldText(spotlightSeries, "id").length
                                                onClicked: if (spotlightSeries) openSeriesDetail(fieldText(spotlightSeries, "id"))
                                            }

                                            AppButton {
                                                text: "Öne Çıkan Bölümü Oynat"
                                                secondary: true
                                                implicitWidth: 220
                                                enabled: spotlightEpisode && Boolean(fieldValue(spotlightEpisode, "playbackAllowed", false))
                                                onClicked: if (spotlightEpisode && spotlightSeries) playEpisode(spotlightEpisode, spotlightSeries)
                                            }

                                            AppButton {
                                                text: "Kataloğu Yenile"
                                                secondary: true
                                                implicitWidth: 164
                                                onClicked: apiClient.fetchSeriesCatalog(1, 200, seriesSearchText)
                                            }
                                        }
                                    }
                                }

                                Flow {
                                    width: parent.width
                                    spacing: 12

                                    AppField {
                                        width: window.compactWindow ? parent.width : Math.max(320, parent.width - 180)
                                        placeholderText: "Dizi ara..."
                                        text: seriesSearchText
                                        onTextChanged: seriesSearchText = text
                                    }

                                    AppButton {
                                        text: "Yenile"
                                        secondary: true
                                        implicitWidth: 150
                                        onClicked: apiClient.fetchSeriesCatalog(1, 200, seriesSearchText)
                                    }
                                }

                                Flickable {
                                    width: parent.width
                                    height: 52
                                    contentWidth: seriesChipRow.width
                                    clip: true

                                    Row {
                                        id: seriesChipRow
                                        spacing: 10

                                        Repeater {
                                            model: [""].concat(uniqueGroups(apiClient.series || []))

                                            ChipButton {
                                                required property var modelData
                                                text: modelData.length ? modelData : "Tüm Diziler"
                                                active: selectedSeriesGroup === modelData
                                                width: Math.max(112, implicitContentWidth + 28)
                                                onClicked: selectedSeriesGroup = modelData
                                            }
                                        }
                                    }
                                }

                                GlassCard {
                                    width: parent.width
                                    height: 76
                                    radius: 24
                                    color: "#090c13"

                                    Flow {
                                        anchors.fill: parent
                                        anchors.margins: 18
                                        spacing: 10

                                        Rectangle {
                                            width: 132
                                            height: 38
                                            radius: 19
                                            color: "#14ffffff"

                                            Text {
                                                anchors.centerIn: parent
                                                text: `${filteredSeries().length} dizi`
                                                color: window.textPrimary
                                                font.pixelSize: 12
                                                font.bold: true
                                            }
                                        }

                                        Rectangle {
                                            width: Math.max(170, seriesGroupSummary.implicitWidth + 26)
                                            height: 38
                                            radius: 19
                                            color: "#120f1722"
                                            border.width: 1
                                            border.color: "#1effffff"

                                            Text {
                                                id: seriesGroupSummary
                                                anchors.centerIn: parent
                                                text: selectedSeriesGroup.length ? selectedSeriesGroup : "Tüm Kategoriler"
                                                color: window.textMuted
                                                font.pixelSize: 12
                                                font.bold: true
                                            }
                                        }

                                        Rectangle {
                                            width: Math.max(220, seriesStageSummary.implicitWidth + 26)
                                            height: 38
                                            radius: 19
                                            color: "#10161f"
                                            border.width: 1
                                            border.color: "#1dffffff"

                                            Text {
                                                id: seriesStageSummary
                                                anchors.centerIn: parent
                                                text: spotlightEpisode ? "Detaya geçmeden önce bölüm hazırlığı" : "Önce diziyi seçin, sonra bölümü açın"
                                                color: window.textMuted
                                                font.pixelSize: 12
                                                font.bold: true
                                            }
                                        }
                                    }
                                }

                                Flow {
                                    property int __maxCols: Math.max(1, Math.floor((parent.width + window.cardGap) / (window.railCardWidth + window.cardGap)))
                                    property int __actualCols: Math.min(filteredSeries().length, __maxCols)
                                    width: __actualCols * window.railCardWidth + Math.max(0, __actualCols - 1) * window.cardGap
                                    spacing: window.cardGap
                                    anchors.horizontalCenter: parent.horizontalCenter

                                    Repeater {
                                        model: filteredSeries()

                                        RailCard {
                                            item: ({
                                                id: fieldText(modelData, "id"),
                                                title: fieldText(modelData, "title") || "Dizi",
                                                subtitle: `${fieldNumber(modelData, "seasonCount", 0)} sezon • ${fieldNumber(modelData, "episodeCount", 0)} bölüm`,
                                                posterUrl: fieldText(modelData, "posterUrl"),
                                                playbackAllowed: Boolean(fieldValue(fieldValue(modelData, "featuredEpisode", null), "playbackAllowed", false))
                                            })
                                            cardKind: "episode"
                                            onActivated: {
                                                const seriesId = fieldText(modelData, "id")
                                                if (seriesId.length) {
                                                    openSeriesDetail(seriesId)
                                                }
                                            }
                                        }
                                    }
                                }

                                GlassCard {
                                    width: parent.width
                                    height: 180
                                    visible: filteredSeries().length === 0
                                    color: "#090c13"

                                    Column {
                                        anchors.centerIn: parent
                                        spacing: 8

                                        Text {
                                                text: "Filtreye uygun dizi bulunamadı"
                                            color: window.textPrimary
                                            font.pixelSize: 30
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }

                                        Text {
                                            text: "Aramayı temizleyip farklı bir kategori deneyebilirsiniz."
                                            color: window.textMuted
                                            font.pixelSize: 14
                                        }
                                    }
                                }
                            }
                            }

                            SeriesCatalogPage {
                                anchors.fill: parent
                                z: 100
                                seriesItems: filteredSeries()
                                seriesGroups: [""].concat(uniqueGroups(apiClient.series || []))
                                seriesTotal: (apiClient.series || []).length
                                selectedSeriesId: selectedSeriesId
                                selectedGroup: selectedSeriesGroup
                                searchText: seriesSearchText
                                compactWindow: window.compactWindow
                                panelColor: "#090c13"
                                surfaceColor: "#131923"
                                textPrimary: window.textPrimary
                                textMuted: window.textMuted
                                accentColor: window.accent
                                shellPadding: window.shellPadding
                                sectionSpacing: window.sectionSpacing
                                cardGap: window.cardGap
                                posterCardWidth: window.posterCardWidth
                                onSearchEdited: {
                                    seriesSearchText = text
                                }
                                onRefreshRequested: apiClient.fetchSeriesCatalog(1, 200, seriesSearchText)
                                onClearFiltersRequested: {
                                    seriesSearchText = ""
                                    selectedSeriesGroup = ""
                                }
                                onGroupSelected: function(group) {
                                    selectedSeriesGroup = group
                                }
                                onSeriesSelected: function(series) {
                                    const seriesId = fieldText(series, "id")
                                    if (seriesId.length) {
                                        openSeriesDetail(seriesId)
                                    }
                                }
                            }
                        }

                        Item {
                            anchors.fill: parent

                            ScrollView {
                                anchors.fill: parent
                                clip: true
                                visible: false
                                enabled: false
                            Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                property var activeSeries: selectedSeries()
                                property var activeEpisode: seriesLeadEpisode(activeSeries)

                                Flow {
                                    width: parent.width
                                    spacing: 12

                                    AppButton {
                                        text: "Dizilere Don"
                                        secondary: true
                                        implicitWidth: 148
                                        onClicked: openScreen("series")
                                    }

                                    AppButton {
                                                text: "Detayı Yenile"
                                        secondary: true
                                        implicitWidth: 148
                                        onClicked: apiClient.fetchSeriesCatalog(1, 200, seriesSearchText)
                                    }
                                }
                                GlassCard {
                                    width: parent.width
                                    height: window.compactWindow ? 430 : 340
                                    radius: 32
                                    color: "#090c13"
                                    clip: true
                                    visible: activeSeries !== null

                                    ArtworkPanel {
                                        anchors.fill: parent
                                        title: activeSeries ? activeSeries.title || "" : "Dizi"
                                        subtitle: activeSeries ? activeSeries.groupTitle || "Premium Dizi" : "Premium Dizi"
                                        sourceUrl: activeSeries ? (activeSeries.posterUrl || "") : ""
                                        kind: "episode"
                                        mode: "poster"
                                        cornerRadius: 32
                                    }

                                    Rectangle {
                                        anchors.fill: parent
                                        gradient: Gradient {
                                            GradientStop { position: 0.0; color: "#1605070b" }
                                            GradientStop { position: 0.28; color: "#2f0d1422" }
                                            GradientStop { position: 0.76; color: "#d205070b" }
                                            GradientStop { position: 1.0; color: "#f0080b11" }
                                        }
                                    }

                                    Column {
                                        anchors.fill: parent
                                        anchors.margins: window.compactWindow ? 22 : 28
                                        spacing: 14

                                        Row {
                                            spacing: 10

                                            Rectangle {
                                                width: 110
                                                height: 34
                                                radius: 17
                                                color: "#1d7cb6ff"
                                                border.width: 1
                                                border.color: "#397cb6ff"

                                                Text {
                                                    anchors.centerIn: parent
                                                    text: "Dizi Detay"
                                                    color: window.textPrimary
                                                    font.pixelSize: 12
                                                    font.bold: true
                                                }
                                            }

                                            Rectangle {
                                                width: detailMetaPill.implicitWidth + 24
                                                height: 34
                                                radius: 17
                                                color: "#14ffffff"

                                                Text {
                                                    id: detailMetaPill
                                                    anchors.centerIn: parent
                                            text: activeSeries ? `${Number(activeSeries.seasonCount || 0)} sezon • ${seriesTotalEpisodes(activeSeries)} bölüm` : "Dizi seçin"
                                                    color: window.textPrimary
                                                    font.pixelSize: 12
                                                    font.bold: true
                                                }
                                            }
                                        }

                                        Item { width: 1; height: 1 }

                                        Text {
                                            text: activeSeries ? activeSeries.title || "Dizi seçin" : "Dizi seçin"
                                            width: parent.width * (window.compactWindow ? 0.96 : 0.68)
                                            wrapMode: Text.WordWrap
                                            color: window.textPrimary
                                            font.pixelSize: window.compactWindow ? 34 : 48
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }

                                        Text {
                                            text: activeSeries ? (activeSeries.groupTitle || "Premium dizi seçimi") : ""
                                            color: "#d3d9e8"
                                            font.pixelSize: 15
                                            visible: text.length > 0
                                        }

                                        Text {
                                            width: parent.width * (window.compactWindow ? 0.98 : 0.6)
                                            wrapMode: Text.WordWrap
                                            color: "#bcc5d6"
                                            font.pixelSize: 15
                                            lineHeight: 1.35
                                            text: activeSeries
                                                  ? "Bölüm listesi ve oynatıcı aynı sayfada birlikte durur. Sorun olduğunda oynatıcı alanı kapanmadan tekrar deneme yapabilirsiniz."
                                                  : "Bir dizi seçildiğinde tüm sezonlar burada gösterilecek."
                                        }

                                        Flow {
                                            width: parent.width
                                            spacing: 12

                                            AppButton {
                                                text: "Öne Çıkan Bölümü Aç"
                                                implicitWidth: 210
                                                enabled: activeEpisode && activeEpisode.playbackAllowed !== false
                                                onClicked: if (activeEpisode && activeSeries) playEpisode(activeEpisode, activeSeries)
                                            }

                                            AppButton {
                                                text: inlineEpisodePlayerVisible() ? "Oynatıcıya Dön" : "İlk Bölümü Oynat"
                                                secondary: true
                                                implicitWidth: 190
                                                enabled: activeEpisode && activeEpisode.playbackAllowed !== false
                                                onClicked: if (activeEpisode && activeSeries) playEpisode(activeEpisode, activeSeries)
                                            }
                                        }
                                    }
                                }

                                GlassCard {
                                    width: parent.width
                                    height: 82
                                    radius: 24
                                    color: "#090c13"
                                    visible: playbackController.lastError.length > 0 && currentScreen === "series-detail"

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
                                                color: window.textPrimary
                                                font.pixelSize: 22
                                                font.bold: true
                                            }
                                        }

                                        Text {
                                            width: parent.width - 230
                                            anchors.verticalCenter: parent.verticalCenter
                                            wrapMode: Text.WordWrap
                                            text: playbackController.lastError
                                            color: "#ffb2b8"
                                            font.pixelSize: 14
                                        }

                                        AppButton {
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: "Tekrar Dene"
                                            secondary: true
                                            implicitWidth: 134
                                            onClicked: playbackController.retryCurrent()
                                        }
                                    }
                                }

                                Loader {
                                    width: parent.width
                                    active: false
                                    visible: false
                                    sourceComponent: inlineVodPlayerComponent
                                }
                                Flow {
                                    visible: false
                                    width: parent.width; spacing: window.cardGap
                                    GlassCard { width: window.compactWindow ? parent.width : 320; height: window.compactWindow ? 380 : 460; color: "#090c13"; ArtworkPanel { anchors.fill: parent; title: selectedSeries() ? selectedSeries().title : "Dizi"; subtitle: selectedSeries() ? (selectedSeries().groupTitle || "Premium Dizi") : "Premium Dizi"; sourceUrl: selectedSeries() ? (selectedSeries().posterUrl || "") : ""; kind: "episode"; mode: "poster"; cornerRadius: 28 } }
                                    GlassCard {
                                        width: window.compactWindow ? parent.width : parent.width - (320 + window.cardGap); height: window.compactWindow ? 320 : 460; color: "#090c13"
                                        Column {
                                            anchors.fill: parent; anchors.margins: window.compactWindow ? 22 : 28; spacing: 14
                                            Text { text: selectedSeries() ? selectedSeries().title : "Dizi seçin"; color: window.textPrimary; font.pixelSize: window.compactWindow ? 34 : 46; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap }
                                            Text { text: selectedSeries() ? (selectedSeries().groupTitle || "Seçkin dizi") : ""; color: window.textMuted; font.pixelSize: 16 }
                                            Text { width: parent.width * (window.compactWindow ? 1.0 : 0.8); wrapMode: Text.WordWrap; text: "Sezonları gezin, bölümü seçin ve native player yüzeyinde branded playback deneyimini kullanın."; color: window.textMuted; font.pixelSize: 15 }
                                            AppButton { text: "Öne Çıkan Bölümü Aç"; implicitWidth: 190; enabled: selectedSeries() && selectedSeries().featuredEpisode && selectedSeries().featuredEpisode.id; onClicked: playEpisode(selectedSeries().featuredEpisode, selectedSeries()) }
                                        }
                                    }
                                }
                                Repeater {
                                    model: activeSeries && activeSeries.seasons ? activeSeries.seasons : []
                                    GlassCard {
                                        width: parent.width; height: seasonContent.implicitHeight + 34; color: "#090c13"
                                        Column {
                                            id: seasonContent
                                            anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 18; spacing: 14
                                            Text { text: `${modelData.title} - ${modelData.episodeCount} bölüm`; color: window.textPrimary; font.pixelSize: 26; font.family: "Space Grotesk"; font.bold: true }
                                            Repeater {
                                                model: modelData.episodes || []
                                                Rectangle {
                                                    width: seasonContent.width; height: 80; radius: 20; color: "#131923"; border.width: 1; border.color: "#2a3140"
                                                    Row {
                                                        anchors.fill: parent; anchors.margins: 16; spacing: 18
                                                        Text { anchors.verticalCenter: parent.verticalCenter; text: `B${modelData.episodeNumber}`; color: "#a6ffffff"; font.pixelSize: 14; font.bold: true }
                                                        Column { anchors.verticalCenter: parent.verticalCenter; width: parent.width - 170; spacing: 4; Text { text: modelData.title; width: parent.width; elide: Text.ElideRight; color: window.textPrimary; font.pixelSize: 18; font.bold: true } Text { text: modelData.playbackAllowed ? "Hazır" : "Paket Gerekli"; color: modelData.playbackAllowed ? "#82ecc4" : window.textMuted; font.pixelSize: 13 } }
                                                        AppButton { anchors.verticalCenter: parent.verticalCenter; text: "Oynat"; implicitWidth: 110; enabled: modelData.playbackAllowed; onClicked: playEpisode(modelData, activeSeries) }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            }

                            SeriesDetailPage {
                                anchors.fill: parent
                                visible: true
                                activeSeries: selectedSeries()
                                activeEpisode: seriesLeadEpisode(selectedSeries())
                                playbackController: seriesPlaybackController
                                videoSurfaceComponent: vodVideoSurfaceComponent
                                playerVisible: inlineEpisodePlayerVisible()
                                windowIsFullscreen: seriesFullscreen
                                compactWindow: window.compactWindow
                                panelColor: window.panelStrong
                                surfaceColor: window.panelSoft
                                textPrimary: window.textPrimary
                                textMuted: window.textMuted
                                accentColor: window.accentStrong
                                shellPadding: window.shellPadding
                                sectionSpacing: window.sectionSpacing
                                onPlayEpisodeRequested: function(episode, series) { playEpisode(episode, series) }
                                onExitDetailRequested: {
                                    closeVodPlayer()
                                    currentScreen = "series"
                                }
                                onClosePlayerRequested: closeVodPlayer()
                                onToggleWindowFullscreenRequested: toggleSeriesFullscreen()
                                onRetryPlaybackRequested: seriesPlaybackController.retryCurrent()
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                Text { text: "Profil"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: [
                                            { title: "Profil Ayarları", copy: "Kullanıcı ve bağlantı bilgilerini görüntüleyin.", action: "Ayarlar", screen: "settings" },
                                            { title: "Paketler", copy: "Aktif paketleri görüp satın alım talebi oluşturun.", action: "Paketleri Gör", screen: "packages" },
                                            { title: "Ödeme Bildirimi", copy: "Ödeme taleplerinin durumunu takip edin.", action: "Bildirimleri Gör", screen: "payments" },
                                            { title: "İletişim", copy: "Destek ekibine WhatsApp veya Telegram üzerinden ulaşın.", action: "İletişime Geç", screen: "contact" }
                                        ]
                                        GlassCard {
                                            width: window.compactWindow ? parent.width : window.gridCardWidth(parent.width, 280, 2); height: 210; color: "#090c13"
                                            Column { anchors.fill: parent; anchors.margins: 22; spacing: 12; Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 26; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap } Text { text: modelData.copy; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 14 } AppButton { text: modelData.action; secondary: modelData.screen !== "packages"; implicitWidth: 160; onClicked: openScreen(modelData.screen) } }
                                        }
                                    }
                                }
                            }

                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: 24
                                Row {
                                    width: parent.width
                                    spacing: 14

                                    BackIconButton { onClicked: openScreen("profile") }

                                    Column {
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 2

                                        Text {
                                            text: "Premium Paketler"
                                            color: window.textPrimary
                                            font.pixelSize: 42
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }

                                    }
                                }

                                Flow {
                                    width: parent.width
                                    spacing: 18

                                    Repeater {
                                        model: orderedPackages()

                                        GlassCard {
                                            width: window.compactWindow
                                                   ? window.gridCardWidth(parent.width, 280, 2)
                                                   : Math.floor((parent.width - 54) / 4)
                                            height: 392
                                            color: packageRecommended(modelData) ? "#0b1019" : "#090c13"
                                            border.color: packageRecommended(modelData) ? "#44ff4b56" : "#18ffffff"

                                            Rectangle {
                                                anchors.left: parent.left
                                                anchors.right: parent.right
                                                anchors.top: parent.top
                                                height: 5
                                                radius: 3
                                                gradient: Gradient {
                                                    GradientStop { position: 0.0; color: packageRecommended(modelData) ? "#00ff2432" : "#00ffffff" }
                                                    GradientStop { position: 0.35; color: packageRecommended(modelData) ? "#c7ff2432" : "#3ce50914" }
                                                    GradientStop { position: 1.0; color: "#00ffffff" }
                                                }
                                            }

                                            Column {
                                                anchors.fill: parent
                                                anchors.margins: 24
                                                spacing: 14

                                                Text {
                                                    width: parent.width
                                                    text: packageDisplayTitle(modelData)
                                                    color: window.textPrimary
                                                    font.pixelSize: 34
                                                    font.family: "Space Grotesk"
                                                    font.bold: true
                                                    wrapMode: Text.WordWrap
                                                }

                                                Row {
                                                    width: parent.width
                                                    spacing: 8

                                                    Text {
                                                        text: packageDisplayPrice(modelData)
                                                        color: window.textPrimary
                                                        font.pixelSize: 32
                                                        font.family: "Space Grotesk"
                                                        font.bold: true
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
                                                        model: packageFeatureList(modelData)

                                                        Row {
                                                            id: featureRow
                                                            width: parent.width
                                                            spacing: 10

                                                            Rectangle {
                                                                width: 14
                                                                height: 14
                                                                radius: 7
                                                                anchors.verticalCenter: parent.verticalCenter
                                                                color: packageRecommended(modelData) ? "#ff2432" : "#2b3443"

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
                                                                color: window.textPrimary
                                                                font.pixelSize: 14
                                                                lineHeight: 1.2
                                                            }
                                                        }
                                                    }
                                                }

                                                Item { width: 1; height: 8 }

                                                Rectangle {
                                                    width: parent.width
                                                    height: 1
                                                    color: "#14ffffff"
                                                }

                                                Item { width: 1; height: 6 }

                                                AppButton {
                                                    width: parent.width
                                                    text: "Paketi Seç"
                                                    glow: packageRecommended(modelData)
                                                    onClicked: {
                                                        pendingPackage = modelData
                                                        selectedPaymentMethodId = ""
                                                        selectedCryptoAssetId = ""
                                                        apiClient.fetchPaymentMethods()
                                                    }
                                                }
                                            }

                                        }
                                    }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                Row { spacing: 12; BackIconButton { onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Ödeme Bildirimi"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Repeater {
                                    model: apiClient.paymentRequests
                                    GlassCard { width: parent.width; height: 104; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 6; Text { text: modelData.packageTitle; color: window.textPrimary; font.pixelSize: 22; font.family: "Space Grotesk"; font.bold: true } Text { text: modelData.status; color: window.textMuted; font.pixelSize: 14 } Text { text: modelData.createdAt; color: "#8e98aa"; font.pixelSize: 13 } } }
                                }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                Row { spacing: 12; BackIconButton { onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Ayarlar"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: [
                                            { label: "Kullanıcı Kodu", value: userData().kryptoniteCode || "-" },
                                            { label: "Aktif Paket", value: userData().activePackage ? userData().activePackage.title : "Yok" },
                                            { label: "Link Durumu", value: userData().hasAssignedLink ? "Bagli" : "Admin atamasi bekleniyor" },
                                            { label: "Abonelik", value: subscriptionLabel() }
                                        ]
                                        GlassCard { width: window.compactWindow ? parent.width : window.gridCardWidth(parent.width, 280, 2); height: 126; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 8; Text { text: modelData.label; color: window.textMuted; font.pixelSize: 13 } Text { text: modelData.value; width: parent.width; wrapMode: Text.WordWrap; color: window.textPrimary; font.pixelSize: 22; font.family: "Space Grotesk"; font.bold: true } } }
                                    }
                                }
                                Row { spacing: 12; AppButton { text: "Paketler"; implicitWidth: 128; onClicked: openScreen("packages") } AppButton { text: "Ödemeler"; secondary: true; implicitWidth: 128; onClicked: openScreen("payments") } AppButton { text: "İletişim"; secondary: true; implicitWidth: 128; onClicked: openScreen("contact") } }
                            }
                        }

                        ScrollView {
                            clip: true
                            Column {
                                width: window.pageWidth(pageStack.width)
                                x: window.shellPadding
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                Row { spacing: 12; BackIconButton { onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "İletişim"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                GlassCard {
                                    width: parent.width; height: 200; color: "#090c13"
                                    Column {
                                        anchors.fill: parent; anchors.margins: 24; spacing: 12
                                        Text { text: "Destek ekibine hızlı ulaşın"; color: window.textPrimary; font.pixelSize: 32; font.family: "Space Grotesk"; font.bold: true }
                                        Text { text: "Aktivasyon, paket ve ödeme süreçleri için WhatsApp veya Telegram kullanın."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
                                        Row { spacing: 12; AppButton { text: "WhatsApp"; implicitWidth: 140; onClicked: Qt.openUrlExternally(contactData().whatsapp || "") } AppButton { text: "Telegram"; secondary: true; implicitWidth: 140; onClicked: Qt.openUrlExternally(contactData().telegram || "") } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Item {
            anchors.fill: parent
            visible: shouldShowBlocked()
            ColumnLayout {
                anchors.centerIn: parent
                width: window.blockedPanelWidth
                spacing: 18
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: window.shortWindow ? 220 : 250
                    color: "#0a0d14"
                    Column { anchors.fill: parent; anchors.margins: 28; spacing: 14; Text { text: "Erişim Durdu"; color: window.textPrimary; font.pixelSize: 44; font.family: "Space Grotesk"; font.bold: true } Text { text: "Hesabınız şu anda engelli. Destek ekibi ile iletişime geçerek tekrar aktivasyon talep edebilirsiniz."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 16 } Row { spacing: 12; AppButton { text: "WhatsApp"; implicitWidth: 144; onClicked: Qt.openUrlExternally(contactData().whatsapp || "") } AppButton { text: "Telegram"; secondary: true; implicitWidth: 144; onClicked: Qt.openUrlExternally(contactData().telegram || "") } AppButton { text: "Çıkış"; secondary: true; implicitWidth: 120; onClicked: apiClient.logout() } } }
                }
            }
        }


        Rectangle {
            anchors.fill: parent; color: "#d9030508"; visible: pendingPackage !== null; z: 30
            GlassCard {
                width: window.modalPanelWidth; height: paymentContent.implicitHeight + 44; anchors.centerIn: parent; color: "#0b0f17"; z: 31
                Column {
                    id: paymentContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 22; spacing: 18
                    Item {
                        width: parent.width
                        height: 44
                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            text: "Ödeme Yöntemi"
                            color: "#d8ffffff"
                            font.pixelSize: 12
                            font.bold: true
                        }
                        Rectangle {
                            width: 46
                            height: 46
                            radius: 23
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            color: "#131923"
                            border.color: "#2a3140"
                            Canvas {
                                anchors.centerIn: parent
                                width: 18
                                height: 18
                                onPaint: {
                                    const ctx = getContext("2d")
                                    ctx.reset()
                                    ctx.strokeStyle = "#f4f6fb"
                                    ctx.lineWidth = 2.2
                                    ctx.lineCap = "round"
                                    ctx.beginPath()
                                    ctx.moveTo(4, 4)
                                    ctx.lineTo(width - 4, height - 4)
                                    ctx.moveTo(width - 4, 4)
                                    ctx.lineTo(4, height - 4)
                                    ctx.stroke()
                                }
                            }
                            MouseArea {
                                anchors.fill: parent
                                hoverEnabled: false
                                cursorShape: Qt.PointingHandCursor
                                onClicked: closePaymentModal()
                            }
                        }
                    }
                    Text {
                        text: pendingPackage ? `${pendingPackage.title} paketi için ödeme yöntemi seçin` : ""
                        color: window.textPrimary
                        width: parent.width
                        wrapMode: Text.WordWrap
                        font.pixelSize: 34
                        font.family: "Space Grotesk"
                        font.bold: true
                    }
                    Flow {
                        width: parent.width; spacing: 12
                        Repeater {
                            model: paymentMethods()
                            GlassCard {
                                width: window.gridCardWidth(parent.width, 300, 2)
                                height: 108
                                color: selectedPaymentMethodId === modelData.id ? "#1be50914" : "#131923"
                                border.color: selectedPaymentMethodId === modelData.id ? "#b91c1c" : "#2a3140"
                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 18
                                    spacing: 8
                                    Text {
                                        text: modelData.label || modelData.id
                                        color: window.textPrimary
                                        font.pixelSize: 20
                                        font.bold: true
                                        font.family: "Space Grotesk"
                                    }
                                    Text {
                                        text: modelData.details || "Ödeme onayı destek ekibi tarafından tamamlanır."
                                        width: parent.width
                                        wrapMode: Text.WordWrap
                                        color: window.textMuted
                                        font.pixelSize: 13
                                    }
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    hoverEnabled: false
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: selectPaymentMethod(modelData.id)
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
                        border.color: "#222b38"
                        Column {
                            id: detailsColumn
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.margins: 18
                            spacing: 12
                            Text {
                                text: selectedPaymentMethodId === "bank-transfer-eft"
                                    ? "Banka transfer bilgileri"
                                    : selectedPaymentMethodId === "crypto"
                                        ? "Kripto ödeme bilgileri"
                                        : "Ödeme detayları"
                                color: window.textPrimary
                                font.pixelSize: 20
                                font.bold: true
                                font.family: "Space Grotesk"
                            }
                            Flow {
                                width: parent.width
                                spacing: 12
                                visible: selectedPaymentMethodId === "crypto"
                                Repeater {
                                    model: paymentCryptoAssets()
                                    Rectangle {
                                        readonly property string cryptoLogoSource: paymentCryptoAssetLogo(modelData)
                                        width: 168
                                        height: 74
                                        radius: 20
                                        color: selectedCryptoAssetId === (modelData.id || "").toString()
                                            ? paymentCryptoAssetBg(modelData.id)
                                            : "#0c1119"
                                        border.color: selectedCryptoAssetId === (modelData.id || "").toString()
                                            ? paymentCryptoAssetAccent(modelData.id)
                                            : "#212a36"
                                        Row {
                                            anchors.fill: parent
                                            anchors.margins: 14
                                            spacing: 12
                                            Rectangle {
                                                width: 44
                                                height: 44
                                                radius: 22
                                                color: "#ffffff"
                                                border.width: 1
                                                border.color: "#18ffffff"
                                                clip: true
                                                Image {
                                                    id: cryptoLogoImage
                                                    anchors.fill: parent
                                                    anchors.margins: 7
                                                    source: cryptoLogoSource
                                                    fillMode: Image.PreserveAspectFit
                                                    smooth: true
                                                    mipmap: true
                                                    visible: cryptoLogoSource.length > 0 && status === Image.Ready
                                                }
                                                Text {
                                                    anchors.centerIn: parent
                                                    text: paymentCryptoAssetSymbol(modelData)
                                                    color: "#0b0f17"
                                                    font.pixelSize: paymentCryptoAssetSymbol(modelData).length > 3 ? 10 : 12
                                                    font.bold: true
                                                    font.family: "Space Grotesk"
                                                    visible: cryptoLogoSource.length === 0 || cryptoLogoImage.status === Image.Error
                                                }
                                            }
                                            Column {
                                                anchors.verticalCenter: parent.verticalCenter
                                                spacing: 4
                                                Text {
                                                    text: modelData.label || modelData.symbol || "Kripto"
                                                    color: window.textPrimary
                                                    font.pixelSize: 15
                                                    font.bold: true
                                                    font.family: "Space Grotesk"
                                                    width: 84
                                                    elide: Text.ElideRight
                                                }
                                                Text {
                                                    text: paymentCryptoAssetSymbol(modelData)
                                                    color: window.textMuted
                                                    font.pixelSize: 12
                                                }
                                            }
                                        }
                                        MouseArea {
                                            anchors.fill: parent
                                            hoverEnabled: false
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: selectedCryptoAssetId = (modelData.id || "").toString()
                                        }
                                    }
                                }
                            }
                            Repeater {
                                model: paymentInstructionRows()
                                Rectangle {
                                    width: detailsColumn.width
                                    implicitHeight: infoRow.implicitHeight + 24
                                    radius: 18
                                    color: "#0c1119"
                                    border.color: "#212a36"
                                    Row {
                                        id: infoRow
                                        anchors.left: parent.left
                                        anchors.right: parent.right
                                        anchors.top: parent.top
                                        anchors.margins: 14
                                        spacing: 14
                                        Column {
                                            width: parent.width - 126
                                            spacing: 6
                                            Text {
                                                text: modelData.label
                                                color: window.textMuted
                                                font.pixelSize: 12
                                                font.bold: true
                                            }
                                            Text {
                                                text: modelData.value
                                                width: parent.width
                                                wrapMode: Text.WrapAnywhere
                                                color: window.textPrimary
                                                font.pixelSize: 17
                                                font.bold: true
                                                font.family: "Space Grotesk"
                                            }
                                        }
                                        AppButton {
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: "Kopyala"
                                            secondary: true
                                            implicitWidth: 112
                                            implicitHeight: 46
                                            onClicked: copyPaymentValue(modelData.label, modelData.value)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    AppButton {
                        width: parent.width
                        text: "Ödeme Bildir"
                        enabled: selectedPaymentMethod() !== null
                                 && (selectedPaymentMethodId !== "crypto" || selectedCryptoAsset() !== null)
                                 && !apiClient.busy
                        onClicked: {
                            apiClient.requestPayment(
                                pendingPackage.slug,
                                selectedPaymentMethodId,
                                selectedPaymentMethodId === "crypto" && selectedCryptoAsset()
                                    ? (selectedCryptoAsset().id || "").toString()
                                    : ""
                            )
                            if (contactData().whatsapp) Qt.openUrlExternally(contactData().whatsapp)
                            closePaymentModal()
                            openScreen("payments")
                        }
                    }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#d9030508"; visible: shouldShowPremiumPopup(); z: 25; focus: visible
            Keys.onPressed: function(event) { event.accepted = true }
            MouseArea {
                anchors.fill: parent
                acceptedButtons: Qt.AllButtons
                hoverEnabled: true
                propagateComposedEvents: false
                onPressed: function(mouse) { mouse.accepted = true }
                onReleased: function(mouse) { mouse.accepted = true }
                onClicked: function(mouse) { mouse.accepted = true }
                onDoubleClicked: function(mouse) { mouse.accepted = true }
                onWheel: function(wheel) { wheel.accepted = true }
            }
            GlassCard {
                width: window.premiumPanelWidth; height: premiumContent.implicitHeight + 40; anchors.centerIn: parent; color: "#0b0f17"; z: 26
                Column {
                    id: premiumContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 22; spacing: 16
                    Row { width: parent.width; Rectangle { width: 112; height: 34; radius: 17; color: "#33e50914"; Text { anchors.centerIn: parent; text: "Premium Erişim"; color: "#ffd7da"; font.pixelSize: 12; font.bold: true } } }
                    Text { text: "Tüm içeriklere erişmek için aktif bir paket satın alın"; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Text { text: "Giriş başarılı. Paketiniz aktif olunca katalogların tamamı açılacak."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
                    Row {
                        spacing: 12
                        AppButton {
                            text: "Test Yapmak İstiyorum"
                            implicitWidth: 190
                            onClicked: apiClient.requestTrial(platformTrialRequestNote())
                        }
                        AppButton {
                            text: "WhatsApp ile İletişime Geç"
                            secondary: true
                            implicitWidth: 220
                            onClicked: openScreen("contact")
                        }
                        AppButton {
                            text: "Paket Satın Al"
                            secondary: true
                            implicitWidth: 170
                            onClicked: openScreen("packages")
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: toastMessage.length > 0; z: 40; width: Math.min(640, toastLabel.implicitWidth + 52); height: 62; radius: 8; color: toastColor === success ? "#2230d19d" : toastColor === danger ? "#24ff7d86" : "#227cb6ff"; border.width: 1; border.color: toastColor; anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 24
            Text { id: toastLabel; anchors.centerIn: parent; text: toastMessage; color: window.textPrimary; font.pixelSize: 14; font.bold: true }
        }

        // Smart Title Bar (hover to show in fullscreen)
        Item {
            id: smartTitleBarContainer
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 48
            z: 100
            visible: !window.isMacOS && opacity > 0
            opacity: !window.isMacOS && (titleBarMouseArea.containsMouse || titleBarMouseArea.containsPress) ? 1.0 : 0.0
            Behavior on opacity { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }

            // Background
            Rectangle {
                anchors.fill: parent
                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#e605070b" }
                    GradientStop { position: 1.0; color: "#0005070b" }
                }
            }

            // Title
            Text {
                anchors.centerIn: parent
                text: window.title
                color: window.textPrimary
                font.pixelSize: 14 * fontScale
                font.bold: true
                font.family: "Space Grotesk"
            }

            // Window controls
            Row {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.rightMargin: 16
                spacing: 8

                // Minimize button
                Rectangle {
                    width: 36; height: 28; radius: 6
                    color: minimizeMouse.containsMouse ? "#2affffff" : "#18ffffff"
                    Behavior on color { ColorAnimation { duration: 120 } }

                    Text {
                        anchors.centerIn: parent
                        text: "−"
                        color: window.textPrimary
                        font.pixelSize: 16
                        font.bold: true
                    }

                    MouseArea {
                        id: minimizeMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: window.showMinimized()
                    }
                }

                // Restore/Maximize button
                Rectangle {
                    width: 36; height: 28; radius: 6
                    color: restoreMouse.containsMouse ? "#2affffff" : "#18ffffff"
                    Behavior on color { ColorAnimation { duration: 120 } }

                    Text {
                        anchors.centerIn: parent
                        text: window.visibility === Window.FullScreen ? "❐" : "□"
                        color: window.textPrimary
                        font.pixelSize: 14
                    }

                    MouseArea {
                        id: restoreMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: toggleWindowFullscreen()
                    }
                }

                // Close button
                Rectangle {
                    width: 36; height: 28; radius: 6
                    color: closeMouse.containsMouse ? "#e50914" : "#18ffffff"
                    Behavior on color { ColorAnimation { duration: 120 } }

                    Text {
                        anchors.centerIn: parent
                        text: "×"
                        color: window.textPrimary
                        font.pixelSize: 18
                        font.bold: true
                    }

                    MouseArea {
                        id: closeMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: requestAppQuit()
                    }
                }
            }

            // Mouse area for hover detection
            MouseArea {
                id: titleBarMouseArea
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.NoButton
            }
        }

        // Top edge hot zone for title bar
        MouseArea {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 8
            visible: !window.isMacOS
            hoverEnabled: true
            acceptedButtons: Qt.NoButton
            z: 99
            onEntered: titleBarShowTimer.start()
            onPositionChanged: {
                titleBarShowTimer.stop()
                titleBarShowTimer.start()
            }

            Timer {
                id: titleBarShowTimer
                interval: 3000
                onTriggered: {}
            }
        }

        // Exit Confirmation Dialog
        Rectangle {
            id: confirmExitDialog
            anchors.fill: parent
            color: "#cc000000"
            z: 200
            visible: opacity > 0
            opacity: 0.0

            function open() {
                opacity = 1.0
            }

            function close() {
                opacity = 0.0
            }

            Behavior on opacity { NumberAnimation { duration: 200 } }

            // Close on background click
            MouseArea {
                anchors.fill: parent
                onClicked: confirmExitDialog.close()
            }

            GlassCard {
                anchors.centerIn: parent
                width: 420
                height: 220
                color: "#0d121c"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 28
                    spacing: 20

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: "Çıkış yapmak istiyor musunuz?"
                        color: window.textPrimary
                        font.pixelSize: 22 * fontScale
                        font.bold: true
                        font.family: "Space Grotesk"
                    }

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        Layout.fillWidth: true
                        text: "Flixify Pro'dan cikmak istediginize emin misiniz?"
                        color: window.textMuted
                        font.pixelSize: 14 * fontScale
                        wrapMode: Text.WordWrap
                        horizontalAlignment: Text.AlignHCenter
                    }

                    RowLayout {
                        Layout.alignment: Qt.AlignHCenter
                        spacing: 16

                        AppButton {
                            text: "Iptal"
                            secondary: true
                            implicitWidth: 120
                            onClicked: confirmExitDialog.close()
                        }

                        AppButton {
                            text: "Çıkış"
                            implicitWidth: 120
                            onClicked: Qt.quit()
                        }
                    }
                }
            }
        }

        // Global shortcuts
        Shortcut {
            sequence: "Esc"
            onActivated: {
                if (videoFullscreen) {
                    exitVideoFullscreen()
                } else if (movieFullscreen) {
                    exitMovieFullscreen()
                } else if (seriesFullscreen) {
                    exitSeriesFullscreen()
                } else if (window.visibility === Window.FullScreen) {
                    window.showNormal()
                } else if (confirmExitDialog.visible) {
                    confirmExitDialog.close()
                } else if (!window.isMacOS && currentScreen !== "login") {
                    if (currentScreen === "home" || currentScreen === "movies" || currentScreen === "series" || currentScreen === "live") {
                        confirmExitDialog.open()
                    } else {
                        openScreen("home")
                    }
                } else if (!window.isMacOS) {
                    confirmExitDialog.open()
                }
            }
        }

        Shortcut {
            sequence: "F11"
            enabled: !window.isMacOS
            onActivated: {
                if (inlineLivePlayerVisible()) {
                    toggleVideoFullscreen()
                } else if (inlineMoviePlayerVisible()) {
                    toggleMovieFullscreen()
                } else if (inlineEpisodePlayerVisible()) {
                    toggleSeriesFullscreen()
                } else {
                    toggleWindowFullscreen()
                }
            }
        }

        Shortcut {
            sequence: "Ctrl+Meta+F"
            enabled: window.isMacOS
            onActivated: {
                if (inlineLivePlayerVisible()) {
                    toggleVideoFullscreen()
                } else if (inlineMoviePlayerVisible()) {
                    toggleMovieFullscreen()
                } else if (inlineEpisodePlayerVisible()) {
                    toggleSeriesFullscreen()
                } else {
                    toggleWindowFullscreen()
                }
            }
        }

        Shortcut {
            sequence: "Meta+Q"
            enabled: window.isMacOS
            onActivated: requestAppQuit()
        }

        Shortcut {
            sequence: "Meta+W"
            enabled: window.isMacOS
            onActivated: {
                if (playerVisible || overlayPlayerVisible()) {
                    closeActivePlayer()
                }
            }
        }

        Shortcut {
            sequence: "Alt+F4"
            enabled: !window.isMacOS
            onActivated: requestAppQuit()
        }
    }
}
