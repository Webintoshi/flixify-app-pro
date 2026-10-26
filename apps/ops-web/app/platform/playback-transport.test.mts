import assert from 'node:assert/strict';
import test from 'node:test';
import * as policy from './playback-transport.ts';

function usesHls(transport: string | undefined, url: string): boolean {
  assert.equal(typeof (policy as any).usesHlsPlayback, 'function');
  return (policy as any).usesHlsPlayback(transport, url);
}

test('declared MKV MP4 and TS override misleading HLS query or directory text', () => {
  for (const transport of ['mkv', 'mp4', 'ts']) {
    assert.equal(usesHls(transport, 'https://provider.test/.m3u8/1.mkv?subtitle=.m3u8'), false);
    assert.equal(usesHls(transport, 'https://provider.test/1.m3u8'), false);
  }
});
test('declared HLS remains HLS independent of URL text', () => {
  assert.equal(usesHls('hls', 'https://provider.test/1.mp4?format=mkv'), true);
});
test('unknown transport derives HLS only from the final pathname extension', () => {
  assert.equal(usesHls('unknown', 'https://provider.test/series/u/p/1.mkv?subtitle=.m3u8'), false);
  assert.equal(usesHls('unknown', 'https://provider.test/.m3u8/1.ts'), false);
  assert.equal(usesHls('unknown', 'https://provider.test/.mp4/1.M3U8?subtitle=.mkv'), true);
  assert.equal(usesHls(undefined, '/live/u/p/1.m3u8?token=abc'), true);
  assert.equal(usesHls('unknown', 'not a URL'), false);
  assert.equal(usesHls('unknown', 'https://provider.test/1.mp4'), false);
});

test('live engine policy chooses HLS, MPEG-TS, and native file playback', () => {
  const select = (policy as any).selectLivePlaybackEngine;
  assert.equal(typeof select, 'function');
  for (const [transport, expected] of [['hls', 'hls'], ['ts', 'mpegts'], ['mp4', 'native'], ['mkv', 'native']]) {
    assert.equal(select(transport, 'https://provider.test/.m3u8/1.ts?format=.m3u8'), expected);
  }
});

test('live page native branch plays exact URL and registers source clearing cleanup', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../canli-tv/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /const playbackEngine = selectLivePlaybackEngine\(playback.transport, playbackUrl\)/);
  const branch = source.match(/if \(playbackEngine === "native"\) \{([\s\S]*?)\n        \}\n\n        if \(playbackEngine === "hls"\)/);
  assert.ok(branch, 'native file branch must return before HLS and MPEG-TS imports');
  const run = new Function('mediaElement', 'playbackUrl', 'resetMedia', 'cancelled', 'setConnectionState', 'reportDirectEvent',
    `return (async () => { let cleanupCurrent; ${branch[1].replace('          return;', '          return cleanupCurrent;')} })()`);
  for (const transport of ['mp4', 'mkv']) {
    const url = `https://provider.test/live/1.${transport}?subtitle=.m3u8`;
    const events: string[] = [];
    const media = { src: '', play: async () => { events.push('play'); } };
    const cleanup = await run(media, url, () => { media.src = ''; }, false,
      (state: string) => events.push(state), (event: string) => events.push(event));
    assert.equal(media.src, url);
    assert.deepEqual(events, ['play', 'live', 'playing']);
    cleanup();
    assert.equal(media.src, '');
    events.length = 0;
    await run(media, url, () => {}, true, () => events.push('late-state'), () => events.push('late-health'));
    assert.deepEqual(events, ['play']);
  }
});
