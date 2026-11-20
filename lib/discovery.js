export const MARKET_LABELS = { parlay: 'Parlay', leg: 'Objective', over_under: 'Over / under', multiple_choice: 'Multiple choice' };

// Twitch only autoplays muted streams; pass autoplay when the viewer explicitly picked one.
export function streamSource(url, hostname = 'localhost', { autoplay = false } = {}) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (['twitch.tv', 'www.twitch.tv'].includes(parsed.hostname) && /^\/[a-zA-Z0-9_]+\/?$/.test(parsed.pathname)) {
      const channel = parsed.pathname.split('/')[1];
      return { platform: 'Twitch', embed: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(hostname)}&autoplay=${autoplay}&muted=true` };
    }
    const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : ['youtube.com', 'www.youtube.com'].includes(parsed.hostname) ? (parsed.searchParams.get('v') || parsed.pathname.match(/^\/live\/([\w-]+)/)?.[1]) : null;
    if (id && /^[\w-]{11}$/.test(id)) return { platform: 'YouTube', embed: `https://www.youtube.com/embed/${id}?autoplay=0`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  } catch {}
  return null;
}

export function decimalOdds(market, pools) {
  const total = (market.outcomes ?? []).reduce((sum, o) => sum + (pools[o.id] ?? 0), 0);
  return Object.fromEntries((market.outcomes ?? []).map(o => [o.id, total > 0 && pools[o.id] > 0 ? total / pools[o.id] : null]));
}

export function filterSessions(sessions, filters, pools) {
  return sessions.filter(s => (!filters.game || (s.game_name || 'Unspecified game') === filters.game)
    && (!filters.streamer || (s.streamer_name || 'Unnamed streamer') === filters.streamer))
    .map(s => ({ ...s, markets: (s.markets ?? []).filter(m => (!filters.kind || m.kind === filters.kind)
      && (!Number(filters.minOdds) || Object.values(decimalOdds(m, pools)).some(o => o != null && o >= Number(filters.minOdds)))) }))
    .filter(s => (!filters.kind && !Number(filters.minOdds)) || s.markets.length > 0);
}
