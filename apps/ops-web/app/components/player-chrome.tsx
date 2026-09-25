"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { clampSeekTime, formatPlayerTime, playableDuration, shouldHidePlayerChrome } from "./player-chrome-policy";
import styles from "./player-chrome.module.css";

type PlayerChromeProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  kind: "live" | "vod";
  title: string;
};

type IconName = "play" | "pause" | "volume" | "muted" | "fullscreen" | "fullscreenExit" | "pictureInPicture";

function ControlIcon({ name }: { name: IconName }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "play") return <svg {...common}><path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" /></svg>;
  if (name === "pause") return <svg {...common}><path d="M8 5v14M16 5v14" strokeWidth="3" /></svg>;
  if (name === "volume") return <svg {...common}><path d="M4 9h4l5-4v14l-5-4H4V9Z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
  if (name === "muted") return <svg {...common}><path d="M4 9h4l5-4v14l-5-4H4V9Z" /><path d="m17 9 4 6m0-6-4 6" /></svg>;
  if (name === "fullscreen") return <svg {...common}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>;
  if (name === "fullscreenExit") return <svg {...common}><path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" /></svg>;
  return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none" /></svg>;
}

export function PlayerChrome({ videoRef, kind, title }: PlayerChromeProps) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pictureInPicture, setPictureInPicture] = useState(false);
  const [canPictureInPicture, setCanPictureInPicture] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (kind !== "live") return;
    const surface = videoRef.current?.parentElement?.parentElement;
    if (!surface) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastActivity = Date.now();
    const scheduleHide = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (shouldHidePlayerChrome(kind, Date.now() - lastActivity, Boolean(chromeRef.current?.contains(document.activeElement)))) {
          setChromeVisible(false);
        }
      }, 2500);
    };
    const reveal = () => { lastActivity = Date.now(); setChromeVisible(true); scheduleHide(); };
    const onFocusOut = () => { lastActivity = Date.now(); scheduleHide(); };
    surface.addEventListener("pointermove", reveal);
    surface.addEventListener("pointerdown", reveal);
    surface.addEventListener("touchstart", reveal, { passive: true });
    surface.addEventListener("focusin", reveal);
    surface.addEventListener("focusout", onFocusOut);
    scheduleHide();
    return () => {
      clearTimeout(idleTimer);
      surface.removeEventListener("pointermove", reveal);
      surface.removeEventListener("pointerdown", reveal);
      surface.removeEventListener("touchstart", reveal);
      surface.removeEventListener("focusin", reveal);
      surface.removeEventListener("focusout", onFocusOut);
    };
  }, [kind, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const updatePlayback = () => setPlaying(!video.paused && !video.ended);
    const updateVolume = () => { setMuted(video.muted); setVolume(video.volume); };
    const updateTime = () => { if (kind === "vod") setCurrentTime(video.currentTime || 0); };
    const updateDuration = () => { if (kind === "vod") setDuration(playableDuration(video.duration)); };
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === video.parentElement);
    const enterPictureInPicture = () => setPictureInPicture(true);
    const leavePictureInPicture = () => setPictureInPicture(false);
    updatePlayback();
    updateVolume();
    updateTime();
    updateDuration();
    setCanPictureInPicture(Boolean(document.pictureInPictureEnabled && video.requestPictureInPicture));
    video.addEventListener("play", updatePlayback);
    video.addEventListener("pause", updatePlayback);
    video.addEventListener("ended", updatePlayback);
    video.addEventListener("volumechange", updateVolume);
    if (kind === "vod") {
      video.addEventListener("timeupdate", updateTime);
      video.addEventListener("loadedmetadata", updateDuration);
      video.addEventListener("durationchange", updateDuration);
    }
    video.addEventListener("enterpictureinpicture", enterPictureInPicture);
    video.addEventListener("leavepictureinpicture", leavePictureInPicture);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => {
      video.removeEventListener("play", updatePlayback);
      video.removeEventListener("pause", updatePlayback);
      video.removeEventListener("ended", updatePlayback);
      video.removeEventListener("volumechange", updateVolume);
      if (kind === "vod") {
        video.removeEventListener("timeupdate", updateTime);
        video.removeEventListener("loadedmetadata", updateDuration);
        video.removeEventListener("durationchange", updateDuration);
      }
      video.removeEventListener("enterpictureinpicture", enterPictureInPicture);
      video.removeEventListener("leavepictureinpicture", leavePictureInPicture);
      document.removeEventListener("fullscreenchange", updateFullscreen);
    };
  }, [kind, videoRef]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (video.parentElement?.requestFullscreen) {
      void video.parentElement.requestFullscreen().catch(() => undefined);
    } else {
      (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    }
  };

  const togglePictureInPicture = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void video.requestPictureInPicture().catch(() => undefined);
  };

  return (
    <div ref={chromeRef} className={styles.chrome} data-kind={kind} data-visible={chromeVisible} role="group" aria-label={`${title} oynatıcı kontrolleri`}>
      {kind === "vod" ? (
        <input
          className={styles.seek}
          type="range"
          min="0"
          max={duration ?? 1}
          step="0.1"
          value={duration ? Math.min(currentTime, duration) : 0}
          disabled={!duration}
          aria-label="İlerleme"
          aria-valuetext={`${formatPlayerTime(currentTime)} / ${formatPlayerTime(duration ?? 0)}`}
          style={{ "--player-progress": `${duration ? Math.min((currentTime / duration) * 100, 100) : 0}%` } as React.CSSProperties}
          onChange={(event) => {
            const video = videoRef.current;
            if (video && duration) video.currentTime = clampSeekTime(Number(event.currentTarget.value), duration);
          }}
        />
      ) : null}
      <div className={styles.controls}>
        <button type="button" className={styles.iconButton} onClick={togglePlayback} aria-label={playing ? "Duraklat" : "Oynat"} title={playing ? "Duraklat" : "Oynat"}>
          <ControlIcon name={playing ? "pause" : "play"} />
        </button>
        {kind === "live" ? <span className={styles.liveBadge}><i /> CANLI</span> : <span className={styles.timeLabel}>{formatPlayerTime(currentTime)} <span>/ {formatPlayerTime(duration ?? 0)}</span></span>}
        <span className={styles.spacer} />
        <button type="button" className={styles.iconButton} onClick={() => { const video = videoRef.current; if (video) video.muted = !video.muted; }} aria-label={muted || volume === 0 ? "Sesi aç" : "Sessize al"} title={muted || volume === 0 ? "Sesi aç" : "Sessize al"}>
          <ControlIcon name={muted || volume === 0 ? "muted" : "volume"} />
        </button>
        <input className={styles.volume} type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Ses düzeyi" onChange={(event) => {
          const video = videoRef.current;
          if (!video) return;
          video.volume = Number(event.currentTarget.value);
          video.muted = video.volume === 0;
        }} />
        {kind === "vod" && canPictureInPicture ? <button type="button" className={styles.iconButton} onClick={togglePictureInPicture} aria-label={pictureInPicture ? "Küçük pencereden çık" : "Küçük pencerede oynat"} title="Küçük pencerede oynat"><ControlIcon name="pictureInPicture" /></button> : null}
        <button type="button" className={styles.iconButton} onClick={toggleFullscreen} aria-label={fullscreen ? "Tam ekrandan çık" : "Tam ekran"} title={fullscreen ? "Tam ekrandan çık" : "Tam ekran"}>
          <ControlIcon name={fullscreen ? "fullscreenExit" : "fullscreen"} />
        </button>
      </div>
    </div>
  );
}
