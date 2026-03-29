import QtQuick
import QtMultimedia

QtObject {
    id: root

    property string activeContentKind: ""
    property string activeContentId: ""
    property string activeChannelId: ""
    property string activeTitle: ""
    property string state: "idle"
    property bool paused: mediaPlayer.playbackState === MediaPlayer.PausedState
    property real positionSeconds: Math.max(0, mediaPlayer.position / 1000)
    property real durationSeconds: Math.max(0, mediaPlayer.duration / 1000)
    property real volume: audioOutput.volume
    property bool muted: audioOutput.muted
    property string lastError: ""
    property var audioTracks: []
    property string selectedAudioTrackId: ""
    property var subtitleTracks: []
    property string selectedSubtitleTrackId: "off"
    property string videoFillMode: "fit"
    property bool liveFullscreenActive: false
    property var recommendedNextEpisode: ({})
    property alias mediaPlayer: mediaPlayer

    property string requestPath: ""
    property string requestMethod: "GET"
    property int requestToken: 0

    function safeText(value) {
        return value === undefined || value === null ? "" : value.toString().trim()
    }

    function setState(nextState) {
        if (state !== nextState) {
            state = nextState
        }
    }

    function normalizeTrackList(rawTracks, fallbackPrefix) {
        const output = []
        if (!rawTracks || rawTracks.length === undefined) {
            return output
        }

        for (let index = 0; index < rawTracks.length; index += 1) {
            const track = rawTracks[index]
            if (!track) {
                continue
            }
            const identifier = track.index !== undefined && track.index !== null
                ? track.index
                : index
            const language = safeText(track.language)
            const title = safeText(track.title)
            const label = title.length
                ? title
                : language.length
                    ? language.toUpperCase()
                    : `${fallbackPrefix} ${index + 1}`

            output.push({
                id: String(identifier),
                label: label
            })
        }

        return output
    }

    function rebuildTrackLists() {
        let activeAudioTrackId = ""
        let activeSubtitleId = "off"

        try {
            audioTracks = normalizeTrackList(mediaPlayer.audioTracks, "Ses")
        } catch (error) {
            audioTracks = []
        }

        try {
            subtitleTracks = normalizeTrackList(mediaPlayer.subtitleTracks, "Altyazı")
        } catch (error) {
            subtitleTracks = []
        }

        try {
            if (mediaPlayer.activeAudioTrack !== undefined && mediaPlayer.activeAudioTrack !== null && mediaPlayer.activeAudioTrack >= 0) {
                activeAudioTrackId = String(mediaPlayer.activeAudioTrack)
            }
        } catch (error) {
            activeAudioTrackId = ""
        }

        try {
            if (mediaPlayer.activeSubtitleTrack !== undefined && mediaPlayer.activeSubtitleTrack !== null && mediaPlayer.activeSubtitleTrack >= 0) {
                activeSubtitleId = String(mediaPlayer.activeSubtitleTrack)
            }
        } catch (error) {
            activeSubtitleId = "off"
        }

        selectedAudioTrackId = activeAudioTrackId
        selectedSubtitleTrackId = activeSubtitleId
    }

    function updateState() {
        if (lastError.length) {
            setState("error")
            return
        }

        if (!activeContentKind.length) {
            setState("idle")
            return
        }

        switch (mediaPlayer.mediaStatus) {
        case MediaPlayer.LoadingMedia:
        case MediaPlayer.BufferingMedia:
        case MediaPlayer.StalledMedia:
            setState("buffering")
            return
        case MediaPlayer.EndOfMedia:
            setState("ended")
            return
        default:
            break
        }

        switch (mediaPlayer.playbackState) {
        case MediaPlayer.PlayingState:
            setState("playing")
            return
        case MediaPlayer.PausedState:
            setState("paused")
            return
        default:
            setState(requestPath.length ? "opening" : "idle")
            return
        }
    }

    function resolvePlaybackSource(path, method, callback) {
        const token = safeText(apiClient.accessToken)
        if (!token.length) {
            callback("", "Oturum bulunamadı.")
            return
        }

        const xhr = new XMLHttpRequest()
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                return
            }

            if (xhr.status < 200 || xhr.status >= 300) {
                let message = "Playback kaynağı alınamadı."
                try {
                    const errorPayload = JSON.parse(xhr.responseText)
                    if (errorPayload && errorPayload.message) {
                        message = errorPayload.message.toString()
                    }
                } catch (error) {
                }
                callback("", message)
                return
            }

            try {
                const payload = JSON.parse(xhr.responseText)
                const sourceUrl = safeText(payload.url)
                    || safeText(payload.source && payload.source.url)
                    || safeText(payload.playback && payload.playback.url)
                callback(sourceUrl, sourceUrl.length ? "" : "Playback URL bulunamadı.")
            } catch (error) {
                callback("", "Playback yanıtı çözülemedi.")
            }
        }

        xhr.open(method, apiClient.apiBaseUrl + path)
        xhr.setRequestHeader("Authorization", "Bearer " + token)
        xhr.setRequestHeader("Accept", "application/json")
        xhr.setRequestHeader("X-Flixify-Client-Runtime", "native")
        if (method === "POST") {
            xhr.setRequestHeader("Content-Type", "application/json")
            xhr.send("{}")
        } else {
            xhr.send()
        }
    }

    function playRequest(kind, id, title, path, method) {
        requestToken += 1
        const currentToken = requestToken

        activeContentKind = kind
        activeTitle = safeText(title)
        requestPath = path
        requestMethod = method
        lastError = ""
        recommendedNextEpisode = ({})
        if (kind === "live") {
            activeChannelId = id
            activeContentId = id
        } else {
            activeContentId = id
            activeChannelId = ""
        }

        mediaPlayer.stop()
        rebuildTrackLists()
        setState("resolving")

        resolvePlaybackSource(path, method, function(sourceUrl, errorMessage) {
            if (currentToken !== requestToken) {
                return
            }

            if (!sourceUrl.length) {
                lastError = errorMessage
                setState("error")
                return
            }

            mediaPlayer.stop()
            mediaPlayer.source = sourceUrl
            lastError = ""
            setState("opening")
            mediaPlayer.play()
        })
    }

    function playVod(kind, id, title) {
        const normalizedKind = safeText(kind)
        const contentId = safeText(id)
        if (!normalizedKind.length || !contentId.length) {
            lastError = "İçerik kimliği bulunamadı."
            setState("error")
            return
        }

        if (normalizedKind === "movie") {
            playRequest(
                "movie",
                contentId,
                title,
                "/me/native/vod/movie/" + encodeURIComponent(contentId) + "/playback?platform=android-native-qt&clientRuntime=native",
                "POST"
            )
            return
        }

        if (normalizedKind === "episode") {
            playRequest(
                "episode",
                contentId,
                title,
                "/me/native/vod/episode/" + encodeURIComponent(contentId) + "/playback?platform=android-native-qt&clientRuntime=native",
                "POST"
            )
            return
        }

        lastError = "Desteklenmeyen içerik türü."
        setState("error")
    }

    function playChannel(channelId, title) {
        const normalizedId = safeText(channelId)
        if (!normalizedId.length) {
            lastError = "Kanal kimliği bulunamadı."
            setState("error")
            return
        }

        playRequest(
            "live",
            normalizedId,
            title,
            "/me/native/live/" + encodeURIComponent(normalizedId) + "/playback?platform=android-native-qt&clientRuntime=native&preferRelay=1",
            "GET"
        )
    }

    function retryCurrent() {
        if (!requestPath.length || !activeContentKind.length) {
            return
        }
        playRequest(activeContentKind, activeContentKind === "live" ? activeChannelId : activeContentId, activeTitle, requestPath, requestMethod)
    }

    function stop() {
        requestToken += 1
        mediaPlayer.stop()
        activeContentKind = ""
        activeContentId = ""
        activeChannelId = ""
        activeTitle = ""
        requestPath = ""
        requestMethod = "GET"
        lastError = ""
        recommendedNextEpisode = ({})
        rebuildTrackLists()
        setState("idle")
    }

    function resume() {
        if (!activeContentKind.length) {
            return
        }
        mediaPlayer.play()
        updateState()
    }

    function pause() {
        mediaPlayer.pause()
        updateState()
    }

    function togglePause() {
        if (!activeContentKind.length) {
            return
        }
        if (paused || mediaPlayer.playbackState !== MediaPlayer.PlayingState) {
            mediaPlayer.play()
        } else {
            mediaPlayer.pause()
        }
        updateState()
    }

    function seekBy(seconds) {
        if (durationSeconds <= 0) {
            return
        }
        const target = Math.max(0, Math.min(mediaPlayer.duration, mediaPlayer.position + (Number(seconds) || 0) * 1000))
        mediaPlayer.position = target
        updateState()
    }

    function seekTo(seconds) {
        if (durationSeconds <= 0) {
            return
        }
        const target = Math.max(0, Math.min(mediaPlayer.duration, (Number(seconds) || 0) * 1000))
        mediaPlayer.position = target
        updateState()
    }

    function setVolume(value) {
        const nextValue = Math.max(0, Math.min(1, Number(value)))
        audioOutput.volume = nextValue
        if (nextValue > 0 && audioOutput.muted) {
            audioOutput.muted = false
        }
    }

    function toggleMuted() {
        audioOutput.muted = !audioOutput.muted
    }

    function selectAudioTrack(id) {
        const normalizedId = safeText(id)
        selectedAudioTrackId = normalizedId
        try {
            mediaPlayer.activeAudioTrack = normalizedId.length ? Number(normalizedId) : -1
        } catch (error) {
        }
    }

    function selectSubtitleTrack(id) {
        const normalizedId = safeText(id)
        selectedSubtitleTrackId = normalizedId.length ? normalizedId : "off"
        try {
            mediaPlayer.activeSubtitleTrack = normalizedId === "off" || !normalizedId.length ? -1 : Number(normalizedId)
        } catch (error) {
        }
    }

    function refreshVideoLayout() {
    }

    AudioOutput {
        id: audioOutput
        volume: 1.0
        muted: false
    }

    MediaPlayer {
        id: mediaPlayer
        audioOutput: audioOutput

        onPlaybackStateChanged: {
            root.rebuildTrackLists()
            root.updateState()
        }

        onMediaStatusChanged: {
            root.rebuildTrackLists()
            root.updateState()
        }

        onSourceChanged: {
            root.rebuildTrackLists()
            root.updateState()
        }

        onErrorOccurred: function(error, errorString) {
            root.lastError = root.safeText(errorString) || "İçerik oynatılamadı."
            root.updateState()
        }
    }
}
