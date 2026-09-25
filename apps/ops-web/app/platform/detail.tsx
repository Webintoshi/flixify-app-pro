"use client";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { apiRequest } from "../../lib/api";
import { Artwork, FavoriteButton } from "./artwork";
import { firstUnwatchedEpisode, nextPlayableEpisode } from "./episode-navigation";
import { episodeDisplayTitle } from "./episode-presentation";
import { SeriesDetailView } from "./series-detail";
import { VodEpisodeDrawer } from "./vod-episode-drawer";
import { Icon } from "./icons";
import { clampSeekTime, formatPlayerTime, playableDuration } from "../components/player-chrome-policy";
import type { Episode, MediaItem } from "./types";
import s from "./platform.module.css";
import player from "./vod-player.module.css";
type Playback = { url: string | null; canPlay: boolean; errorMessage?: string | null; transport: string; deliveryMode?: string };
type EndPrompt = { title: string; seconds?: number; onPlay?: () => void; onCancel: () => void };
function playbackErrorMessage(cause: unknown, kind: MediaItem["kind"]): string {
  const message = cause instanceof Error ? cause.message : "İçerik açılamadı.";
  if (/^Upstream\s+\d{3}\b/i.test(message)) {
    return kind === "series"
      ? "Bu bölüm şu anda yayın kaynağından açılamıyor. Biraz sonra yeniden dene veya başka bir bölüm seç."
      : "Bu film şu anda yayın kaynağından açılamıyor. Biraz sonra yeniden dene.";
  }
  return message;
}
function shouldUseNativeHls(userAgent: string, nativeSupport: string): boolean {
  if (!nativeSupport) return false;
  const appleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const desktopSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|OPR|Android/i.test(userAgent);
  return appleMobile || desktopSafari;
}
type PlayerIconName = "back" | "play" | "pause" | "rewind" | "forward" | "volume" | "muted" | "episodes" | "next" | "captions" | "fullscreen" | "fullscreenExit" | "close";

function PlayerIcon({ name }: { name: PlayerIconName }) {
  const shape = { width: 23, height: 23, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<PlayerIconName, React.ReactNode> = {
    back: <><path d="m14 5-7 7 7 7"/><path d="M8 12h12"/></>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="3"/></>,
    rewind: <><path d="M8 7H4v4"/><path d="M4 11a8 8 0 1 1 .7 4"/><text x="8" y="15.1" fill="currentColor" stroke="none" fontSize="7.6" fontWeight="800">10</text></>,
    forward: <><path d="M16 7h4v4"/><path d="M20 11a8 8 0 1 0-.7 4"/><text x="8" y="15.1" fill="currentColor" stroke="none" fontSize="7.6" fontWeight="800">10</text></>,
    volume: <><path d="M4 9h4l5-4v14l-5-4H4V9Z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/></>,
    muted: <><path d="M4 9h4l5-4v14l-5-4H4V9Z"/><path d="m17 9 4 6m0-6-4 6"/></>,
    episodes: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h9M8 13h9M8 17h6"/></>,
    next: <><path d="m5 5 10 7-10 7V5Z"/><path d="M19 5v14" strokeWidth="2.5"/></>,
    captions: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 12a2 2 0 1 0 2-2m4 2a2 2 0 1 0 2-2"/></>,
    fullscreen: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></>,
    fullscreenExit: <><path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5"/></>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
  };
  return <svg {...shape}>{paths[name]}</svg>;
}

type CaptionTrack = { index: number; label: string; active: boolean };
type VodControlsProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  title: string;
  seriesTitle?: string;
  currentEpisode?: Episode | null;
  seasons?: MediaItem["seasons"];
  posterUrl?: string | null;
  watchedIds?: ReadonlySet<string>;
  nextEpisode?: Episode | null;
  onBack?: () => void;
  onSelectEpisode?: (episode: Episode) => void;
  onNextEpisode?: () => void;
};

