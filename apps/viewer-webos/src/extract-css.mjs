import { readFileSync } from 'fs';
const css = readFileSync('styles.css', 'utf8');

const targets = [
  '.shell-content',
  '.site-nav',
  '.site-header',
  '.live-player-video',
  '.live-player-stage',
  '.live-player-frame',
  '.live-player-controls',
  '.movie-player-shell',
  '.movie-player-stage',
  '.movie-player-video',
  '.vod-mini-controls',
  '.vod-mini-control',
  '.player-video'
];

for (const target of targets) {
  let pos = 0;
  while (true) {
    const idx = css.indexOf(target, pos);
    if (idx === -1) break;
    const braceOpen = css.indexOf('{', idx);
    if (braceOpen === -1) break;
    let depth = 1;
    let i = braceOpen + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
      i++;
    }
    const rule = css.substring(idx, i);
    if (rule.length < 800) {
      console.log(`=== ${target} at pos ${idx} ===`);
      console.log(rule);
      console.log();
    }
    pos = i;
  }
}
