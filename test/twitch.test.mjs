import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { resetTwitchCache, topStreams } from '../lib/twitch.js';

const env = { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'secret' };
const stream = {
  user_login: 'streamer_one',
  user_name: 'Streamer_One',
  title: 'GTA VI day one',
  viewer_count: 12345,
  started_at: '2026-11-20T01:00:00Z',
  thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer_one-{width}x{height}.jpg',
};

// Fake Twitch: records requests and answers token, games and streams calls.
function fakeTwitch({ gameData = [{ id: '42' }], streamStatuses = [200] } = {}) {
  const calls = [];
  let tokens = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.hostname === 'id.twitch.tv') return Response.json({ access_token: `token-${++tokens}`, expires_in: 3600 });
    if (url.pathname.endsWith('/games')) return Response.json({ data: gameData });
    const status = streamStatuses.shift() ?? 200;
    return status === 200 ? Response.json({ data: [stream] }) : new Response('', { status });
  };
  return { fetchImpl, calls };
}

beforeEach(resetTwitchCache);

test('reports not configured without credentials and makes no requests', async () => {
  const result = await topStreams({ env: {}, fetchImpl: () => assert.fail('must not fetch') });
  assert.deepEqual(result, { configured: false, game: 'Grand Theft Auto VI', streams: [] });
});

test('fetches the top 15 live English streams for the GTA VI category', async () => {
  const { fetchImpl, calls } = fakeTwitch();
  const result = await topStreams({ env, fetchImpl });

  const [token, games, streams] = calls;
  assert.equal(token.init.method, 'POST');
  assert.equal(token.url.searchParams.get('grant_type'), 'client_credentials');
  assert.equal(games.url.searchParams.get('name'), 'Grand Theft Auto VI');
  assert.equal(games.init.headers['Client-Id'], 'client');
  assert.equal(games.init.headers.Authorization, 'Bearer token-1');
  assert.deepEqual(Object.fromEntries(streams.url.searchParams), { game_id: '42', language: 'en', type: 'live', first: '15' });
  assert.deepEqual(result, {
    configured: true,
    game: 'Grand Theft Auto VI',
    streams: [{
      login: 'streamer_one',
      name: 'Streamer_One',
      title: 'GTA VI day one',
      viewers: 12345,
      startedAt: '2026-11-20T01:00:00Z',
      thumbnail: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer_one-440x248.jpg',
    }],
  });
});

test('reuses the cached token and game ID on later calls', async () => {
  const { fetchImpl, calls } = fakeTwitch();
  await topStreams({ env, fetchImpl });
  await topStreams({ env, fetchImpl });
  assert.equal(calls.filter((c) => c.url.hostname === 'id.twitch.tv').length, 1);
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/games')).length, 1);
});

test('refreshes an expired token once and retries', async () => {
  const { fetchImpl, calls } = fakeTwitch({ streamStatuses: [401, 200] });
  const result = await topStreams({ env, fetchImpl });
  assert.equal(result.streams.length, 1);
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer token-2');
});

test('explains a missing category or API failure instead of throwing', async () => {
  const missing = await topStreams({ env: { ...env, TWITCH_GAME_NAME: 'Not A Game' }, fetchImpl: fakeTwitch({ gameData: [] }).fetchImpl });
  assert.match(missing.error, /no category named “Not A Game”/);
  assert.deepEqual(missing.streams, []);

  resetTwitchCache();
  const down = await topStreams({ env, fetchImpl: fakeTwitch({ streamStatuses: [503] }).fetchImpl });
  assert.equal(down.error, 'Twitch API error (503)');

  resetTwitchCache();
  const badKeys = await topStreams({ env, fetchImpl: async () => new Response('', { status: 400 }) });
  assert.match(badKeys.error, /rejected the client ID or secret/);
});
