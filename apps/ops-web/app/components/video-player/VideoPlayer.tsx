"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import Hls from "hls.js";
import { PlayerControls } from "./PlayerControls";
import { PlayerOverlay } from "./PlayerOverlay";
import { formatTime } from "./utils";
import "./video-player.css";

// ============================================
// 🎬 FLIXIFY PRO - Premium IPTV Video Player
// YouTube-style UI with HLS/DASH support
// ============================================

export type VideoQuality = {
  label: string;
  value: string;
  height: number;
};

export type PlayerProps = {
  src: string;                    // Video source URL
  poster?: string;                // Thumbnail image
  title?: string;                 // Video title
  autoPlay?: boolean;             // Auto start playback
  startTime?: number;             // Start at specific time
  qualities?: VideoQuality[];     // Available qualities (for HLS)
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
};

export function VideoPlayer({
  src,
  poster,
  title,
  autoPlay = false,
  startTime = 0,
  qualities = [],
  onTimeUpdate,
  onEnded,
  onError
}: PlayerProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string>("auto");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [bufferedRanges, setBufferedRanges] = useState<Array<{start: number, end: number}>>([]);

  // Initialize HLS
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);
    setError(null);

    // Check if HLS is supported
    if (src.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          liveSyncDuration: 3,
          fragLoadingTimeOut: 20000,
          manifestLoadingTimeOut: 10000,
          levelLoadingTimeOut: 10000,
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(src);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          if (autoPlay) {
            video.play().catch(() => setIsPlaying(false));
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
          const level = hls.levels[data.level];
          if (level) {
            setCurrentQuality(`${level.height}p`);
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setError("Bağlantı hatası. Tekrar deneniyor...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                setError("Medya hatası. Yeniden yükleniyor...");
                hls.recoverMediaError();
                break;
              default:
                setError("Oynatma hatası oluştu.");
                hls.destroy();
                break;
            }
          }
        });

        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support (Safari)
        video.src = src;
        setIsLoading(false);
      } else {
        setError("Tarayıcınız HLS formatını desteklemiyor.");
      }
    } else {
      // Regular MP4/WebM
      video.src = src;
      setIsLoading(false);
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, autoPlay]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onTimeUpdate?.(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      if (startTime > 0) {
        video.currentTime = startTime;
      }
    };

    const handleWaiting = () => setIsBuffering(true);
    const handleCanPlay = () => setIsBuffering(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.();
    };
    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };
    const handleProgress = () => {
      const ranges: Array<{start: number, end: number}> = [];
      for (let i = 0; i < video.buffered.length; i++) {
        ranges.push({
          start: video.buffered.start(i),
          end: video.buffered.end(i)
        });
      }
      setBufferedRanges(ranges);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("progress", handleProgress);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("progress", handleProgress);
    };
  }, [startTime, onTimeUpdate, onEnded]);

  // Controls auto-hide
  const showControls = useCallback(() => {
    setIsControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 3000);
    }
  }, [isPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return;

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "arrowleft":
          e.preventDefault();
          seek(currentTime - (e.shiftKey ? 10 : 5));
          break;
        case "arrowright":
          e.preventDefault();
          seek(currentTime + (e.shiftKey ? 10 : 5));
          break;
        case "arrowup":
          e.preventDefault();
          setVolumeState(Math.min(volume + 0.1, 1));
          break;
        case "arrowdown":
          e.preventDefault();
          setVolumeState(Math.max(volume - 0.1, 0));
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "t":
          e.preventDefault();
          toggleTheaterMode();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, volume, isPlaying]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Control functions
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(() => setIsPlaying(false));
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    const clampedTime = Math.max(0, Math.min(time, duration));
    video.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }, [duration]);

  const setVolumeState = useCallback((newVolume: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = newVolume;
    video.muted = newVolume === 0;
    setVolume(newVolume);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (document.fullscreenElement === container) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }

    void container.requestFullscreen().catch(() => undefined);
  }, []);

  const toggleTheaterMode = useCallback(() => {
    setIsTheaterMode(prev => !prev);
  }, []);

  const changeQuality = useCallback((quality: string) => {
    if (!hlsRef.current) return;

    if (quality === "auto") {
      hlsRef.current.currentLevel = -1;
    } else {
      const level = hlsRef.current.levels.findIndex(
        l => `${l.height}p` === quality
      );
      if (level !== -1) {
        hlsRef.current.currentLevel = level;
      }
    }
    setCurrentQuality(quality);
  }, []);

  const changePlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  // Double tap handlers for mobile
  const handleDoubleTap = useCallback((side: "left" | "right") => {
    const seekAmount = side === "left" ? -10 : 10;
    seek(currentTime + seekAmount);
  }, [currentTime, seek]);

  const containerClasses = useMemo(() => {
    const classes = ["flixify-player"];
    if (isPlaying) classes.push("is-playing");
    if (isFullscreen) classes.push("is-fullscreen");
    if (isTheaterMode) classes.push("is-theater-mode");
    if (isControlsVisible) classes.push("controls-visible");
    if (isBuffering) classes.push("is-buffering");
    if (isLoading) classes.push("is-loading");
    if (error) classes.push("has-error");
    return classes.join(" ");
  }, [isPlaying, isFullscreen, isTheaterMode, isControlsVisible, isBuffering, isLoading, error]);

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      onMouseMove={showControls}
      onMouseLeave={() => isPlaying && setIsControlsVisible(false)}
      tabIndex={0}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="flixify-player__video"
        poster={poster}
        playsInline
        onClick={togglePlay}
      />

      {/* Big Play Button (when paused) */}
      <PlayerOverlay
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        isLoading={isLoading}
        error={error}
        onPlayClick={togglePlay}
        onDoubleTapLeft={() => handleDoubleTap("left")}
        onDoubleTapRight={() => handleDoubleTap("right")}
      />

      {/* Controls */}
      <PlayerControls
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        isFullscreen={isFullscreen}
        isTheaterMode={isTheaterMode}
        currentQuality={currentQuality}
        qualities={qualities}
        playbackRate={playbackRate}
        bufferedRanges={bufferedRanges}
        title={title}
        onPlayClick={togglePlay}
        onSeek={seek}
        onVolumeChange={setVolumeState}
        onToggleMute={toggleMute}
        onToggleFullscreen={toggleFullscreen}
        onToggleTheaterMode={toggleTheaterMode}
        onQualityChange={changeQuality}
        onPlaybackRateChange={changePlaybackRate}
      />
    </div>
  );
}