function VodControls({ videoRef, title, seriesTitle, currentEpisode, seasons, posterUrl, watchedIds, nextEpisode, onBack, onSelectEpisode, onNextEpisode }: VodControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [tracks, setTracks] = useState<CaptionTrack[]>([]);
  const [openMenu, setOpenMenu] = useState<"speed" | "captions" | null>(null);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncPlayback = () => setPlaying(!video.paused && !video.ended);
    const syncVolume = () => { setMuted(video.muted); setVolume(video.volume); };
    const syncTime = () => setCurrentTime(video.currentTime || 0);
    const syncDuration = () => setDuration(playableDuration(video.duration));
    const syncRate = () => setSpeed(video.playbackRate);
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === video.parentElement);
    const syncTracks = () => setTracks(Array.from(video.textTracks, (track, index) => ({ index, label: track.label || track.language || `Altyazı ${index + 1}`, active: track.mode === "showing" })));
    syncPlayback(); syncVolume(); syncTime(); syncDuration(); syncRate(); syncTracks();
    video.addEventListener("play", syncPlayback);
    video.addEventListener("pause", syncPlayback);
    video.addEventListener("ended", syncPlayback);
    video.addEventListener("volumechange", syncVolume);
    video.addEventListener("timeupdate", syncTime);
    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("loadedmetadata", syncTracks);
    video.addEventListener("ratechange", syncRate);
    video.textTracks.addEventListener("addtrack", syncTracks);
    video.textTracks.addEventListener("removetrack", syncTracks);
    video.textTracks.addEventListener("change", syncTracks);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      video.removeEventListener("play", syncPlayback);
      video.removeEventListener("pause", syncPlayback);
      video.removeEventListener("ended", syncPlayback);
      video.removeEventListener("volumechange", syncVolume);
      video.removeEventListener("timeupdate", syncTime);
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("loadedmetadata", syncTracks);
      video.removeEventListener("ratechange", syncRate);
      video.textTracks.removeEventListener("addtrack", syncTracks);
      video.textTracks.removeEventListener("removetrack", syncTracks);
      video.textTracks.removeEventListener("change", syncTracks);
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, [videoRef]);

  useEffect(() => {
    const surface = videoRef.current?.parentElement;
    if (!surface || !playing || episodesOpen || openMenu) { setChromeVisible(true); return; }
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      setChromeVisible(true);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!surface.contains(document.activeElement)) setChromeVisible(false);
      }, 3_000);
    };
    surface.addEventListener("pointermove", reveal);
    surface.addEventListener("pointerdown", reveal);
    surface.addEventListener("keydown", reveal);
    reveal();
    return () => {
      clearTimeout(idleTimer);
      surface.removeEventListener("pointermove", reveal);
      surface.removeEventListener("pointerdown", reveal);
      surface.removeEventListener("keydown", reveal);
    };
  }, [videoRef, playing, episodesOpen, openMenu]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };
  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = duration ? clampSeekTime(video.currentTime + seconds, duration) : Math.max(0, video.currentTime + seconds);
    setCurrentTime(video.currentTime);
  };
  const toggleFullscreen = () => {
    const surface = videoRef.current?.parentElement;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (surface?.requestFullscreen) void surface.requestFullscreen().catch(() => undefined);
    else (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
  };
  const chooseCaption = (index: number | null) => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = i === index ? "showing" : "disabled";
    setTracks(Array.from(video.textTracks, (track, i) => ({ index: i, label: track.label || track.language || `Altyazı ${i + 1}`, active: track.mode === "showing" })));
    setOpenMenu(null);
  };
  const canOpenEpisodes = Boolean(seasons?.length && onSelectEpisode);

  return <div className={player.overlay} data-visible={chromeVisible || episodesOpen || Boolean(openMenu)}>
    <div className={player.header}>
      {onBack && <button type="button" className={`${player.iconButton} ${player.backButton}`} onClick={onBack} aria-label="Detaya dön" title="Detaya dön"><PlayerIcon name="back"/></button>}
      <div className={player.heading}><strong>{seriesTitle ?? title}</strong>{currentEpisode && <span>{currentEpisode.seasonNumber}. Sezon · {currentEpisode.episodeNumber}. Bölüm · {episodeDisplayTitle(currentEpisode, seriesTitle ?? title)}</span>}</div>
    </div>
    <div className={player.bottom} role="group" aria-label={`${title} oynatıcı kontrolleri`}>
      <input className={player.seek} type="range" min="0" max={duration ?? 1} step="0.1" value={duration ? Math.min(currentTime, duration) : 0} disabled={!duration} aria-label="İlerleme" aria-valuetext={`${formatPlayerTime(currentTime)} / ${formatPlayerTime(duration ?? 0)}`} style={{ "--vod-progress": `${duration ? Math.min(currentTime / duration * 100, 100) : 0}%` } as CSSProperties} onChange={event => { const video = videoRef.current; if (!video || !duration) return; video.currentTime = clampSeekTime(Number(event.currentTarget.value), duration); setCurrentTime(video.currentTime); }}/>
      <div className={player.row}>
        <div className={player.controlGroup}>
          <button type="button" className={`${player.iconButton} ${player.mainPlay}`} onClick={togglePlay} aria-label={playing ? "Duraklat" : "Oynat"} title={playing ? "Duraklat" : "Oynat"}><PlayerIcon name={playing ? "pause" : "play"}/></button>
          <button type="button" className={player.iconButton} onClick={() => skip(-10)} aria-label="10 saniye geri" title="10 saniye geri"><PlayerIcon name="rewind"/></button>
          <button type="button" className={player.iconButton} onClick={() => skip(10)} aria-label="10 saniye ileri" title="10 saniye ileri"><PlayerIcon name="forward"/></button>
          <span className={player.time}>{formatPlayerTime(currentTime)} <span>/ {formatPlayerTime(duration ?? 0)}</span></span>
          <button type="button" className={player.iconButton} onClick={() => { const video = videoRef.current; if (video) video.muted = !video.muted; }} aria-label={muted || volume === 0 ? "Sesi aç" : "Sessize al"} title={muted || volume === 0 ? "Sesi aç" : "Sessize al"}><PlayerIcon name={muted || volume === 0 ? "muted" : "volume"}/></button>
          <input className={player.volume} type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Ses düzeyi" onChange={event => { const video = videoRef.current; if (!video) return; video.volume = Number(event.currentTarget.value); video.muted = video.volume === 0; }}/>
        </div>
        <div className={player.controlGroup}>
          {canOpenEpisodes && <button type="button" className={player.iconButton} onClick={() => { setOpenMenu(null); setEpisodesOpen(value => !value); }} aria-label="Bölümler" aria-expanded={episodesOpen} title="Bölümler"><PlayerIcon name="episodes"/></button>}
          {nextEpisode && onNextEpisode && <button type="button" className={player.iconButton} onClick={onNextEpisode} aria-label="Sonraki bölüm" title="Sonraki bölüm"><PlayerIcon name="next"/></button>}
          {tracks.length > 0 && <div className={player.menuAnchor}><button type="button" className={player.iconButton} onClick={() => { setEpisodesOpen(false); setOpenMenu(value => value === "captions" ? null : "captions"); }} aria-label="Altyazılar" aria-expanded={openMenu === "captions"} title="Altyazılar"><PlayerIcon name="captions"/></button>{openMenu === "captions" && <div className={player.menu} role="group" aria-label="Altyazı seç"><span>Altyazılar</span><button type="button" aria-pressed={!tracks.some(track => track.active)} onClick={() => chooseCaption(null)}>Kapalı</button>{tracks.map(track => <button type="button" key={track.index} aria-pressed={track.active} onClick={() => chooseCaption(track.index)}>{track.label}</button>)}</div>}</div>}
          <div className={player.menuAnchor}><button type="button" className={`${player.iconButton} ${player.speedButton}`} onClick={() => { setEpisodesOpen(false); setOpenMenu(value => value === "speed" ? null : "speed"); }} aria-label="Oynatma hızı" aria-expanded={openMenu === "speed"} title="Oynatma hızı">{speed}×</button>{openMenu === "speed" && <div className={player.menu} role="group" aria-label="Hız seç"><span>Oynatma hızı</span>{[0.75, 1, 1.25, 1.5, 2].map(rate => <button type="button" key={rate} aria-pressed={speed === rate} onClick={() => { const video = videoRef.current; if (video) video.playbackRate = rate; setOpenMenu(null); }}>{rate}×</button>)}</div>}</div>
          <button type="button" className={player.iconButton} onClick={toggleFullscreen} aria-label={fullscreen ? "Tam ekrandan çık" : "Tam ekran"} title={fullscreen ? "Tam ekrandan çık" : "Tam ekran"}><PlayerIcon name={fullscreen ? "fullscreenExit" : "fullscreen"}/></button>
        </div>
      </div>
    </div>
    {episodesOpen && seasons && onSelectEpisode && <VodEpisodeDrawer seriesTitle={seriesTitle ?? title} seasons={seasons} currentEpisode={currentEpisode} posterUrl={posterUrl} watchedIds={watchedIds} onClose={() => setEpisodesOpen(false)} onSelectEpisode={episode => { setEpisodesOpen(false); onSelectEpisode(episode); }}/>}
  </div>;
}

