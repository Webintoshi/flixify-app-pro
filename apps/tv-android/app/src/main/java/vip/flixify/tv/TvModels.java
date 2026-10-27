package vip.flixify.tv;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Account-scoped data. No bearer token or provider credentials belong in these models. */
public final class TvModels {
    private TvModels() {}
    public enum Kind { LIVE, MOVIE, SERIES, EPISODE }
    private static String text(String s) { return s == null ? "" : s; }
    public static final class Item implements Serializable {
        private static final long serialVersionUID = 1L;
        public final Kind kind;
        public final String id, title, categoryId, categoryName, artwork, extension, scope, seriesId, description;
        public final int season, episode;
        public Item(Kind kind, String id, String title, String categoryId, String categoryName, String artwork,
                    String extension, String scope, String seriesId, int season, int episode, String description) {
            this.kind=kind; this.id=text(id); this.title=text(title); this.categoryId=text(categoryId);
            this.categoryName=text(categoryName); this.artwork=text(artwork); this.extension=text(extension);
            this.scope=text(scope); this.seriesId=text(seriesId); this.season=season; this.episode=episode;
            this.description=text(description);
        }
        public String key() { return kind.name()+":"+id; }
    }
    public static final class Category {
        public final String id, title;
        public Category(String id,String title) { this.id=text(id); this.title=text(title); }
    }
    public static final class Catalog {
        public final Kind kind;
        public final List<Item> items;
        public final List<Category> categories;
        public Catalog(Kind kind,List<Item> items,List<Category> categories) {
            this.kind=kind;this.items=Collections.unmodifiableList(new ArrayList<>(items));
            this.categories=Collections.unmodifiableList(new ArrayList<>(categories));
        }
    }
    public static final class Season {
        public final int number;
        public final List<Item> episodes;
        public Season(int number,List<Item> episodes) {this.number=number;this.episodes=Collections.unmodifiableList(new ArrayList<>(episodes));}
    }
    public static final class SeriesDetail {
        public final Item series;
        public final List<Season> seasons;
        public SeriesDetail(Item series,List<Season> seasons) {this.series=series;this.seasons=Collections.unmodifiableList(new ArrayList<>(seasons));}
    }
    public static final class Account {
        public final String id, codeSuffix, packageTitle, message;
        public final long expiresAtMs;
        public final boolean canPlay, trial;
        public Account(String id,String codeSuffix,String packageTitle,long expiresAtMs,boolean canPlay,boolean trial,String message) {
            this.id=text(id);this.codeSuffix=text(codeSuffix);this.packageTitle=text(packageTitle);this.expiresAtMs=expiresAtMs;
            this.canPlay=canPlay;this.trial=trial;this.message=text(message);
        }
    }
    public static final class Playback {
        public final Item item,nextEpisode;
        /** Sensitive ephemeral media URL: never log, persist or send through Intent. */
        public final String url,mime,scope;
        public final long expiresAtMs,resumePositionMs;
        public Playback(Item item,String url,String mime,long expiresAtMs,long resumePositionMs,Item nextEpisode) {
            this.item=item;this.url=url;this.mime=mime;this.expiresAtMs=expiresAtMs;this.resumePositionMs=resumePositionMs;
            this.nextEpisode=nextEpisode;this.scope=item.scope;
        }
    }
    public static final class Programme {
        public final String title;
        public final long startsAtMs,endsAtMs;
        public Programme(String title,long startsAtMs,long endsAtMs) {this.title=text(title);this.startsAtMs=startsAtMs;this.endsAtMs=endsAtMs;}
    }
    public static final class Failure {
        public enum Code { AUTH, INELIGIBLE, NETWORK, INVALID, STALE, LIMIT }
        public final Code code;
        public final String message;
        public Failure(Code code,String message) {this.code=code;this.message=message;}
    }
}
