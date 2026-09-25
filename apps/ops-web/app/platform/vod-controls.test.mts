import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./detail.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./vod-player.module.css", import.meta.url), "utf8");
const episodeDrawer = readFileSync(new URL("./vod-episode-drawer.tsx", import.meta.url), "utf8");

test("film and series player uses the native video element with accessible cinema controls", () => {
  assert.match(source, /<video ref=\{ref\} autoPlay playsInline/);
  assert.doesNotMatch(source, /VideoSkin|VideoPlayer|@videojs\/react/);
  for (const label of ["Detaya dön", "10 saniye geri", "10 saniye ileri", "Oynatma hızı", "Tam ekran"]) {
    assert.ok(source.includes(label), `${label} kontrolü eksik`);
  }
  assert.match(source, /video\.currentTime\s*=\s*clampSeekTime/);
  assert.match(source, /video\.playbackRate\s*=/);
});

test("captions and episode controls come from actual media data", () => {
  assert.match(source, /video\.textTracks/);
  assert.match(source, /tracks\.length\s*>\s*0/);
  assert.match(source, /seasons\?\.length/);
  assert.match(episodeDrawer, /episode\.playbackAllowed/);
  assert.doesNotMatch(source, /Sahte ses|Türkçe dublaj|English audio/);
});

test("active video uses the full viewport player layout", () => {
  assert.match(source, /playback \? player\.playerDialog/);
  assert.match(source, /player\.cinema/);
  assert.match(styles, /\.playerDialog\.playerDialog/);
  assert.match(styles, /\.cinema\.cinema/);
});