export function VodPlayer({ playback, title, resumeAt = 0, onDirectFailure, onProgress, onEnded, endPrompt, seriesTitle, currentEpisode, seasons, posterUrl, watchedIds, nextEpisode, onBack, onSelectEpisode, onNextEpisode }: { playback: Playback; title: string; resumeAt?: number; onDirectFailure?: (time: number) => void; onProgress?: (time: number) => void; onEnded?: () => void; endPrompt?: EndPrompt | null; seriesTitle?: string; currentEpisode?: Episode | null; seasons?: MediaItem["seasons"]; posterUrl?: string | null; watchedIds?: ReadonlySet<string>; nextEpisode?: Episode | null; onBack?: () => void; onSelectEpisode?: (episode: Episode) => void; onNextEpisode?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const failureHandler = useRef(onDirectFailure);
  failureHandler.current = onDirectFailure;
  const progressHandler = useRef(onProgress);
  progressHandler.current = onProgress;
  const endedHandler = useRef(onEnded);
  endedHandler.current = onEnded;
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [needsPlayGesture, setNeedsPlayGesture] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackRequested = false;
    let hlsHandlesErrors = false;
    const video = ref.current;
    if (!video || !playback.url) return;
    setError("");
    const clearStallTimer = () => { if (stallTimer) clearTimeout(stallTimer); stallTimer = undefined; };
    const fail = () => {
      if (cancelled || fallbackRequested) return;
      if (playback.deliveryMode === "direct_provider" && failureHandler.current) {
        fallbackRequested = true;
        clearStallTimer();
        failureHandler.current(video.currentTime || 0);
      } else setError("Bu içerik tarayıcıda açılamadı. Yeniden deneyebilirsin.");
    };
    const waitForStream = () => {
      if (playback.deliveryMode !== "direct_provider" || fallbackRequested || stallTimer) return;
      stallTimer = setTimeout(() => { stallTimer = undefined; fail(); }, 12_000);
    };
    const restorePosition = () => {
      if (resumeAt > 0 && Number.isFinite(resumeAt)) {
        video.currentTime = Number.isFinite(video.duration) ? Math.min(resumeAt, Math.max(0, video.duration - 1)) : resumeAt;
      }
    };
    const reportProgress = () => progressHandler.current?.(video.currentTime || 0);
    const reportEnded = () => endedHandler.current?.();
    const markPlaying = () => setNeedsPlayGesture(false);
    const startPlayback = () => {
      setNeedsPlayGesture(false);
      void video.play().catch(cause => {
        if (cancelled) return;
        if (cause instanceof DOMException && cause.name === "NotAllowedError") setNeedsPlayGesture(true);
        else if (cause instanceof DOMException && cause.name === "AbortError") return;
        else if (playback.transport === "hls") setNeedsPlayGesture(true);
        else fail();
      });
    };
    const handleVideoError = () => { if (!hlsHandlesErrors) fail(); };
    video.addEventListener("error", handleVideoError);
    video.addEventListener("loadstart", waitForStream);
    video.addEventListener("waiting", waitForStream);
    video.addEventListener("stalled", waitForStream);
    video.addEventListener("canplay", clearStallTimer);
    video.addEventListener("playing", clearStallTimer);
    video.addEventListener("playing", markPlaying);
    video.addEventListener("loadedmetadata", restorePosition);
    video.addEventListener("timeupdate", reportProgress);
    video.addEventListener("ended", reportEnded);
    if (playback.transport === "hls" || /\.m3u8(?:\?|$)/i.test(playback.url)) {
      const nativeHlsSupport = video.canPlayType("application/vnd.apple.mpegurl");
      if (shouldUseNativeHls(navigator.userAgent, nativeHlsSupport)) { video.src = playback.url; startPlayback(); }
      else void import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) { fail(); return; }
        hlsHandlesErrors = true;
        let networkRecoveries = 0;
        let mediaRecoveries = 0;
        let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
        const hls = new Hls({ maxBufferLength: 30, backBufferLength: 30 });
        hls.loadSource(playback.url!); hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
        hls.on(Hls.Events.FRAG_LOADED, () => { networkRecoveries = 0; });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal || cancelled) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 3) {
            networkRecoveries++;
            if (recoveryTimer) clearTimeout(recoveryTimer);
            recoveryTimer = setTimeout(() => { if (!cancelled) hls.startLoad(video.currentTime); }, networkRecoveries * 300);
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries++;
            hls.recoverMediaError();
            return;
          }
          fail();
        });
        cleanup = () => { if (recoveryTimer) clearTimeout(recoveryTimer); hls.destroy(); };
      }).catch(fail);
    } else { video.src = playback.url; startPlayback(); }
    return () => { cancelled = true; clearStallTimer(); cleanup(); video.removeEventListener("error", handleVideoError); video.removeEventListener("loadstart", waitForStream); video.removeEventListener("waiting", waitForStream); video.removeEventListener("stalled", waitForStream); video.removeEventListener("canplay", clearStallTimer); video.removeEventListener("playing", clearStallTimer); video.removeEventListener("playing", markPlaying); video.removeEventListener("loadedmetadata", restorePosition); video.removeEventListener("timeupdate", reportProgress); video.removeEventListener("ended", reportEnded); video.pause(); video.removeAttribute("src"); video.load(); };
  }, [playback.url, playback.transport, playback.deliveryMode, resumeAt, retry]);
  return <div className={`${s.vodPlayer} ${player.cinema}`}><video ref={ref} autoPlay playsInline preload="metadata" aria-label={title}/><VodControls videoRef={ref} title={title} seriesTitle={seriesTitle} currentEpisode={currentEpisode} seasons={seasons} posterUrl={posterUrl} watchedIds={watchedIds} nextEpisode={nextEpisode} onBack={onBack} onSelectEpisode={onSelectEpisode} onNextEpisode={onNextEpisode}/>{needsPlayGesture && !error && !endPrompt && <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "grid", placeItems: "center", pointerEvents: "none" }}><button className={s.primary} style={{ width: 72, height: 72, padding: 0, borderRadius: "50%", pointerEvents: "auto" }} aria-label="Oynat" onClick={() => { const video = ref.current; if (!video) return; void video.play().then(() => setNeedsPlayGesture(false)).catch(cause => { if (cause instanceof DOMException && cause.name === "AbortError") return; if (playback.transport === "hls") { setNeedsPlayGesture(true); return; } setError("Bu içerik tarayıcıda açılamadı. Yeniden deneyebilirsin."); }); }}><Icon name="play" filled/></button></div>}{error && <div className={s.playerError} role="alert"><p>{error}</p><button className={s.primary} onClick={() => setRetry(v => v+1)}>Tekrar Dene</button></div>}{endPrompt && <div className={s.nextEpisodePrompt} role="status"><span>{endPrompt.onPlay ? "Sıradaki bölüm" : "Tamamlandı"}</span><h3>{endPrompt.title}</h3>{endPrompt.onPlay && <p>{endPrompt.seconds} saniye içinde otomatik başlayacak.</p>}<div>{endPrompt.onPlay && <button className={s.primary} onClick={endPrompt.onPlay}>Şimdi Oynat</button>}<button className={s.secondary} onClick={endPrompt.onCancel}>{endPrompt.onPlay ? "İptal" : "Kapat"}</button></div></div>}</div>;
}
export function Detail({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [watched, setWatched] = useState(() => new Set(item.seasons?.flatMap(value => value.episodes).filter(value => value.watched).map(value => value.id) ?? []));
  const [season, setSeason] = useState(() => firstUnwatchedEpisode(item.seasons ?? [], watched)?.seasonNumber ?? item.seasons?.[0]?.seasonNumber ?? 1);
  const [autoAdvance, setAutoAdvance] = useState<{ episode: Episode | null; seconds: number } | null>(null);
  const request = useRef(0);
  const activeSelection = useRef<{ kind: "movie" | "episode"; id: string } | null>(null);
  const activeEpisode = useRef<Episode | null>(null);
  const resumeAt = useRef(0);
  useEffect(() => { ref.current?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { request.current++; document.body.style.overflow = previous; }; }, []);
  const play = async (episode?: Episode) => {
    const selection = { kind: episode ? "episode" as const : "movie" as const, id: episode?.id ?? item.id };
    activeSelection.current = selection;
    activeEpisode.current = episode ?? null;
    setAutoAdvance(null);
    if (episode) setSeason(episode.seasonNumber);
    resumeAt.current = 0;
    const version = ++request.current; setBusy(true); setError(""); setPlayback(null);
    try { const deliveryQuery = "vodDirect=1"; const data = await apiRequest<Playback>(`/me/vod/${selection.kind}/${encodeURIComponent(selection.id)}/playback?clientRuntime=browser&${deliveryQuery}`); if (version !== request.current) return; if (!data.canPlay || !data.url) throw new Error(data.errorMessage ?? "İçerik şu anda kullanılamıyor."); if (new URL(data.url, location.origin).protocol !== "https:" && location.protocol === "https:") throw new Error("Güvenli oynatma adresi hazırlanamadı."); setTitle(episode?.title ?? item.title); setPlayback(data); }
    catch (error) { if (version === request.current) setError(playbackErrorMessage(error, item.kind)); }
    finally { if (version === request.current) setBusy(false); }
  };
  const fallbackToProxy = async (time: number) => {
    const selection = activeSelection.current;
    if (!selection) return;
    resumeAt.current = time;
    const version = ++request.current;
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest<Playback>(`/me/vod/${selection.kind}/${encodeURIComponent(selection.id)}/playback?clientRuntime=browser&direct=0`);
      if (version !== request.current) return;
      if (!data.canPlay || !data.url || (location.protocol === "https:" && new URL(data.url, location.origin).protocol !== "https:")) throw new Error(data.errorMessage ?? "Uyumlu oynatma adresi hazırlanamadı.");
      setPlayback(data);
    } catch (cause) {
      if (version === request.current) { setPlayback(null); setError(playbackErrorMessage(cause, item.kind)); }
    } finally { if (version === request.current) setBusy(false); }
  };
  const persistWatched = async (episode: Episode) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await apiRequest<{ ok: boolean }>(`/me/library/series/${encodeURIComponent(item.id)}/episodes/${encodeURIComponent(episode.id)}/watched`, { method: "PUT" });
        setProgressError("");
        return;
      } catch {
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 600));
      }
    }
    setProgressError("İzlendi bilgisi kaydedilemedi. İnternet bağlantın geldiğinde bölümü yeniden açabilirsin.");
  };
  const finishEpisode = () => {
    const completed = activeEpisode.current;
    if (!completed) return;
    activeEpisode.current = null;
    setWatched(previous => new Set(previous).add(completed.id));
    void persistWatched(completed);
    setAutoAdvance({ episode: nextPlayableEpisode(item.seasons ?? [], completed.id), seconds: 5 });
  };
  useEffect(() => {
    if (!autoAdvance?.episode) return;
    if (autoAdvance.seconds <= 0) {
      const episode = autoAdvance.episode;
      setAutoAdvance(null);
      void play(episode);
      return;
    }
    const timer = window.setTimeout(() => setAutoAdvance(current => current?.episode ? { ...current, seconds: current.seconds - 1 } : current), 1_000);
    return () => window.clearTimeout(timer);
  }, [autoAdvance]);
  const upcomingEpisode = activeEpisode.current ? nextPlayableEpisode(item.seasons ?? [], activeEpisode.current.id) : null;
  const returnToDetail = () => { request.current++; activeSelection.current = null; activeEpisode.current = null; setAutoAdvance(null); setPlayback(null); setBusy(false); };
  return <dialog ref={ref} className={`${s.detail} ${item.kind === "series" ? s.seriesDialog : ""} ${playback ? player.playerDialog : ""}`} aria-label={`${item.title} ayrıntıları`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <article>{!playback && <button autoFocus className={s.close} onClick={onClose} aria-label="Detayı kapat"><Icon name="close"/></button>}
      {playback ? <VodPlayer playback={playback} title={title} resumeAt={resumeAt.current} seriesTitle={item.kind === "series" ? item.title : undefined} currentEpisode={activeEpisode.current} seasons={item.kind === "series" ? item.seasons : undefined} posterUrl={item.kind === "series" ? item.posterUrl ?? item.logoUrl : undefined} watchedIds={item.kind === "series" ? watched : undefined} nextEpisode={upcomingEpisode} onBack={returnToDetail} onSelectEpisode={item.kind === "series" ? episode => { void play(episode); } : undefined} onNextEpisode={upcomingEpisode ? () => { void play(upcomingEpisode); } : undefined} onDirectFailure={time => { void fallbackToProxy(time); }} onProgress={time => { if (playback.deliveryMode === "direct_provider") resumeAt.current = time; }} onEnded={finishEpisode} endPrompt={autoAdvance ? { title: autoAdvance.episode ? `${autoAdvance.episode.seasonNumber}. Sezon · ${autoAdvance.episode.episodeNumber}. Bölüm — ${episodeDisplayTitle(autoAdvance.episode, item.title)}` : "Dizinin tüm bölümlerini tamamladın.", seconds: autoAdvance.seconds, onPlay: autoAdvance.episode ? () => { const next = autoAdvance.episode!; setAutoAdvance(null); void play(next); } : undefined, onCancel: () => setAutoAdvance(null) } : null}/> : item.kind === "series" ? <SeriesDetailView item={item} season={season} onSeasonChange={setSeason} watched={watched} busy={busy} error={error} progressError={progressError} onPlay={episode => { void play(episode); }}/> : <div className={s.detailHero}><Artwork item={item} hero/><div className={s.detailHeading}><span>Film</span><h1>{item.title}</h1><p>{item.groupTitle}</p></div></div>}
      {item.kind !== "series" && <div className={`${s.detailContent} ${playback ? player.hiddenDetail : ""}`}><div className={s.detailActions}><button className={s.primary} disabled={busy || item.playbackAllowed === false} onClick={() => void play()}><Icon name="play" filled/>{busy ? "Hazırlanıyor…" : "Oynat"}</button><FavoriteButton item={item}/></div>
        {item.playbackAllowed === false && <p>Bu içerik şu anda hesabında oynatmaya açık değil.</p>}{error && <p className={s.error} role="alert">{error}</p>}{progressError && <p className={s.error} role="alert">{progressError}</p>}
      </div>}
    </article>
  </dialog>;
}
