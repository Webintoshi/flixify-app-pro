"use client";

import { Artwork, FavoriteButton } from "./artwork";
import { firstUnwatchedEpisode } from "./episode-navigation";
import { episodeDisplayTitle } from "./episode-presentation";
import { Icon } from "./icons";
import type { Episode, MediaItem } from "./types";
import s from "./series-detail.module.css";

type SeriesDetailViewProps = {
  item: MediaItem;
  season: number;
  onSeasonChange: (season: number) => void;
  watched: ReadonlySet<string>;
  busy: boolean;
  error: string;
  progressError: string;
  onPlay: (episode: Episode) => void;
};

export function SeriesDetailView({ item, season, onSeasonChange, watched, busy, error, progressError, onPlay }: SeriesDetailViewProps) {
  const selectedSeason = item.seasons?.find(value => value.seasonNumber === season) ?? item.seasons?.[0];
  const firstEpisode = selectedSeason ? firstUnwatchedEpisode([selectedSeason], watched) : null;
  const seasonCount = item.seasonCount ?? item.seasons?.length ?? 0;
  const episodeCount = item.episodeCount ?? item.seasons?.reduce((total, value) => total + value.episodes.length, 0) ?? 0;
  const canPlay = item.playbackAllowed !== false && Boolean(firstEpisode);
  const playLabel = firstEpisode && watched.has(firstEpisode.id) ? "Yeniden İzle" : watched.size ? "İzlemeye Devam Et" : "İzle";

  return <div className={s.surface}>
    <div className={s.hero}>
      <div className={s.backdrop} aria-hidden="true"><Artwork item={item} hero/></div>
      <div className={s.backdropShade}/>
      <div className={s.heroContent}>
        <div className={s.poster} aria-hidden="true"><Artwork item={item}/></div>
        <div className={s.heroCopy}>
          <span className={s.kind}>DİZİ</span>
          <h1>{item.title}</h1>
          <div className={s.meta} aria-label="Dizi bilgileri">
            {item.groupTitle && <span>{item.groupTitle}</span>}
            {seasonCount > 0 && <span>{seasonCount} sezon</span>}
            {episodeCount > 0 && <span>{episodeCount} bölüm</span>}
          </div>
          {selectedSeason && <p className={s.nowShowing}>{selectedSeason.seasonNumber}. sezon · {selectedSeason.episodes.length} bölüm</p>}
          <div className={s.actions}>
            <button type="button" className={s.playAction} disabled={busy || !canPlay} onClick={() => { if (firstEpisode) onPlay(firstEpisode); }}><Icon name="play" filled/>{busy ? "Hazırlanıyor…" : playLabel}</button>
            <div className={s.favoriteAction}><FavoriteButton item={item} expanded/></div>
          </div>
        </div>
      </div>
    </div>

    <div className={s.body}>
      {item.playbackAllowed === false && <p className={s.notice}>Bu içerik şu anda hesabında oynatmaya açık değil.</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      {progressError && <p className={s.error} role="alert">{progressError}</p>}
      <div className={s.sectionHeader}>
        <div><span className={s.sectionLabel}>SEZON REHBERİ</span><h2>Bölümler</h2></div>
        {selectedSeason && <span className={s.sectionCount}>{selectedSeason.episodes.length} bölüm</span>}
      </div>
      {item.seasons && item.seasons.length > 0 && <div className={s.seasonTabs} role="group" aria-label="Sezon seç">
        {item.seasons.map(value => <button type="button" key={value.seasonNumber} aria-pressed={selectedSeason?.seasonNumber === value.seasonNumber} onClick={() => onSeasonChange(value.seasonNumber)}>{value.seasonNumber}. Sezon</button>)}
      </div>}
      <div id="series-season-episodes" role="region" aria-label={selectedSeason ? `${selectedSeason.seasonNumber}. sezon bölümleri` : "Bölümler"}>
        {selectedSeason?.episodes.length ? <ol className={s.episodeList}>
          {selectedSeason.episodes.map(episode => {
            const isWatched = watched.has(episode.id);
            const disabled = busy || item.playbackAllowed === false || !episode.playbackAllowed;
            const displayTitle = episodeDisplayTitle(episode, item.title);
            return <li key={episode.id}><button type="button" className={s.episode} disabled={disabled} onClick={() => onPlay(episode)} aria-label={`${episode.seasonNumber}. sezon ${episode.episodeNumber}. bölüm: ${displayTitle}${isWatched ? ", izlendi" : ""}${!episode.playbackAllowed ? ", oynatılamıyor" : ""}`}>
              <span className={s.episodeNumber}>{String(episode.episodeNumber).padStart(2, "0")}</span>
              <span className={s.episodeArt} aria-hidden="true"><Artwork item={item}/><span>S{String(episode.seasonNumber).padStart(2, "0")} · B{String(episode.episodeNumber).padStart(2, "0")}</span></span>
              <span className={s.episodeCopy}><strong>{displayTitle}</strong><small>{episode.seasonNumber}. Sezon · {episode.episodeNumber}. Bölüm</small>{!episode.playbackAllowed && <em>Şu anda oynatılamıyor</em>}</span>
              <span className={s.episodeEnd}>{isWatched ? <><Icon name="check"/><small>İzlendi</small></> : episode.playbackAllowed ? <Icon name="play" filled/> : null}</span>
            </button></li>;
          })}
        </ol> : <p className={s.empty}>Bölüm listesi şu anda kullanılamıyor.</p>}
      </div>
    </div>
  </div>;
}
