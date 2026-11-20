// Live stream data from Twitch's official Helix API (no scraping). Uses an app access
// token from the client-credentials flow, so no viewer ever signs in to Twitch.
// Twitch has no country filter; English-language streams stand in for "US".
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_URL = 'https://api.twitch.tv/helix';

export const DEFAULT_GAME = 'Grand Theft Auto VI';
export const TOP_STREAM_COUNT = 15;

let cachedToken = null; // { value, expiresAt }
const gameIds = new Map();

export function twitchConfig(env = process.env) {
  const clientId = env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = env.TWITCH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret, gameName: env.TWITCH_GAME_NAME?.trim() || DEFAULT_GAME } : null;
}

async function appToken({ clientId, clientSecret }, fetchImpl, now) {
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');
  const response = await fetchImpl(url, { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error(`Twitch rejected the client ID or secret (${response.status})`);
  const body = await response.json();
  cachedToken = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return cachedToken.value;
}

// GET a Helix endpoint, refreshing the app token once if Twitch says it expired.
async function helix(path, params, config, fetchImpl, now) {
  const url = new URL(`${HELIX_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await appToken(config, fetchImpl, now);
    const response = await fetchImpl(url, {
      headers: { 'Client-Id': config.clientId, Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.status === 401 && attempt === 0) {
      cachedToken = null;
      continue;
    }
    if (!response.ok) throw new Error(`Twitch API error (${response.status})`);
    return (await response.json()).data ?? [];
  }
}

export function trimStream(stream) {
  return {
    login: stream.user_login,
    name: stream.user_name,
    title: stream.title,
    viewers: stream.viewer_count,
    startedAt: stream.started_at,
    thumbnail: stream.thumbnail_url?.replace('{width}', '440').replace('{height}', '248') ?? null,
  };
}

// Top live English streams for the configured game, most-watched first.
// Returns { configured, game, streams, error? } and never throws.
export async function topStreams({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const config = twitchConfig(env);
  if (!config) return { configured: false, game: DEFAULT_GAME, streams: [] };

  try {
    let gameId = gameIds.get(config.gameName);
    if (!gameId) {
      const [game] = await helix('games', { name: config.gameName }, config, fetchImpl, now);
      if (!game) return { configured: true, game: config.gameName, streams: [], error: `Twitch has no category named “${config.gameName}”` };
      gameId = game.id;
      gameIds.set(config.gameName, gameId);
    }
    const streams = await helix(
      'streams',
      { game_id: gameId, language: 'en', type: 'live', first: String(TOP_STREAM_COUNT) },
      config,
      fetchImpl,
      now,
    );
    return { configured: true, game: config.gameName, streams: streams.map(trimStream) };
  } catch (error) {
    return { configured: true, game: config.gameName, streams: [], error: error.message };
  }
}

// For tests: forget cached tokens and game IDs.
export function resetTwitchCache() {
  cachedToken = null;
  gameIds.clear();
}
