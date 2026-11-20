'use client';

import { useEffect, useState } from 'react';
import { streamSource } from '@/lib/discovery';

const REFRESH_MS = 60_000;

function formatViewers(count) {
  return count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K` : String(count);
}

// Top live streams on the left, one large Twitch player on the right.
export function StreamWatcher() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [host, setHost] = useState('');

  useEffect(() => setHost(window.location.hostname), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/streams');
        const body = await response.json();
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setData((previous) => ({ ...previous, streams: previous?.streams ?? [], error: 'Could not reach the server' }));
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const streams = data?.streams ?? [];
  // Keep the viewer's pick even if a refresh reorders the list; default to the most-watched stream.
  const current = streams.find((stream) => stream.login === selected) ?? streams[0] ?? null;
  const source = current && host ? streamSource(`https://www.twitch.tv/${current.login}`, host, { autoplay: true }) : null;

  return (
    <div className="watch-layout">
      <section className="watch-player" aria-label="Stream player">
        <div className="stream-art">
          {source ? (
            <iframe
              key={current.login}
              title={`${current.name} live on Twitch`}
              src={source.embed}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="preview-empty">
              <span className="play-symbol">▷</span>
              <span>{data ? 'Pick a stream to start watching' : 'Loading live streams…'}</span>
            </div>
          )}
        </div>
        {current && (
          <div className="watch-caption">
            <span className="eyebrow">● LIVE · {formatViewers(current.viewers)} WATCHING</span>
            <h2>{current.name}</h2>
            <p>{current.title}</p>
            <a className="button button-quiet" href={`https://www.twitch.tv/${current.login}`} target="_blank" rel="noreferrer">
              Open on Twitch
            </a>
          </div>
        )}
      </section>

      <aside className="watch-list" aria-label="Top live streams">
        <div className="watch-list-head">
          <span className="eyebrow">TOP {streams.length || 15} LIVE</span>
          <h2>{data?.game ?? 'Grand Theft Auto VI'}</h2>
          <p className="muted">English-language Twitch streams, most watched first. Refreshes every minute.</p>
        </div>

        {data && !data.configured && (
          <p className="muted">
            Twitch isn&apos;t connected yet. Add <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> to{' '}
            <code>.env.local</code>, then restart the dev server.
          </p>
        )}
        {data?.error && <p className="error" role="alert">{data.error}</p>}
        {data?.configured && !data.error && streams.length === 0 && (
          <p className="muted">Nobody is streaming this game in English right now.</p>
        )}

        <ol className="watch-streams">
          {streams.map((stream, i) => (
            <li key={stream.login}>
              <button
                className={`watch-stream ${stream.login === current?.login ? 'is-selected' : ''}`}
                aria-pressed={stream.login === current?.login}
                onClick={() => setSelected(stream.login)}
              >
                <span className="watch-rank">{i + 1}</span>
                {stream.thumbnail && <img src={stream.thumbnail} alt="" loading="lazy" />}
                <span className="watch-stream-text">
                  <strong>{stream.name}</strong>
                  <span className="muted">{stream.title}</span>
                </span>
                <span className="watch-viewers">{formatViewers(stream.viewers)}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
