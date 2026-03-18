"use client";

import { useState, useRef, useCallback } from "react";
import { formatTime } from "./utils";
import type { VideoQuality } from "./VideoPlayer";

// ============================================
// 🎬 FLIXIFY PRO - Player Controls Component
// YouTube-style control bar
// ============================================

type PlayerControlsProps = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  isTheaterMode: boolean;
  currentQuality: string;
  qualities: VideoQuality[];
  playbackRate: number;
  bufferedRanges: Array<{ start: number; end: number }>;
  title?: string;
  onPlayClick: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onToggleTheaterMode: () => void;
  onQualityChange: (quality: string) => void;
  onPlaybackRateChange: (rate: number) => void;
};

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerControls({
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isFullscreen,
  isTheaterMode,
  currentQuality,
  qualities,
  playbackRate,
  bufferedRanges,
  title,
  onPlayClick,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onToggleTheaterMode,
  onQualityChange,
  onPlaybackRateChange,
}: PlayerControlsProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"quality" | "speed" | null>(null);
  
  const progressRef = useRef<HTMLDivElement>(null);
  const hideVolumeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calculate progress percentage
  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  // Handle progress bar interaction
  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || !duration) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      onSeek(pos * duration);
    },
    [duration, onSeek]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || !duration) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      setHoverTime(Math.max(0, Math.min(pos * duration, duration)));
      
      if (isDragging) {
        onSeek(pos * duration);
      }
    },
    [duration, isDragging, onSeek]
  );

  // Volume slider with auto-hide
  const handleVolumeEnter = useCallback(() => {
    if (hideVolumeTimeout.current) {
      clearTimeout(hideVolumeTimeout.current);
    }
    setShowVolumeSlider(true);
  }, []);

  const handleVolumeLeave = useCallback(() => {
    hideVolumeTimeout.current = setTimeout(() => {
      setShowVolumeSlider(false);
    }, 500);
  }, []);

  // Icons as components for clarity
  const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );

  const PauseIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );

  const VolumeHighIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );

  const VolumeLowIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  );

  const VolumeMuteIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );

  const SettingsIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L5.09 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );

  const FullscreenIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );

  const ExitFullscreenIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  );

  const TheaterModeIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 11H5V5h14v6zm0 2H5v6h14v-6z" />
    </svg>
  );

  const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );

  return (
    <div className="flixify-player__controls">
      {/* Progress Bar */}
      <div
        ref={progressRef}
        className="flixify-player__progress-container"
        onClick={handleProgressClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setHoverTime(null);
          setIsDragging(false);
        }}
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={() => setIsDragging(false)}
      >
        {/* Buffered ranges */}
        {bufferedRanges.map((range, i) => (
          <div
            key={i}
            className="flixify-player__progress-buffered"
            style={{
              left: `${(range.start / duration) * 100}%`,
              width: `${((range.end - range.start) / duration) * 100}%`,
            }}
          />
        ))}

        {/* Progress bar background */}
        <div className="flixify-player__progress-bar">
          <div
            className="flixify-player__progress-played"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Scrubber handle */}
        <div
          className="flixify-player__progress-scrubber"
          style={{ left: `${progressPercent}%` }}
        />

        {/* Hover time tooltip */}
        {hoverTime !== null && (
          <div
            className="flixify-player__progress-tooltip"
            style={{
              left: `${(hoverTime / duration) * 100}%`,
            }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>

      {/* Control buttons */}
      <div className="flixify-player__controls-main">
        <div className="flixify-player__controls-left">
          {/* Play/Pause */}
          <button
            className="flixify-player__control-btn flixify-player__control-btn--large"
            onClick={onPlayClick}
            aria-label={isPlaying ? "Durdur" : "Oynat"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          {/* Volume Control */}
          <div
            className="flixify-player__volume-control"
            onMouseEnter={handleVolumeEnter}
            onMouseLeave={handleVolumeLeave}
          >
            <button
              className="flixify-player__control-btn"
              onClick={onToggleMute}
              aria-label={isMuted ? "Sesi Aç" : "Sesi Kapa"}
            >
              {isMuted || volume === 0 ? (
                <VolumeMuteIcon />
              ) : volume < 0.5 ? (
                <VolumeLowIcon />
              ) : (
                <VolumeHighIcon />
              )}
            </button>

            {/* Volume Slider */}
            {showVolumeSlider && (
              <div className="flixify-player__volume-slider-container">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="flixify-player__volume-slider"
                  style={{
                    background: `linear-gradient(to top, #f40612 ${
                      (isMuted ? 0 : volume) * 100
                    }%, rgba(255,255,255,0.2) ${(isMuted ? 0 : volume) * 100}%)`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Time Display */}
          <div className="flixify-player__time-display">
            <span className="flixify-player__time-current">
              {formatTime(currentTime)}
            </span>
            <span className="flixify-player__time-separator">/</span>
            <span className="flixify-player__time-duration">
              {formatTime(duration)}
            </span>
          </div>

          {/* Title (if provided) */}
          {title && <div className="flixify-player__title">{title}</div>}
        </div>

        <div className="flixify-player__controls-right">
          {/* Settings */}
          <div className="flixify-player__settings-container">
            <button
              className="flixify-player__control-btn"
              onClick={() => {
                setShowSettings(!showSettings);
                setSettingsTab(null);
              }}
              aria-label="Ayarlar"
            >
              <SettingsIcon />
            </button>

            {/* Settings Menu */}
            {showSettings && (
              <div className="flixify-player__settings-menu">
                {!settingsTab ? (
                  <>
                    {qualities.length > 0 && (
                      <button
                        className="flixify-player__settings-item"
                        onClick={() => setSettingsTab("quality")}
                      >
                        <span>Kalite</span>
                        <span>{currentQuality === "auto" ? "Otomatik" : currentQuality}</span>
                      </button>
                    )}
                    <button
                      className="flixify-player__settings-item"
                      onClick={() => setSettingsTab("speed")}
                    >
                      <span>Oynatma Hızı</span>
                      <span>{playbackRate}x</span>
                    </button>
                  </>
                ) : settingsTab === "quality" ? (
                  <>
                    <button
                      className="flixify-player__settings-back"
                      onClick={() => setSettingsTab(null)}
                    >
                      ← Kalite
                    </button>
                    <button
                      className={`flixify-player__settings-option ${
                        currentQuality === "auto" ? "is-active" : ""
                      }`}
                      onClick={() => {
                        onQualityChange("auto");
                        setSettingsTab(null);
                      }}
                    >
                      <span>Otomatik</span>
                      {currentQuality === "auto" && <CheckIcon />}
                    </button>
                    {qualities.map((q) => (
                      <button
                        key={q.value}
                        className={`flixify-player__settings-option ${
                          currentQuality === q.value ? "is-active" : ""
                        }`}
                        onClick={() => {
                          onQualityChange(q.value);
                          setSettingsTab(null);
                        }}
                      >
                        <span>{q.label}</span>
                        {currentQuality === q.value && <CheckIcon />}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      className="flixify-player__settings-back"
                      onClick={() => setSettingsTab(null)}
                    >
                      ← Oynatma Hızı
                    </button>
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        key={rate}
                        className={`flixify-player__settings-option ${
                          playbackRate === rate ? "is-active" : ""
                        }`}
                        onClick={() => {
                          onPlaybackRateChange(rate);
                          setSettingsTab(null);
                        }}
                      >
                        <span>{rate}x</span>
                        {playbackRate === rate && <CheckIcon />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Theater Mode */}
          <button
            className={`flixify-player__control-btn ${
              isTheaterMode ? "is-active" : ""
            }`}
            onClick={onToggleTheaterMode}
            aria-label="Tiyatro Modu"
          >
            <TheaterModeIcon />
          </button>

          {/* Fullscreen */}
          <button
            className="flixify-player__control-btn"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}
