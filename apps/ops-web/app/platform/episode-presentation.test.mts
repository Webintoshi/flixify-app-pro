import assert from "node:assert/strict";
import test from "node:test";
import { episodeDisplayTitle } from "./episode-presentation.ts";

test("provider series prefix and episode code do not repeat in the episode card", () => {
  assert.equal(episodeDisplayTitle({ id: "1", title: "House of the Dragon (2022) - S01E01 - Ejderha'nın Varisleri", seasonNumber: 1, episodeNumber: 1, playbackAllowed: true }, "House of the Dragon (2022)"), "Ejderha'nın Varisleri");
});

test("original episode titles remain intact when no provider prefix is present", () => {
  assert.equal(episodeDisplayTitle({ id: "2", title: "The Long Night", seasonNumber: 1, episodeNumber: 2, playbackAllowed: true }, "Example Series"), "The Long Night");
});
