import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import Flixify.Native 1.0

ApplicationWindow {
    id: window
    width: 1540
    height: 960
    minimumWidth: 980
    minimumHeight: 700
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
    property bool premiumPopupDismissed: false
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
    property bool liveControlsVisible: false
    property bool videoFullscreen: false
    property var pendingPackage: null
    property string selectedPaymentMethodId: ""
    property string toastMessage: ""
    property color toastColor: info

    Component.onCompleted: {
        playbackController.videoFillMode = "fill"
        currentScreen = apiClient.authenticated ? "home" : "login"
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
        return apiClient.me && apiClient.me.contact ? apiClient.me.contact : ({})
    }

    function hasLoadedUser() {
        const user = userData()
        return Boolean(user && user.id)
    }

    function subscriptionLabel() {
        const user = userData()
        if (user.hasActiveSubscription && user.activePackage) {
            return `${user.activePackage.title} - ${user.activePackage.remainingDays} gun`
        }
        return "Paket aktif degil"
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
        const normalizedTitle = normalizeAsciiText(title)
        const match = normalizedTitle.match(/^([a-z]{2,3})\s*[:\-]/)
        if (!match || !match[1]) {
            return null
        }
        return normalizeLiveCountryCode(match[1])
    }

    function parseLiveCountryCodeFromExplicitGroupTitle(title) {
        const normalizedTitle = normalizeAsciiText(title)
        if (!/^[a-z]{2,3}$/.test(normalizedTitle)) {
            return null
        }
        return normalizeLiveCountryCode(normalizedTitle)
    }

    function getLiveCountryLabel(code) {
        const normalizedCode = normalizeLiveCountryCode(code)
        if (!normalizedCode) {
            return safeText(code)
        }
        if (normalizedCode === "TR") {
            return "Turkiye"
        }
        return normalizedCode
    }

    function liveGroupsData() {
        return apiClient.liveGroups || []
    }

    function liveCountryChips() {
        const groups = liveGroupsData()
        const counts = {}
        const prefixFallbackBuckets = []

        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            const explicitCountryCode = parseLiveCountryCodeFromExplicitGroupTitle(group.title)
            if (explicitCountryCode) {
                counts[explicitCountryCode] = (counts[explicitCountryCode] || 0) + Number(group.count || 0)
            }
        }

        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            if (parseLiveCountryCodeFromExplicitGroupTitle(group.title)) {
                continue
            }
            const countryCodeFromPrefix = parseLiveCountryCodeFromGroupPrefix(group.title)
            if (countryCodeFromPrefix) {
                prefixFallbackBuckets.push({ code: countryCodeFromPrefix, count: Number(group.count || 0) })
            }
        }

        for (let index = 0; index < prefixFallbackBuckets.length; index += 1) {
            const bucket = prefixFallbackBuckets[index]
            if (counts[bucket.code]) {
                continue
            }
            counts[bucket.code] = (counts[bucket.code] || 0) + bucket.count
        }

        const chips = []
        const codes = Object.keys(counts)
        for (let index = 0; index < codes.length; index += 1) {
            const code = codes[index]
            chips.push({
                code,
                count: counts[code],
                filter: buildLiveCountryFilter(code),
                label: getLiveCountryLabel(code)
            })
        }

        chips.sort((left, right) => {
            if (left.code === "TR" && right.code !== "TR") return -1
            if (right.code === "TR" && left.code !== "TR") return 1
            if (right.count !== left.count) return right.count - left.count
            return left.label.localeCompare(right.label, "tr-TR")
        })

        const activeCountryCode = parseLiveCountryCodeFromFilter(selectedLiveGroup)
        if (activeCountryCode) {
            let exists = false
            for (let index = 0; index < chips.length; index += 1) {
                if (chips[index].code === activeCountryCode) {
                    exists = true
                    break
                }
            }
            if (!exists) {
                chips.unshift({
                    code: activeCountryCode,
                    count: 0,
                    filter: buildLiveCountryFilter(activeCountryCode),
                    label: getLiveCountryLabel(activeCountryCode)
                })
            }
        }

        return chips
    }

    function liveGroupChips() {
        const groups = liveGroupsData()
        const output = []
        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]
            if (parseLiveCountryCodeFromExplicitGroupTitle(group.title)) {
                continue
            }
            if (parseLiveCountryCodeFromGroupPrefix(group.title)) {
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
        apiClient.fetchMovieCatalog(1, 18, normalizedSearch, normalizedGroup)
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
            const haystack = normalizeText(`${item.title || ""} ${item.groupTitle || ""}`)
            if (searchText.length && haystack.indexOf(searchText) === -1) {
                continue
            }
            if (groupText.length && normalizeText(item.groupTitle) !== groupText) {
                continue
            }
            output.push(item)
        }
        return output
    }

    function filteredMovies() { return apiClient.movies || [] }
    function filteredSeries() { return filterItems(apiClient.series || [], seriesSearchText, selectedSeriesGroup) }
    function filteredLiveItems() { return apiClient.liveChannels || [] }

    function selectedMovie() {
        const items = apiClient.movies || []
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === selectedMovieId) {
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
            if (items[index].id === selectedSeriesId) {
                return items[index]
            }
        }
        return items.length ? items[0] : null
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
    
    function previousLiveChannel() {
        const items = filteredLiveItems()
        if (items.length < 2) return
        
        let currentIndex = -1
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === selectedLiveId) {
                currentIndex = i
                break
            }
        }
        
        if (currentIndex === -1) currentIndex = 0
        const previousIndex = currentIndex === 0 ? items.length - 1 : currentIndex - 1
        selectedLiveId = items[previousIndex].id
        playLive(items[previousIndex])
    }
    
    function nextLiveChannel() {
        const items = filteredLiveItems()
        if (items.length < 2) return
        
        let currentIndex = -1
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === selectedLiveId) {
                currentIndex = i
                break
            }
        }
        
        if (currentIndex === -1) currentIndex = 0
        const nextIndex = currentIndex === items.length - 1 ? 0 : currentIndex + 1
        selectedLiveId = items[nextIndex].id
        playLive(items[nextIndex])
    }
    
    function featuredSeriesEpisodes() {
        const series = apiClient.series || []
        const output = []
        for (let index = 0; index < series.length; index += 1) {
            const item = series[index]
            const episode = item.featuredEpisode && item.featuredEpisode.id
                          ? item.featuredEpisode
                          : item.seasons && item.seasons.length && item.seasons[0].episodes && item.seasons[0].episodes.length
                            ? item.seasons[0].episodes[0]
                            : null
            if (!episode) {
                continue
            }
            output.push({
                id: episode.id,
                kind: "episode",
                title: item.title,
                subtitle: `${item.seasonCount} sezon - ${item.episodeCount} bolum`,
                posterUrl: item.posterUrl,
                playbackAllowed: episode.playbackAllowed,
                seriesId: item.id
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
                subtitle: movie.groupTitle || "Film secimi",
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
                subtitle: live.groupTitle || "Canli TV",
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

    function currentPlaybackItem() {
        if (inlinePlaybackMode === "movie") return selectedMovie() || apiClient.movieById(playbackController.activeContentId)
        if (playbackController.activeContentKind === "episode") return apiClient.episodeById(playbackController.activeContentId)
        if (playbackController.activeContentKind === "live") return apiClient.liveChannelById(playbackController.activeContentId)
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
            !premiumPopupDismissed &&
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
    function toggleWindowFullscreen() {
        if (window.visibility === Window.FullScreen) {
            window.showNormal()
            return
        }
        window.showFullScreen()
    }
    function toggleVideoFullscreen() {
        if (videoFullscreen) {
            exitVideoFullscreen()
            return
        }
        videoFullscreen = true
        if (window.visibility !== Window.FullScreen) {
            window.showFullScreen()
        }
        showLiveControls()
    }
    function exitVideoFullscreen() {
        videoFullscreen = false
        window.showNormal()
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
    function showLiveControls() {
        liveControlsVisible = true
        if (currentScreen === "live" && playerVisible && selectedLiveItem() !== null && selectedLiveItem().playbackAllowed !== false) {
            liveControlsHideTimer.restart()
        }
    }

    function openScreen(screenName) {
        if (videoFullscreen && screenName !== "live") {
            exitVideoFullscreen()
        }
        if (playerVisible && screenName !== currentScreen) {
            closePlayer()
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

    function openSeriesDetail(seriesId) {
        if (playerVisible && currentScreen === "series-detail" && selectedSeriesId !== seriesId) {
            closePlayer()
        }
        selectedSeriesId = seriesId
        currentScreen = "series-detail"
    }

    function playMovie(movie) {
        if (!movie || !movie.id) return
        if (playerVisible && (inlinePlaybackMode !== "movie" || currentScreen !== "movies")) {
            closePlayer()
        }
        if (currentScreen !== "movies") {
            currentScreen = "movies"
        }
        selectedMovieId = movie.id
        playerSubtitle = movie.groupTitle || "Film"
        playerImageUrl = movie.posterUrl || ""
        playerVisible = true
        inlinePlaybackMode = "movie"
        playbackController.playVod("movie", movie.id, movie.title)
    }

    function playEpisode(episode, series) {
        if (!episode || !episode.id) return
        if (playerVisible && (inlinePlaybackMode !== "episode" || currentScreen !== "series-detail")) {
            closePlayer()
        }
        if (series && series.id) {
            selectedSeriesId = series.id
        }
        if (currentScreen !== "series-detail") {
            currentScreen = "series-detail"
        }
        playerSubtitle = series && series.title ? series.title : "Dizi"
        playerImageUrl = series && series.posterUrl ? series.posterUrl : ""
        playerVisible = true
        inlinePlaybackMode = "episode"
        playbackController.playVod("episode", episode.id, episode.title)
    }

    function playLive(channel, forceRestart) {
        if (!channel || !channel.id) return
        if (playerVisible && (inlinePlaybackMode !== "live" || currentScreen !== "live")) {
            closePlayer()
        }
        if (currentScreen !== "live") {
            currentScreen = "live"
        }
        selectedLiveId = channel.id
        playerSubtitle = channel.groupTitle || "Canlı TV"
        playerImageUrl = channel.logoUrl || ""
        if (channel.playbackAllowed === false) {
            if (playbackController.activeContentKind === "live") {
                playbackController.stop()
            }
            playerVisible = false
            inlinePlaybackMode = "none"
            liveControlsVisible = false
            return
        }
        playerVisible = true
        inlinePlaybackMode = "live"
        showLiveControls()
        const sameChannel = playbackController.activeContentKind === "live" && playbackController.activeChannelId === channel.id
        if (sameChannel && !forceRestart) {
            return
        }
        playbackController.playChannel(channel.id)
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

    function closePlayer() {
        playerVisible = false
        inlinePlaybackMode = "none"
        selectedMovieId = ""
        liveControlsVisible = false
        playbackController.stop()
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
        id: liveControlsHideTimer
        interval: 3000
        repeat: false
        onTriggered: {
            if (currentScreen !== "live" || !inlineLivePlayerVisible()) {
                liveControlsVisible = false
                return
            }
            if (liveVolumeSlider.pressed) {
                restart()
                return
            }
            liveControlsVisible = false
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

    Connections {
        target: apiClient
        function onAuthenticatedChanged() {
            if (apiClient.authenticated) {
                if (currentScreen === "login" || currentScreen === "register") {
                    currentScreen = "home"
                }
                return
            }
            if (!apiClient.restoringSession && currentScreen !== "register") {
                currentScreen = "login"
            }
        }
        function onLoginSucceeded() { currentScreen = "home"; premiumPopupDismissed = false; showAuthCode = false; authCode = "" }
        function onAnonCodeIssued(code) { issuedCode = sanitizeCode(code); revealedCount = 0; scrambleSeed = 0; revealWarmupTicks = 8; registerAcknowledged = false; authCode = ""; showAuthCode = false; currentScreen = "register"; revealTimer.interval = 132; revealTimer.restart() }
        function onSeriesChanged() { if (!selectedSeriesId && (apiClient.series || []).length) selectedSeriesId = apiClient.series[0].id }
        function onLiveChannelsChanged() {
            syncSelectedLiveSelection()
            if (currentScreen === "live") {
                liveAutoplayTimer.restart()
            }
        }
        function onLogoutCompleted() { currentScreen = "login"; authCode = ""; issuedCode = ""; showAuthCode = false; closePlayer(); pendingPackage = null; selectedPaymentMethodId = "" }
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
                    text: rail.item.playbackAllowed ? "Hazir" : "Paket Gerekli"
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
    
    // 1. Üst Bar - PIP, Cast, Fullscreen, Favori
    component PlayerTopBar: Rectangle {
        id: topBar
        height: 64
        color: "transparent"
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#99000000" }
            GradientStop { position: 1.0; color: "transparent" }
        }
        opacity: liveControlsVisible ? 1.0 : 0.0
        Behavior on opacity { NumberAnimation { duration: 200 } }
        
        Row {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.rightMargin: 16
            spacing: 12
            
            // Picture-in-Picture
            PlayerIconButton {
                icon: "⧉"
                tooltip: "Picture in Picture"
                onClicked: showToast("PIP modu yakında geliyor")
            }
            
            // Cast
            PlayerIconButton {
                icon: "📡"
                tooltip: "Cast"
                onClicked: showToast("Cast özelliği yakında geliyor")
            }
            
            // Fullscreen
            PlayerIconButton {
                icon: videoFullscreen ? "⛶" : "⛶"
                tooltip: videoFullscreen ? "Küçült" : "Tam Ekran"
                onClicked: toggleVideoFullscreen()
            }
            
            // Favori
            PlayerIconButton {
                icon: "★"
                tooltip: "Favorilere Ekle"
                iconColor: "#e50914"
                onClicked: showToast("Favorilere eklendi")
            }
        }
    }
    
    // 2. Orta Kontroller - Önceki/Play/Sonraki
    component PlayerCenterControls: Item {
        width: 280
        height: 80
        opacity: liveControlsVisible ? 1.0 : 0.0
        Behavior on opacity { NumberAnimation { duration: 200 } }
        
        Row {
            anchors.centerIn: parent
            spacing: 40
            
            // Önceki Kanal
            PlayerControlButton {
                icon: "◄◄"
                size: 48
                onClicked: previousLiveChannel()
            }
            
            // Play/Pause (Live TV için buffer control)
            PlayerControlButton {
                icon: playbackController.state === "playing" ? "❚❚" : "▶"
                size: 56
                onClicked: {
                    if (playbackController.state === "playing") {
                        playbackController.stop()
                    } else {
                        playbackController.retryCurrent()
                    }
                }
            }
            
            // Sonraki Kanal
            PlayerControlButton {
                icon: "►►"
                size: 48
                onClicked: nextLiveChannel()
            }
        }
    }
    
    // 3. Alt Bilgi Barı - Kanal Logo ve İsim
    component PlayerInfoBar: Rectangle {
        height: 90
        color: "transparent"
        opacity: liveControlsVisible ? 1.0 : 0.0
        Behavior on opacity { NumberAnimation { duration: 200 } }
        
        Row {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: 20
            spacing: 16
            
            // Kanal Logosu
            Rectangle {
                width: 56
                height: 56
                radius: 12
                color: "#1affffff"
                
                Image {
                    anchors.centerIn: parent
                    width: 40
                    height: 40
                    source: selectedLiveItem() ? window.artworkSource(selectedLiveItem().logoUrl || "") : ""
                    fillMode: Image.PreserveAspectFit
                    visible: status === Image.Ready
                }
                
                Text {
                    anchors.centerIn: parent
                    text: selectedLiveItem() ? (selectedLiveItem().title || "").substring(0, 2).toUpperCase() : "TV"
                    color: window.textPrimary
                    font.pixelSize: 18
                    font.bold: true
                    visible: parent.children[0].status !== Image.Ready
                }
            }
            
            // Kanal Bilgisi
            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 6
                
                Text {
                    text: selectedLiveItem() ? (selectedLiveItem().countryCode ? selectedLiveItem().countryCode + " • " : "") + selectedLiveItem().title : "Kanal Seçin"
                    color: window.textPrimary
                    font.pixelSize: 20
                    font.family: "Space Grotesk"
                    font.bold: true
                }
                
                Text {
                    text: selectedLiveItem() ? (selectedLiveItem().groupTitle || "Canlı TV") : ""
                    color: window.textMuted
                    font.pixelSize: 14
                }
            }
        }
        
        // HD Badge
        Rectangle {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.rightMargin: 20
            width: 36
            height: 22
            radius: 4
            color: "#e50914"
            visible: selectedLiveItem() && selectedLiveItem().quality === "HD"
            
            Text {
                anchors.centerIn: parent
                text: "HD"
                color: "#ffffff"
                font.pixelSize: 11
                font.bold: true
            }
        }
    }
    
    // 4. Alt Kontrol Barı - Ses ve Diğer Kontroller
    component PlayerControlBar: Rectangle {
        height: 64
        color: "transparent"
        opacity: liveControlsVisible ? 1.0 : 0.0
        Behavior on opacity { NumberAnimation { duration: 200 } }
        
        Row {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: 16
            spacing: 16
            
            // Ses Aç/Kapa
            PlayerIconButton {
                icon: playbackController.muted || playbackController.volume <= 0 ? "🔇" : "🔊"
                tooltip: "Sesi Aç/Kapat"
                onClicked: playbackController.toggleMuted()
            }
            
            // Ses Slider
            Slider {
                id: volumeSlider
                width: 100
                anchors.verticalCenter: parent.verticalCenter
                from: 0
                to: 1
                value: playbackController.muted ? 0 : playbackController.volume
                onMoved: {
                    showLiveControls()
                    playbackController.setVolume(value)
                }
                
                background: Rectangle {
                    x: volumeSlider.leftPadding
                    y: volumeSlider.topPadding + volumeSlider.availableHeight / 2 - height / 2
                    implicitWidth: 100
                    implicitHeight: 4
                    width: volumeSlider.availableWidth
                    height: implicitHeight
                    radius: 2
                    color: "#40ffffff"
                    
                    Rectangle {
                        width: volumeSlider.visualPosition * parent.width
                        height: parent.height
                        radius: 2
                        color: "#e50914"
                    }
                }
                
                handle: Rectangle {
                    x: volumeSlider.leftPadding + volumeSlider.visualPosition * (volumeSlider.availableWidth - width)
                    y: volumeSlider.topPadding + volumeSlider.availableHeight / 2 - height / 2
                    implicitWidth: 14
                    implicitHeight: 14
                    radius: 7
                    color: "#ffffff"
                }
            }
            
            // Ses Seviyesi Yüzdesi
            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: Math.round((playbackController.muted ? 0 : playbackController.volume) * 100) + "%"
                color: window.textPrimary
                font.pixelSize: 12
                width: 32
            }
        }
        
        Row {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.rightMargin: 16
            spacing: 12
            // Tam Ekran
            PlayerIconButton {
                icon: videoFullscreen ? "⛶" : "⛶"
                tooltip: videoFullscreen ? "Küçült" : "Tam Ekran"
                onClicked: toggleVideoFullscreen()
            }
        }
    }
    
    // Yardımcı Componentler
    component PlayerIconButton: Rectangle {
        property string icon: ""
        property string tooltip: ""
        property color iconColor: "#ffffff"
        signal clicked()
        
        width: 40
        height: 40
        radius: 8
        color: mouseArea.pressed ? "#30ffffff" : "#15ffffff"
        Behavior on color { ColorAnimation { duration: 120 } }
        
        Text {
            anchors.centerIn: parent
            text: parent.icon
            color: parent.iconColor
            font.pixelSize: 18
        }
        
        MouseArea {
            id: mouseArea
            anchors.fill: parent
            hoverEnabled: false
            cursorShape: Qt.PointingHandCursor
            onClicked: parent.clicked()
            onEntered: showLiveControls()
        }
    }
    
    component PlayerControlButton: Rectangle {
        property string icon: ""
        property int size: 48
        signal clicked()
        
        width: size
        height: size
        radius: 8
        color: mouseArea.pressed ? "#40ffffff" : "#25ffffff"
        border.width: 1
        border.color: mouseArea.pressed ? "#60ffffff" : "#30ffffff"
        Behavior on color { ColorAnimation { duration: 150 } }
        
        Text {
            anchors.centerIn: parent
            text: parent.icon
            color: "#ffffff"
            font.pixelSize: parent.size * 0.45
        }
        
        MouseArea {
            id: mouseArea
            anchors.fill: parent
            hoverEnabled: false
            cursorShape: Qt.PointingHandCursor
            onClicked: {
                showLiveControls()
                parent.clicked()
            }
        }
    }

    Component {
        id: nativeVideoSurfaceComponent
        Item {
            anchors.fill: parent

            NativeVideoSurface {
                id: nativeVideoSurface
                anchors.fill: parent
                anchors.margins: 0
                mousePassthrough: true
                onSurfaceHandleChanged: {
                    playbackController.setVideoSurfaceHandle(surfaceHandle)
                    playbackController.setVideoSurfaceGeometry(width, height)
                }
                onWidthChanged: playbackController.setVideoSurfaceGeometry(width, height)
                onHeightChanged: playbackController.setVideoSurfaceGeometry(width, height)
                Component.onCompleted: playbackController.setVideoSurfaceGeometry(width, height)
                onPointerActivity: {
                    if (currentScreen === "live" && inlineLivePlayerVisible()) {
                        showLiveControls()
                    }
                }
            }

            HoverHandler {
                acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                onHoveredChanged: {
                    if (hovered && currentScreen === "live" && inlineLivePlayerVisible()) {
                        showLiveControls()
                    }
                }
                onPointChanged: {
                    if (currentScreen === "live" && inlineLivePlayerVisible()) {
                        showLiveControls()
                    }
                }
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
                            text: playbackController.activeTitle.length ? playbackController.activeTitle : "Player Hazir"
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
                        onClicked: closePlayer()
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
                                sourceComponent: nativeVideoSurfaceComponent
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
                                          playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazirlaniyor" :
                                          playbackController.state === "error" ? "Yayin acilamadi" :
                                          playbackController.state === "playing" ? "Oynuyor" : "Hazir"
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
                                            text: "Sonraki Bolum"
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
                                text: playbackController.lastError.length ? playbackController.lastError : "Native player app icinde hazir."
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
                    Layout.preferredHeight: window.compactWindow ? 92 : 104
                    color: "#ee010204"
                    visible: !videoFullscreen

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
                                          ? "Installer indiriliyor. Hazır olunca uygulama kapanıp yeni sürüm kurulumu başlayacak."
                                          : (apiClient.updateError.length
                                             ? apiClient.updateError
                                             : (appUpdatePayload().notes || "Güncelleme uygulama içinden indirilebilir durumda."))
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
                                text: apiClient.updateInProgress ? "İndiriliyor..." : "Güncelle ve Yeniden Başlat"
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

                        ScrollView {
                            id: homeScrollView
                            clip: true
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
                                        title: "Sizin Icin Secilen Filmler"
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
                                                    onActivated: playMovie(item)
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
                                                active: parseLiveCountryCodeFromFilter(selectedLiveGroup) === modelData.code
                                                width: Math.max(96, implicitContentWidth + 28)
                                                onClicked: applyLiveFilters(liveSearchText, modelData.filter)
                                            }
                                        }

                                        Repeater {
                                            model: liveGroupChips()
                                            ChipButton {
                                                required property var modelData
                                                text: Number(modelData.count || 0) > 0 ? `${modelData.title} ${modelData.count}` : modelData.title
                                                active: selectedLiveGroup === modelData.title
                                                width: Math.max(96, implicitContentWidth + 28)
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
                                        Layout.fillHeight: true
                                        color: videoFullscreen ? "#000000" : "#090c13"
                                        radius: videoFullscreen ? 0 : 8

                                        ColumnLayout {
                                            anchors.fill: parent
                                            anchors.margins: videoFullscreen ? 0 : 18
                                            spacing: 0

                                            Rectangle {
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
                                                        anchors.bottomMargin: !videoFullscreen && liveControlsVisible ? 100 : 0
                                                        active: inlineLivePlayerVisible()
                                                        sourceComponent: nativeVideoSurfaceComponent
                                                        Behavior on anchors.bottomMargin { NumberAnimation { duration: 150; easing.type: Easing.OutSine } }
                                                    }
                                                    
                                                    // 2. Player Controls Overlay
                                                    Item {
                                                        anchors.fill: parent
                                                        visible: inlineLivePlayerVisible()
                                                        z: 100
                                                        
                                                        // Mouse Area for hover detection and double-click fullscreen
                                                        MouseArea {
                                                            anchors.fill: parent
                                                            hoverEnabled: true
                                                            acceptedButtons: Qt.LeftButton
                                                            onEntered: showLiveControls()
                                                            onPositionChanged: showLiveControls()
                                                            onClicked: showLiveControls()
                                                            onDoubleClicked: toggleVideoFullscreen()
                                                            onWheel: function(wheel) {
                                                                wheel.accepted = false
                                                                showLiveControls()
                                                            }
                                                        }
                                                        
                                                        // Bottom Gradient Background
                                                        Rectangle {
                                                            anchors.left: parent.left
                                                            anchors.right: parent.right
                                                            anchors.bottom: parent.bottom
                                                            height: 164
                                                            color: "transparent"
                                                            gradient: Gradient {
                                                                GradientStop { position: 0.0; color: "transparent" }
                                                                GradientStop { position: 0.5; color: "#66000000" }
                                                                GradientStop { position: 1.0; color: "#b3000000" }
                                                            }
                                                            opacity: liveControlsVisible ? 1.0 : 0.0
                                                            Behavior on opacity { NumberAnimation { duration: 200 } }
                                                        }
                                                        
                                                        // Buffer/Loading State Indicator
                                                        Rectangle {
                                                            anchors.top: parent.top
                                                            anchors.right: parent.right
                                                            anchors.margins: 18
                                                            width: liveNativeStateText2.implicitWidth + 28
                                                            height: 40
                                                            radius: 8
                                                            color: "#c7070a0f"
                                                            border.width: 1
                                                            border.color: "#12ffffff"
                                                            visible: playbackController.state !== "playing"
                                                            
                                                            Text {
                                                                id: liveNativeStateText2
                                                                anchors.centerIn: parent
                                                                text: playbackController.state === "buffering" ? "Buffer dolduruluyor..." :
                                                                      playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazırlanıyor..." :
                                                                      playbackController.state === "error" ? "Yayın açılamadı" :
                                                                      playbackController.state === "playing" ? "Yayın açık" : "Kanal bekliyor"
                                                                color: window.textPrimary
                                                                font.pixelSize: 13
                                                                font.bold: true
                                                            }
                                                        }
                                                        
                                                        // Top Bar - PIP, Cast, Fullscreen, Favori
                                                        PlayerTopBar {
                                                            anchors.top: parent.top
                                                            anchors.left: parent.left
                                                            anchors.right: parent.right
                                                        }
                                                        
                                                        // Center Controls - Previous/Play/Next
                                                        PlayerCenterControls {
                                                            anchors.centerIn: parent
                                                        }
                                                        
                                                        // Bottom Info Bar - Channel Logo & Name
                                                        PlayerInfoBar {
                                                            anchors.left: parent.left
                                                            anchors.right: parent.right
                                                            anchors.bottom: parent.bottom
                                                            anchors.bottomMargin: 64
                                                        }
                                                        
                                                        // Bottom Control Bar - Volume & Settings
                                                        PlayerControlBar {
                                                            anchors.left: parent.left
                                                            anchors.right: parent.right
                                                            anchors.bottom: parent.bottom
                                                        }
                                                    }
                                                
                                                // Error Display (if any)
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
                                                    visible: playbackController.lastError.length > 0 && playbackController.activeContentKind === "live" && inlineLivePlayerVisible()
                                                    z: 10

                                                    Text {
                                                        id: liveNativeErrorLabel
                                                        anchors.centerIn: parent
                                                        width: parent.width - 26
                                                        wrapMode: Text.WordWrap
                                                        horizontalAlignment: Text.AlignHCenter
                                                        text: playbackController.lastError
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
                                                        text: "Filtreye uyan kanal bulunamadi"
                                                        color: window.textPrimary
                                                        font.pixelSize: 28
                                                        font.family: "Space Grotesk"
                                                        font.bold: true
                                                        wrapMode: Text.WordWrap
                                                    }

                                                    Text {
                                                        width: parent.width
                                                        horizontalAlignment: Text.AlignHCenter
                                                        text: "Aramayi temizleyin veya baska bir kategori secin."
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
                                                            text: "Bu kanali acmak icin aktif paket gerekiyor"
                                                            color: window.textPrimary
                                                            font.pixelSize: 30
                                                            font.family: "Space Grotesk"
                                                            font.bold: true
                                                            wrapMode: Text.WordWrap
                                                        }

                                                        Text {
                                                            width: parent.width
                                                            horizontalAlignment: Text.AlignHCenter
                                                            text: "Sag listeden baska kanal secin ya da paket durumunuzu guncelleyin."
                                                            color: window.textMuted
                                                            font.pixelSize: 14
                                                            wrapMode: Text.WordWrap
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                    GlassCard {
                                        Layout.preferredWidth: videoFullscreen ? 0 : (window.compactWindow ? 360 : 420)
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

                        ScrollView {
                            id: moviesScrollView
                            clip: true
                            Connections {
                                target: moviesScrollView.contentItem ? moviesScrollView.contentItem : null
                                function onContentYChanged() {
                                    const flickable = moviesScrollView.contentItem
                                    if (!flickable || inlineMoviePlayerVisible() || !apiClient.movieHasMore || apiClient.movieLoadingMore) {
                                        return
                                    }
                                    const contentBottom = flickable.contentY + moviesScrollView.height
                                    const totalHeight = flickable.contentHeight || flickable.height || 0
                                    if (totalHeight > 0 && contentBottom > totalHeight - 400) {
                                        apiClient.loadMoreMovies()
                                    }
                                }
                            }
                            Column {
                                width: Math.min(1600, pageStack.width - 48)
                                anchors.horizontalCenter: parent.horizontalCenter
                                topPadding: window.compactWindow ? 18 : 20
                                bottomPadding: window.compactWindow ? 24 : 28
                                spacing: window.sectionSpacing
                                Text { 
                                    text: "Filmler"
                                    color: window.textPrimary
                                    font.pixelSize: 42
                                    font.family: "Space Grotesk"
                                    font.bold: true
                                    anchors.horizontalCenter: parent.horizontalCenter
                                }
                                AppField {
                                    width: parent.width
                                    placeholderText: "Film ara..."
                                    text: moviesSearchText
                                    onTextChanged: {
                                        moviesSearchText = text
                                        movieSearchDebounceTimer.restart()
                                    }
                                }
                                Flickable {
                                    width: parent.width
                                    height: 52
                                    contentWidth: movieChipRow.width
                                    clip: true
                                    Row {
                                        id: movieChipRow
                                        spacing: 10
                                        Repeater {
                                            model: movieGroupOptions()
                                            ChipButton {
                                                required property var modelData
                                                text: modelData.length ? modelData : "Tum Filmler"
                                                active: selectedMovieGroup === modelData
                                                width: Math.max(112, implicitContentWidth + 28)
                                                onClicked: applyMovieFilters(moviesSearchText, modelData)
                                            }
                                        }
                                    }
                                }
                                Loader {
                                    width: parent.width
                                    active: inlineMoviePlayerVisible()
                                    visible: active
                                    sourceComponent: inlineVodPlayerComponent
                                }
                                Flow {
                                    property int __maxCols: Math.max(1, Math.floor((parent.width + window.cardGap) / (window.posterCardWidth + window.cardGap)))
                                    property int __actualCols: Math.min(filteredMovies().length, __maxCols)
                                    width: __actualCols * window.posterCardWidth + Math.max(0, __actualCols - 1) * window.cardGap
                                    visible: !inlineMoviePlayerVisible()
                                    spacing: window.cardGap
                                    anchors.horizontalCenter: parent.horizontalCenter
                                    Repeater {
                                        model: filteredMovies()
                                        PosterGridCard {
                                            titleText: (modelData && modelData["title"] ? modelData["title"] : "").toString()
                                            subtitleText: (modelData && modelData["groupTitle"] ? modelData["groupTitle"] : "").toString()
                                            artworkUrl: window.artworkSource(modelData ? (modelData.posterUrl || modelData.streamImageUrl || modelData.stream_icon || "") : "")
                                            playbackAllowed: Boolean(modelData && modelData["playbackAllowed"])
                                            payload: modelData
                                            cardKind: "movie"
                                            onActivated: playMovie(item)
                                        }
                                    }
                                }
                                // Loading indicator for infinite scroll
                                Rectangle {
                                    width: parent.width
                                    height: 60
                                    color: "transparent"
                                    visible: !inlineMoviePlayerVisible() && apiClient.movieLoadingMore

                                    BusyIndicator {
                                        anchors.centerIn: parent
                                        running: parent.visible
                                    }
                                }
                                GlassCard {
                                    width: parent.width
                                    height: 180
                                    visible: !inlineMoviePlayerVisible() && filteredMovies().length === 0
                                    color: "#090c13"
                                    Column {
                                        anchors.centerIn: parent
                                        spacing: 8
                                        Text {
                                            text: "Filtreye uygun film bulunamadi"
                                            color: window.textPrimary
                                            font.pixelSize: 30
                                            font.family: "Space Grotesk"
                                            font.bold: true
                                        }
                                        Text {
                                            text: "Aramayi temizleyip baska bir kategori deneyebilirsiniz."
                                            color: window.textMuted
                                            font.pixelSize: 14
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
                                Text { text: "Diziler"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                AppField { width: parent.width; placeholderText: "Dizi ara..."; text: seriesSearchText; onTextChanged: seriesSearchText = text }
                                Flickable { width: parent.width; height: 52; contentWidth: seriesChipRow.width; clip: true; Row { id: seriesChipRow; spacing: 10; Repeater { model: [""] .concat(uniqueGroups(apiClient.series || [])); ChipButton { required property var modelData; text: modelData.length ? modelData : "Tum Diziler"; active: selectedSeriesGroup === modelData; width: Math.max(112, implicitContentWidth + 28); onClicked: selectedSeriesGroup = modelData } } } }
                                Flow { property int __maxCols: Math.max(1, Math.floor((parent.width + window.cardGap) / (window.railCardWidth + window.cardGap))); property int __actualCols: Math.min(filteredSeries().length, __maxCols); width: __actualCols * window.railCardWidth + Math.max(0, __actualCols - 1) * window.cardGap; spacing: window.cardGap; anchors.horizontalCenter: parent.horizontalCenter; Repeater { model: filteredSeries(); RailCard { item: ({ id: modelData.id, title: modelData.title, subtitle: `${modelData.seasonCount} sezon - ${modelData.episodeCount} bolum`, posterUrl: modelData.posterUrl, playbackAllowed: Boolean(modelData.featuredEpisode && modelData.featuredEpisode.playbackAllowed) }); cardKind: "episode"; onActivated: openSeriesDetail(modelData.id) } } }
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
                                AppButton { text: "Dizilere Dön"; secondary: true; implicitWidth: 140; onClicked: openScreen("series") }
                                Loader {
                                    width: parent.width
                                    active: inlineEpisodePlayerVisible()
                                    visible: active
                                    sourceComponent: inlineVodPlayerComponent
                                }
                                Flow {
                                    visible: !inlineEpisodePlayerVisible()
                                    width: parent.width; spacing: window.cardGap
                                    GlassCard { width: window.compactWindow ? parent.width : 320; height: window.compactWindow ? 380 : 460; color: "#090c13"; ArtworkPanel { anchors.fill: parent; title: selectedSeries() ? selectedSeries().title : "Dizi"; subtitle: selectedSeries() ? (selectedSeries().groupTitle || "Premium Dizi") : "Premium Dizi"; sourceUrl: selectedSeries() ? (selectedSeries().posterUrl || "") : ""; kind: "episode"; mode: "poster"; cornerRadius: 28 } }
                                    GlassCard {
                                        width: window.compactWindow ? parent.width : parent.width - (320 + window.cardGap); height: window.compactWindow ? 320 : 460; color: "#090c13"
                                        Column {
                                            anchors.fill: parent; anchors.margins: window.compactWindow ? 22 : 28; spacing: 14
                                            Text { text: selectedSeries() ? selectedSeries().title : "Dizi secin"; color: window.textPrimary; font.pixelSize: window.compactWindow ? 34 : 46; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap }
                                            Text { text: selectedSeries() ? (selectedSeries().groupTitle || "Seckin dizi") : ""; color: window.textMuted; font.pixelSize: 16 }
                                            Text { width: parent.width * (window.compactWindow ? 1.0 : 0.8); wrapMode: Text.WordWrap; text: "Sezonlari gezin, bolumu secin ve native player yuzeyinde branded playback deneyimini kullanin."; color: window.textMuted; font.pixelSize: 15 }
                                            AppButton { text: "One Cikan Bolumu Ac"; implicitWidth: 190; enabled: selectedSeries() && selectedSeries().featuredEpisode && selectedSeries().featuredEpisode.id; onClicked: playEpisode(selectedSeries().featuredEpisode, selectedSeries()) }
                                        }
                                    }
                                }
                                Repeater {
                                    model: selectedSeries() && selectedSeries().seasons ? selectedSeries().seasons : []
                                    GlassCard {
                                        width: parent.width; height: seasonContent.implicitHeight + 34; color: "#090c13"
                                        Column {
                                            id: seasonContent
                                            anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 18; spacing: 14
                                            Text { text: `${modelData.title} - ${modelData.episodeCount} bolum`; color: window.textPrimary; font.pixelSize: 26; font.family: "Space Grotesk"; font.bold: true }
                                            Repeater {
                                                model: modelData.episodes || []
                                                Rectangle {
                                                    width: seasonContent.width; height: 80; radius: 20; color: "#131923"; border.width: 1; border.color: "#2a3140"
                                                    Row {
                                                        anchors.fill: parent; anchors.margins: 16; spacing: 18
                                                        Text { anchors.verticalCenter: parent.verticalCenter; text: `B${modelData.episodeNumber}`; color: "#a6ffffff"; font.pixelSize: 14; font.bold: true }
                                                        Column { anchors.verticalCenter: parent.verticalCenter; width: parent.width - 170; spacing: 4; Text { text: modelData.title; width: parent.width; elide: Text.ElideRight; color: window.textPrimary; font.pixelSize: 18; font.bold: true } Text { text: modelData.playbackAllowed ? "Hazir" : "Paket Gerekli"; color: modelData.playbackAllowed ? "#82ecc4" : window.textMuted; font.pixelSize: 13 } }
                                                        AppButton { anchors.verticalCenter: parent.verticalCenter; text: "Oynat"; implicitWidth: 110; enabled: modelData.playbackAllowed; onClicked: playEpisode(modelData, selectedSeries()) }
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
                                Text { text: "Profil"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: [
                                            { title: "Profil Ayarlari", copy: "Kullanici ve baglanti bilgilerini goruntuleyin.", action: "Ayarlar", screen: "settings" },
                                            { title: "Paketler", copy: "Aktif paketleri gorup satin alim talebi olusturun.", action: "Paketleri Gor", screen: "packages" },
                                            { title: "Odeme Bildirimi", copy: "Odeme taleplerinin durumunu takip edin.", action: "Bildirimleri Gor", screen: "payments" },
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
                                spacing: window.sectionSpacing
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Paketler"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: apiClient.packages
                                        GlassCard {
                                            width: window.gridCardWidth(parent.width, 250, 3); height: 240; color: "#090c13"
                                            Column { anchors.fill: parent; anchors.margins: 22; spacing: 10; Rectangle { width: 82; height: 34; radius: 17; color: "#14ffffff"; Text { anchors.centerIn: parent; text: `${modelData.durationMonths} ay`; color: window.textPrimary; font.pixelSize: 12; font.bold: true } } Text { text: modelData.title; color: window.textPrimary; font.pixelSize: 30; font.family: "Space Grotesk"; font.bold: true; width: parent.width; wrapMode: Text.WordWrap } Text { text: modelData.priceLabel || "Fiyat bilgisi destek ekibinden alinir."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 14 } AppButton { text: "Paket Al"; implicitWidth: 132; onClicked: { pendingPackage = modelData; selectedPaymentMethodId = ""; apiClient.fetchPaymentMethods() } } }
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
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Odeme Bildirimi"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
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
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "Ayarlar"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                Flow {
                                    width: parent.width; spacing: 18
                                    Repeater {
                                        model: [
                                            { label: "Kullanici Kodu", value: userData().kryptoniteCode || "-" },
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
                                Row { spacing: 12; AppButton { text: "Geri"; secondary: true; implicitWidth: 110; onClicked: openScreen("profile") } Text { anchors.verticalCenter: parent.verticalCenter; text: "İletişim"; color: window.textPrimary; font.pixelSize: 42; font.family: "Space Grotesk"; font.bold: true } }
                                GlassCard {
                                    width: parent.width; height: 200; color: "#090c13"
                                    Column {
                                        anchors.fill: parent; anchors.margins: 24; spacing: 12
                                        Text { text: "Destek ekibine hizli ulasin"; color: window.textPrimary; font.pixelSize: 32; font.family: "Space Grotesk"; font.bold: true }
                                        Text { text: "Aktivasyon, paket ve odeme surecleri icin WhatsApp veya Telegram kullanin."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
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
            anchors.fill: parent; color: "#d9030508"; visible: overlayPlayerVisible(); z: 29
            GlassCard {
                anchors.fill: parent; anchors.margins: 18; color: "#f2080a0e"; z: 21
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 14
                    RowLayout { Layout.fillWidth: true; ColumnLayout { Layout.fillWidth: true; spacing: 4; Text { text: playbackController.activeContentKind === "live" ? "Canlı TV" : playbackController.activeContentKind === "movie" ? "Film" : "Dizi"; color: "#c7ffffff"; font.pixelSize: 12; font.bold: true } Text { text: playbackController.activeTitle.length ? playbackController.activeTitle : "Player Hazır"; color: window.textPrimary; font.pixelSize: 28; font.family: "Space Grotesk"; font.bold: true } Text { text: playerSubtitle; color: window.textMuted; font.pixelSize: 14; visible: text.length > 0 } } AppButton { text: "Kapat"; secondary: true; implicitWidth: 120; onClicked: closePlayer() } }
                    RowLayout {
                        Layout.fillWidth: true; Layout.fillHeight: true; spacing: 16
                        GlassCard {
                            Layout.fillWidth: true; Layout.fillHeight: true; color: "#000000"
                            Loader { anchors.fill: parent; anchors.margins: 6; active: overlayPlayerVisible(); sourceComponent: nativeVideoSurfaceComponent }
                            Rectangle { anchors.left: parent.left; anchors.top: parent.top; anchors.margins: 18; width: stateLabel.implicitWidth + 28; height: 40; radius: 20; color: "#c7070a0f"; border.width: 1; border.color: "#12ffffff"; Text { id: stateLabel; anchors.centerIn: parent; text: playbackController.state === "buffering" ? "Buffer dolduruluyor" : playbackController.state === "resolving" || playbackController.state === "opening" ? "Kaynak hazırlanıyor" : playbackController.state === "error" ? "Yayın açılamadı" : "Yayın hazır"; color: window.textPrimary; font.pixelSize: 13; font.bold: true } }
                            Rectangle {
                                anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 16; height: 78; radius: 22; color: "#c7070a0f"; border.width: 1; border.color: "#12ffffff"
                                Row {
                                    anchors.fill: parent; anchors.margins: 14; spacing: 10
                                    AppButton { text: playbackController.paused ? "Play" : "Pause"; secondary: true; implicitWidth: 104; onClicked: playbackController.togglePause() }
                                    AppButton { text: "Geri 15sn"; secondary: true; implicitWidth: 110; enabled: playbackController.activeContentKind === "movie" || playbackController.activeContentKind === "episode"; onClicked: playbackController.seekBy(-15) }
                                    AppButton { text: "Ileri 30sn"; secondary: true; implicitWidth: 116; enabled: playbackController.activeContentKind === "movie" || playbackController.activeContentKind === "episode"; onClicked: playbackController.seekBy(30) }
                                    AppButton { text: "Tekrar Dene"; secondary: true; implicitWidth: 126; onClicked: playbackController.retryCurrent() }
                                    AppButton { text: "Sonraki Bolum"; implicitWidth: 146; visible: Boolean(playbackController.recommendedNextEpisode.id); enabled: visible; onClicked: playbackController.playRecommendedNextEpisode() }
                                    Item { width: 1; height: 1 }
                                    Column { anchors.verticalCenter: parent.verticalCenter; spacing: 6; Text { text: `Pozisyon: ${playbackController.positionSeconds.toFixed(1)} / ${playbackController.durationSeconds.toFixed(1)}`; color: window.textPrimary; font.pixelSize: 13 } ComboBox { width: window.compactWindow ? 200 : 260; model: playbackController.audioTracks; textRole: "title"; enabled: playbackController.audioTracks.length > 0; currentIndex: activeAudioTrackIndex(); onActivated: function(index) { const track = playbackController.audioTracks[index]; if (track && track.id) playbackController.selectAudioTrack(track.id) } } }
                                }
                            }
                        }
                        GlassCard { Layout.preferredWidth: window.compactWindow ? 260 : 320; Layout.fillHeight: true; color: "#090c13"; Column { anchors.fill: parent; anchors.margins: 18; spacing: 12; Text { text: "Yayın Bilgisi"; color: window.textPrimary; font.pixelSize: 20; font.family: "Space Grotesk"; font.bold: true } Rectangle { width: parent.width; height: window.compactWindow ? 148 : 180; radius: 22; color: "#08ffffff"; border.width: 1; border.color: window.borderSoft; ArtworkPanel { anchors.fill: parent; title: playbackController.activeTitle.length ? playbackController.activeTitle : "Flixify"; subtitle: playerSubtitle; sourceUrl: playerImageUrl; kind: playbackController.activeContentKind || "movie"; mode: playbackController.activeContentKind === "live" ? "logo" : "poster"; cornerRadius: 22 } } Text { text: playbackController.lastError.length ? playbackController.lastError : "Native player branded shell içinde hazır."; width: parent.width; wrapMode: Text.WordWrap; color: playbackController.lastError.length ? "#ffb2b8" : window.textMuted; font.pixelSize: 14 } } }
                    }
                }
            }
        }

        Rectangle {
            anchors.fill: parent
            color: "#f004070b"
            visible: false && overlayPlayerVisible()
            z: 29

            Rectangle {
                anchors.fill: parent
                anchors.margins: 12
                radius: 30
                color: "#080a0ef2"
                border.width: 1
                border.color: "#1effffff"
            }

            Item {
                anchors.fill: parent
                anchors.margins: window.compactWindow ? 12 : 16

                Rectangle {
                    anchors.fill: parent
                    radius: 26
                    color: "#000000"
                    border.width: 1
                    border.color: "#14ffffff"
                    clip: true

                    Loader {
                        anchors.fill: parent
                        active: overlayPlayerVisible()
                        sourceComponent: nativeVideoSurfaceComponent
                    }

                    Rectangle {
                        anchors.fill: parent
                        color: "#05070b"
                        opacity: playbackController.state === "playing" ? 0.04 : 0.18
                    }

                    WindowContainer {
                        anchors.fill: parent
                        z: 6
                        visible: overlayPlayerVisible()

                        window: Window {
                            flags: Qt.FramelessWindowHint
                            visible: overlayPlayerVisible()
                            color: "transparent"

                            Item {
                                anchors.fill: parent

                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.top: parent.top
                                    height: Math.max(156, parent.height * 0.28)
                                    gradient: Gradient {
                                        GradientStop { position: 0.0; color: "#d905070b" }
                                        GradientStop { position: 0.56; color: "#6005070b" }
                                        GradientStop { position: 1.0; color: "#0005070b" }
                                    }
                                }

                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.bottom: parent.bottom
                                    height: Math.max(180, parent.height * 0.3)
                                    gradient: Gradient {
                                        GradientStop { position: 0.0; color: "#0005070b" }
                                        GradientStop { position: 0.36; color: "#7405070b" }
                                        GradientStop { position: 1.0; color: "#ed05070b" }
                                    }
                                }

                                AppButton {
                                    anchors.left: parent.left
                                    anchors.top: parent.top
                                    anchors.margins: 18
                                    text: "Geri"
                                    secondary: true
                                    implicitWidth: 118
                                    onClicked: closePlayer()
                                }

                                Column {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.top: parent.top
                                    anchors.margins: 18
                                    anchors.leftMargin: 152
                                    spacing: 8

                                    Rectangle {
                                        width: vodPlaybackKindBadge.implicitWidth + 20
                                        height: 28
                                        radius: 14
                                        color: "#14ffffff"

                                        Text {
                                            id: vodPlaybackKindBadge
                                            anchors.centerIn: parent
                                            text: playbackKindLabel(playbackController.activeContentKind)
                                            color: "#ffffffc8"
                                            font.pixelSize: 11
                                            font.bold: true
                                        }
                                    }

                                    Text {
                                        text: playbackController.activeTitle.length ? playbackController.activeTitle : "Flixify"
                                        color: window.textPrimary
                                        font.pixelSize: window.compactWindow ? 28 : 34
                                        font.family: "Space Grotesk"
                                        font.bold: true
                                        width: parent.width
                                        elide: Text.ElideRight
                                    }

                                    Text {
                                        text: playerSubtitle
                                        color: window.textMuted
                                        font.pixelSize: 14
                                        width: parent.width
                                        elide: Text.ElideRight
                                        visible: text.length > 0
                                    }
                                }

                                Rectangle {
                                    anchors.right: parent.right
                                    anchors.top: parent.top
                                    anchors.margins: 18
                                    width: vodStateText.implicitWidth + 28
                                    height: 40
                                    radius: 8
                                    color: "#c7070a0f"
                                    border.width: 1
                                    border.color: "#12ffffff"

                                    Text {
                                        id: vodStateText
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
                                    anchors.margins: 18
                                    height: vodControlsColumn.implicitHeight + 36
                                    radius: 24
                                    color: "#d90a0e15"
                                    border.width: 1
                                    border.color: "#18ffffff"

                                    Column {
                                        id: vodControlsColumn
                                        anchors.fill: parent
                                        anchors.margins: 18
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
                                                    id: vodVolumeSlider
                                                    width: window.compactWindow ? 120 : 160
                                                    from: 0
                                                    to: 1
                                                    value: playbackController.muted ? 0 : playbackController.volume
                                                    stepSize: 0.01
                                                    onMoved: playbackController.setVolume(value)

                                                    background: Rectangle {
                                                        x: vodVolumeSlider.leftPadding
                                                        y: vodVolumeSlider.topPadding + vodVolumeSlider.availableHeight / 2 - height / 2
                                                        implicitWidth: 150
                                                        implicitHeight: 6
                                                        width: vodVolumeSlider.availableWidth
                                                        height: implicitHeight
                                                        radius: 3
                                                        color: "#24ffffff"

                                                        Rectangle {
                                                            width: vodVolumeSlider.visualPosition * parent.width
                                                            height: parent.height
                                                            radius: 3
                                                            color: window.accentStrong
                                                        }
                                                    }

                                                    handle: Rectangle {
                                                        x: vodVolumeSlider.leftPadding + vodVolumeSlider.visualPosition * (vodVolumeSlider.availableWidth - width)
                                                        y: vodVolumeSlider.topPadding + vodVolumeSlider.availableHeight / 2 - height / 2
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

                                Connections {
                                    target: playbackController
                                    function onVolumeChanged() { vodVolumeSlider.value = playbackController.muted ? 0 : playbackController.volume }
                                    function onMutedChanged() { vodVolumeSlider.value = playbackController.muted ? 0 : playbackController.volume }
                                }
                            }
                        }
                    }
                }
            }
        }

        Rectangle {
            anchors.fill: parent; color: "#d9030508"; visible: pendingPackage !== null; z: 30
            GlassCard {
                width: window.modalPanelWidth; height: paymentContent.implicitHeight + 40; anchors.centerIn: parent; color: "#0b0f17"; z: 31
                Column {
                    id: paymentContent
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 20; spacing: 16
                    Row { width: parent.width; Text { text: "Odeme Yontemi"; color: "#d8ffffff"; font.pixelSize: 12; font.bold: true } Item { width: 1; height: 1 } AppButton { text: "Kapat"; secondary: true; implicitWidth: 96; onClicked: { pendingPackage = null; selectedPaymentMethodId = "" } } }
                    Text { text: pendingPackage ? `${pendingPackage.title} paketi icin odeme yontemi secin` : ""; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Flow {
                        width: parent.width; spacing: 12
                        Repeater {
                            model: paymentMethods()
                            GlassCard { width: window.gridCardWidth(parent.width, 280, 2); height: 94; color: selectedPaymentMethodId === modelData.id ? "#22e50914" : "#131923"; border.color: selectedPaymentMethodId === modelData.id ? "#30ffffff" : "#2a3140"; Column { anchors.fill: parent; anchors.margins: 16; spacing: 6; Text { text: modelData.label || modelData.id; color: window.textPrimary; font.pixelSize: 18; font.bold: true } Text { text: modelData.details || "Onay sureci destek ekibi tarafindan baslatilir."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 13 } } MouseArea { anchors.fill: parent; onClicked: selectedPaymentMethodId = modelData.id } }
                        }
                    }
                    AppButton { width: parent.width; text: "Odeme Bildir"; enabled: selectedPaymentMethod() !== null && !apiClient.busy; onClicked: { apiClient.requestPayment(pendingPackage.slug); if (contactData().whatsapp) Qt.openUrlExternally(contactData().whatsapp); pendingPackage = null; selectedPaymentMethodId = ""; openScreen("payments") } }
                    AppButton { width: parent.width; text: "Vazgec"; secondary: true; onClicked: { pendingPackage = null; selectedPaymentMethodId = "" } }
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
                    Row { width: parent.width; Rectangle { width: 112; height: 34; radius: 17; color: "#33e50914"; Text { anchors.centerIn: parent; text: "Premium Erisim"; color: "#ffd7da"; font.pixelSize: 12; font.bold: true } } Item { width: 1; height: 1 } AppButton { text: "Kapat"; secondary: true; implicitWidth: 96; onClicked: premiumPopupDismissed = true } }
                    Text { text: "Tum iceriklere erismek icin aktif bir paket satin alin"; color: window.textPrimary; width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 34; font.family: "Space Grotesk"; font.bold: true }
                    Text { text: "Giris basarili. Paketiniz aktif olunca kataloglarin tamami acilacak."; width: parent.width; wrapMode: Text.WordWrap; color: window.textMuted; font.pixelSize: 15 }
                    Row {
                        spacing: 12
                        AppButton {
                            text: "Test Yapmak Istiyorum"
                            implicitWidth: 190
                            onClicked: apiClient.requestTrial("Windows native cihazindan test talebi")
                        }
                        AppButton {
                            text: "WhatsApp ile İletişime Geç"
                            secondary: true
                            implicitWidth: 220
                            onClicked: openScreen("contact")
                        }
                        AppButton {
                            text: "Paket Satin Al"
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
            visible: opacity > 0
            opacity: titleBarMouseArea.containsMouse || titleBarMouseArea.containsPress ? 1.0 : 0.0
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
                        onClicked: confirmExitDialog.open()
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
                        text: "Çıkış Yapmak İstiyor musunuz?"
                        color: window.textPrimary
                        font.pixelSize: 22 * fontScale
                        font.bold: true
                        font.family: "Space Grotesk"
                    }

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        Layout.fillWidth: true
                        text: "Flixify Pro'dan çıkmak istediğinize emin misiniz?"
                        color: window.textMuted
                        font.pixelSize: 14 * fontScale
                        wrapMode: Text.WordWrap
                        horizontalAlignment: Text.AlignHCenter
                    }

                    RowLayout {
                        Layout.alignment: Qt.AlignHCenter
                        spacing: 16

                        AppButton {
                            text: "İptal"
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
                } else if (window.visibility === Window.FullScreen) {
                    window.showNormal()
                } else if (confirmExitDialog.visible) {
                    confirmExitDialog.close()
                } else if (currentScreen !== "login") {
                    if (currentScreen === "home" || currentScreen === "movies" || currentScreen === "series" || currentScreen === "live") {
                        confirmExitDialog.open()
                    } else {
                        openScreen("home")
                    }
                } else {
                    confirmExitDialog.open()
                }
            }
        }

        Shortcut {
            sequence: "F11"
            onActivated: {
                if (inlineLivePlayerVisible()) {
                    toggleVideoFullscreen()
                } else {
                    toggleWindowFullscreen()
                }
            }
        }

        Shortcut {
            sequence: "Alt+F4"
            onActivated: confirmExitDialog.open()
        }
    }
}
