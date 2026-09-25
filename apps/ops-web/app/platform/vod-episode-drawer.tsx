"use client";

import { useEffect, useState } from "react";
import { episodeDisplayTitle } from "./episode-presentation";
import type { Episode, MediaItem } from "./types";
import styles from "./vod-episode-drawer.module.css";

type VodEpisodeDrawerProps = {
  seriesTitle: string;
  seasons: MediaItem["seasons"];
  currentEpisode?: Episode | null;
  posterUrl?: string | null;
  watchedIds?: ReadonlySet<string>;
  onSelectEpisode: (episode: Episode) => void;
  onClose: () => void;
};

function CloseIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" /></svg>;
}

function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>;
}

export function VodEpisodeDrawer({ seriesTitle, seasons, currentEpisode, posterUrl, watchedIds, onSelectEpisode, onClose }: VodEpisodeDrawerProps) {
  const [seasonChoice, setSeasonChoice] = useState(currentEpisode?.seasonNumber ?? seasons?.[0]?.seasonNumber ?? 1);

  useEffect(() => {
    setSeasonChoice(currentEpisode?.seasonNumber ?? seasons?.[0]?.seasonNumber ?? 1);
  }, [currentEpisode?.id, currentEpisode?.seasonNumber, seasons]);

  const visibleSeason = seasons?.find(season => season.seasonNumber === seasonChoice) ?? seasons?.[0];

  return <aside className={styles.drawer} aria-label={`${seriesTitle} bölümleri`}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>Bölümler</span>
        <h2>{seriesTitle}</h2>
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Bölümleri kapat" title="Bölümleri kapat"><CloseIcon /></button>
    </header>

    {seasons && seasons.length > 0 && <nav className={styles.seasonNav} aria-label="Sezon seçimi">
      {seasons.map(season => <button
        type="button"
        key={season.seasonNumber}
        aria-pressed={visibleSeason?.seasonNumber === season.seasonNumber}
        onClick={() => setSeasonChoice(season.seasonNumber)}
      >{season.seasonNumber}. Sezon</button>)}
    </nav>}

    <div className={styles.content}>
      {visibleSeason && <div className={styles.seasonHeading}>
        <h3>{visibleSeason.seasonNumber}. Sezon</h3>
        <span>{visibleSeason.episodes.length} bölüm</span>
      </div>}

      {visibleSeason?.episodes.length ? <div className={styles.episodeList}>
        {visibleSeason.episodes.map(episode => {
          const active = episode.id === currentEpisode?.id;
          const watched = watchedIds?.has(episode.id) ?? episode.watched;
          const status = active ? "Şu an oynuyor" : watched ? "İzlendi" : episode.playbackAllowed ? "Oynat" : "Oynatılamıyor";
          const displayTitle = episodeDisplayTitle(episode, seriesTitle);
          return <button
            type="button"
            key={episode.id}
            className={styles.episode}
            data-active={active || undefined}
            disabled={!episode.playbackAllowed}
            aria-current={active ? "true" : undefined}
            aria-label={`${episode.seasonNumber}. sezon ${episode.episodeNumber}. bölüm, ${displayTitle}. ${status}`}
            onClick={() => onSelectEpisode(episode)}
          >
            <span className={styles.thumbnail} aria-hidden="true">
              {posterUrl && <img src={posterUrl} alt="" loading="lazy" />}
              <span className={styles.thumbShade} />
              <span className={styles.thumbNumber}>{episode.episodeNumber}</span>
              {episode.playbackAllowed && <span className={styles.thumbPlay}><PlayIcon /></span>}
            </span>
            <span className={styles.episodeCopy}>
              <span className={styles.episodeIndex}>{episode.seasonNumber}. Sezon · {episode.episodeNumber}. Bölüm</span>
              <strong>{displayTitle}</strong>
              <span className={styles.status} data-status={active ? "active" : watched ? "watched" : undefined}>{status}</span>
            </span>
          </button>;
        })}
      </div> : <p className={styles.empty}>Bu sezon için bölüm bulunamadı.</p>}
    </div>
  </aside>;
}
