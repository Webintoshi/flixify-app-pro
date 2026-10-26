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
