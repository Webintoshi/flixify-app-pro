import assert from "node:assert/strict";
import test from "node:test";
import { firstUnwatchedEpisode, nextPlayableEpisode } from "./episode-navigation.ts";

const seasons = [
  { seasonNumber: 1, title: "1. Sezon", episodes: [
    { id: "s1e1", title: "1", seasonNumber: 1, episodeNumber: 1, playbackAllowed: true, watched: true },
    { id: "s1e2", title: "2", seasonNumber: 1, episodeNumber: 2, playbackAllowed: true, watched: false },
    { id: "s1e3", title: "3", seasonNumber: 1, episodeNumber: 3, playbackAllowed: false, watched: false },
  ] },
  { seasonNumber: 2, title: "2. Sezon", episodes: [
    { id: "s2e1", title: "1", seasonNumber: 2, episodeNumber: 1, playbackAllowed: true, watched: false },
  ] },
];

test("continues with the next playable episode and crosses the season boundary", () => {
  assert.equal(nextPlayableEpisode(seasons, "s1e2")?.id, "s2e1");
  assert.equal(nextPlayableEpisode(seasons, "s2e1"), null);
});

test("the series play action starts from the first unwatched playable episode", () => {
  assert.equal(firstUnwatchedEpisode(seasons, new Set(["s1e1"]))?.id, "s1e2");
  assert.equal(firstUnwatchedEpisode(seasons, new Set(["s1e1", "s1e2", "s2e1"]))?.id, "s1e1");
});
