import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalOdds, filterSessions, streamSource } from '../lib/discovery.js';
import { validateStreamSettings } from '../lib/stream-settings.js';
const market = { kind: 'parlay', outcomes: [{ id: 'yes' }, { id: 'no' }] };
test('pool odds and filters do not invent odds for empty outcomes', () => {
  assert.deepEqual(decimalOdds(market, {}), { yes: null, no: null });
  assert.deepEqual(decimalOdds(market, { yes: 1, no: 3 }), { yes: 4, no: 4 / 3 });
  const sessions = [{ game_name: 'GTA', streamer_name: 'Host', markets: [market] }];
  assert.equal(filterSessions(sessions, { minOdds: 3 }, { yes: 1, no: 3 }).length, 1);
  assert.equal(filterSessions(sessions, { minOdds: 3 }, {}).length, 0);
  assert.equal(filterSessions(sessions, { game: 'Other' }, {}).length, 0);
  assert.equal(filterSessions(sessions, { streamer: 'Other' }, {}).length, 0);
  assert.equal(filterSessions(sessions, { kind: 'leg' }, {}).length, 0);
});
test('stream previews allow only supported providers and encode parent hostname', () => {
  const twitch = streamSource('https://www.twitch.tv/example', 'localhost');
  assert.equal(new URL(twitch.embed).searchParams.get('parent'), 'localhost');
  assert.equal(streamSource('https://youtu.be/abcdefghijk').platform, 'YouTube');
  assert.equal(streamSource('https://www.youtube.com/live/abcdefghijk').platform, 'YouTube');
  assert.equal(streamSource('https://youtube.com.evil.test/watch?v=abcdefghijk'), null);
  assert.equal(streamSource('javascript:alert(1)'), null);
  assert.equal(streamSource('https://example.com'), null);
});
test('admin stream settings validate optional URLs and viewer snapshots', () => {
  assert.deepEqual(validateStreamSettings({}), {});
  assert.deepEqual(validateStreamSettings({ game_name: ' GTA ', viewer_count: 0 }), { game_name: 'GTA', viewer_count: 0 });
  assert.throws(() => validateStreamSettings({ viewer_count: -1 }));
  assert.throws(() => validateStreamSettings({ stream_url: 'https://example.com' }));
  assert.throws(() => validateStreamSettings({ thumbnail_url: 'javascript:bad' }));
});
