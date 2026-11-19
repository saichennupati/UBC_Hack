'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LegList } from '@/components/LegList';
import { LEG_TYPES } from '@/lib/legs';
import { EXTRA_MARKET_KINDS } from '@/lib/markets';
import { getPublicClient } from '@/lib/supabase-browser';

const PASSWORD_KEY = 'chaosslip-admin-password';

function newLeg(type = 'mission_first_try') {
  return { type, label: LEG_TYPES[type] };
}

const NEW_MARKETS = {
  over_under: () => ({ kind: 'over_under', question: 'Deaths this session', line: '2.5' }),
  multiple_choice: () => ({
    kind: 'multiple_choice',
    question: 'How does the run end?',
    outcomes: 'Wasted, Busted, Timer runs out, Completes',
  }),
};

// datetime-local wants local time without a timezone suffix.
function localInputValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [sessions, setSessions] = useState([]);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(() => ({
    title: 'Heist night',
    streamer_name: '', game_name: '', stream_url: '', thumbnail_url: '', viewer_count: '',
    durationMinutes: 15,
    lockAt: localInputValue(new Date(Date.now() + 10 * 60_000)),
    legs: [newLeg('mission_first_try'), newLeg('survive_pursuit'), newLeg('reach_location')],
    markets: [NEW_MARKETS.over_under(), NEW_MARKETS.multiple_choice()],
  }));
  const [counts, setCounts] = useState({});

  useEffect(() => {
    try {
      setPassword(sessionStorage.getItem(PASSWORD_KEY) ?? '');
    } catch {}
  }, []);

  const loadSessions = useCallback(async () => {
    const { data, error } = await getPublicClient()
      .from('sessions')
      .select('*, legs(*), markets(*, outcomes!outcomes_market_id_fkey(*))')
      .order('created_at', { ascending: false })
      .order('position', { referencedTable: 'legs' })
      .order('position', { referencedTable: 'markets' })
      .order('position', { referencedTable: 'markets.outcomes' })
      .limit(10);
    if (error) setMessage({ error: error.message });
    else setSessions(data);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function call(path, body) {
    setMessage(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-password': password },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ error: json.error ?? `request failed (${res.status})` });
      return null;
    }
    await loadSessions();
    return json;
  }

  async function createSession(event) {
    event.preventDefault();
    const markets = form.markets.map((market) =>
      market.kind === 'over_under'
        ? { kind: market.kind, question: market.question, line: Number(market.line) }
        : {
            kind: market.kind,
            question: market.question,
            outcomes: market.outcomes.split(',').map((label) => label.trim()).filter(Boolean),
          },
    );
    const result = await call('/api/admin/sessions', {
      title: form.title,
      streamer_name: form.streamer_name, game_name: form.game_name,
      stream_url: form.stream_url, thumbnail_url: form.thumbnail_url,
      viewer_count: form.viewer_count === '' ? null : Number(form.viewer_count),
      durationMinutes: Number(form.durationMinutes),
      lockAt: new Date(form.lockAt).toISOString(),
      legs: form.legs,
      markets,
    });
    if (result) setMessage({ ok: `Created “${result.session.title}”` });
  }

  function updateLeg(index, patch) {
    setForm((f) => ({ ...f, legs: f.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) }));
  }

  function updateMarket(index, patch) {
    setForm((f) => ({ ...f, markets: f.markets.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));
  }

  return (
    <main className="page stack">
      <Link href="/" className="brand">
        ChaosSlip admin
      </Link>

      <section className="card">
        <label className="field">
          <span className="label">Admin password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              try {
                sessionStorage.setItem(PASSWORD_KEY, e.target.value);
              } catch {}
            }}
          />
        </label>
      </section>

      {message?.error && <p className="error">{message.error}</p>}
      {message?.ok && <p className="muted">{message.ok}</p>}

      <form className="card stack" onSubmit={createSession}>
        <h2>New session</h2>
        <div className="row">
          <label className="field">
            <span className="label">Title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </label>
          <label className="field">
            <span className="label">Duration (min)</span>
            <input
              type="number"
              min="1"
              max="180"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span className="label">Betting closes</span>
            <input
              type="datetime-local"
              value={form.lockAt}
              onChange={(e) => setForm({ ...form, lockAt: e.target.value })}
              required
            />
          </label>
        </div>

        <details className="card stack">
          <summary>Stream discovery settings (optional)</summary>
          <p className="muted">Add a Twitch channel or YouTube video to the featured preview. Viewer counts are host-provided snapshots. Requires migration 004.</p>
          <div className="stack">
            {[["streamer_name", "Streamer name"], ["game_name", "Game"], ["stream_url", "Twitch channel / YouTube video URL"], ["thumbnail_url", "Thumbnail image URL"], ["viewer_count", "Viewer count snapshot"]].map(([key, label]) => <label className="field" key={key}>
              <span>{label}</span><input type={key === 'viewer_count' ? 'number' : key.endsWith('url') ? 'url' : 'text'} min={key === 'viewer_count' ? 0 : undefined} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
            </label>)}
          </div>
        </details>

        {form.legs.map((leg, i) => (
          <div key={i} className="card stack">
            <div className="row">
              <label className="field">
                <span className="label">Leg {i + 1}</span>
                <select
                  value={leg.type}
                  onChange={(e) => updateLeg(i, { type: e.target.value, label: LEG_TYPES[e.target.value] })}
                >
                  {Object.entries(LEG_TYPES).map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Label shown to viewers</span>
                <input value={leg.label} onChange={(e) => updateLeg(i, { label: e.target.value })} required />
              </label>
            </div>
            {form.legs.length > 1 && (
              <div>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setForm((f) => ({ ...f, legs: f.legs.filter((_, j) => j !== i) }))}
                >
                  Remove leg
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="row">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setForm((f) => ({ ...f, legs: [...f.legs, newLeg()] }))}
          >
            Add leg
          </button>
        </div>

        <h2>Extra markets</h2>
        <p className="muted">
          A parlay market and one market per leg are created automatically. Add side bets here.
        </p>
        {form.markets.map((market, i) => (
          <div key={i} className="card stack">
            <div className="row">
              <label className="field">
                <span className="label">{EXTRA_MARKET_KINDS[market.kind]} question</span>
                <input value={market.question} onChange={(e) => updateMarket(i, { question: e.target.value })} required />
              </label>
              {market.kind === 'over_under' ? (
                <label className="field">
                  <span className="label">Line (use .5)</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={market.line}
                    onChange={(e) => updateMarket(i, { line: e.target.value })}
                    required
                  />
                </label>
              ) : (
                <label className="field">
                  <span className="label">Outcomes, comma-separated</span>
                  <input value={market.outcomes} onChange={(e) => updateMarket(i, { outcomes: e.target.value })} required />
                </label>
              )}
            </div>
            <div>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setForm((f) => ({ ...f, markets: f.markets.filter((_, j) => j !== i) }))}
              >
                Remove market
              </button>
            </div>
          </div>
        ))}

        <div className="row">
          {Object.entries(EXTRA_MARKET_KINDS).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              className="button button-quiet"
              onClick={() => setForm((f) => ({ ...f, markets: [...f.markets, NEW_MARKETS[kind]()] }))}
            >
              Add {label.toLowerCase()}
            </button>
          ))}
          <button type="submit" className="button">
            Create session
          </button>
        </div>
      </form>

      <section className="stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Recent sessions</h2>
          <button type="button" className="button button-quiet" onClick={loadSessions}>
            Refresh
          </button>
        </div>
        {sessions.map((session) => {
          const active = session.legs.find((leg) => leg.status === 'active');
          return (
            <div key={session.id} className="card stack">
              <div className="session-link">
                <strong>{session.title}</strong>
                <span className={`badge badge-${session.status}`}>{session.status}</span>
              </div>
              <LegList legs={session.legs} />
              <div className="row">
                <Link className="button button-quiet" href={`/s/${session.id}`}>
                  Viewer page
                </Link>
                <Link className="button button-quiet" href={`/overlay/${session.id}`}>
                  Overlay
                </Link>
                {session.status === 'open' && (
                  <button className="button" onClick={() => call(`/api/admin/sessions/${session.id}/start`)}>
                    Start session
                  </button>
                )}
                {active && (
                  <>
                    <button
                      className="button button-good"
                      onClick={() => call(`/api/admin/legs/${active.id}`, { outcome: 'done' })}
                    >
                      Mark leg done
                    </button>
                    <button
                      className="button button-bad"
                      onClick={() => call(`/api/admin/legs/${active.id}`, { outcome: 'failed' })}
                    >
                      Mark leg failed
                    </button>
                  </>
                )}
              </div>
              {session.markets
                .filter((market) => market.kind === 'over_under' || market.kind === 'multiple_choice')
                .map((market) => {
                  const settled = market.status === 'resolved' || market.status === 'void';
                  const winner = market.outcomes.find((outcome) => outcome.id === market.winning_outcome_id);
                  const count = counts[market.id] ?? String(market.params.current ?? 0);
                  return (
                    <div key={market.id} className="market stack">
                      <div className="market-head">
                        <span className="market-question">{market.question}</span>
                        <span className="market-status">
                          {market.status === 'resolved' ? `won: ${winner?.label}` : market.status}
                        </span>
                      </div>
                      {!settled && (
                        <div className="row">
                          {market.kind === 'over_under' ? (
                            <>
                              <label className="field">
                                <span className="label">Count (line {market.params.line})</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={count}
                                  onChange={(e) => setCounts({ ...counts, [market.id]: e.target.value })}
                                />
                              </label>
                              <button
                                className="button button-quiet"
                                onClick={() => call(`/api/admin/markets/${market.id}/count`, { current: Number(count) })}
                              >
                                Update overlay
                              </button>
                              <button
                                className="button"
                                disabled={market.status === 'open'}
                                onClick={() => call(`/api/admin/markets/${market.id}/resolve`, { count: Number(count) })}
                              >
                                Settle with this count
                              </button>
                            </>
                          ) : (
                            market.outcomes.map((outcome) => (
                              <button
                                key={outcome.id}
                                className="button"
                                disabled={market.status === 'open'}
                                onClick={() => call(`/api/admin/markets/${market.id}/resolve`, { outcomeId: outcome.id })}
                              >
                                {outcome.label} wins
                              </button>
                            ))
                          )}
                          <button
                            className="button button-bad"
                            onClick={() => call(`/api/admin/markets/${market.id}/void`)}
                          >
                            Void
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              <code className="muted">session {session.id}</code>
            </div>
          );
        })}
      </section>
    </main>
  );
}
