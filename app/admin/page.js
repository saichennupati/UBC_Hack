'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LegList } from '@/components/LegList';
import { LEG_TYPES } from '@/lib/legs';
import { getPublicClient } from '@/lib/supabase-browser';

const PASSWORD_KEY = 'chaosslip-admin-password';

function newLeg(type = 'mission_first_try') {
  return { type, label: LEG_TYPES[type], params: {} };
}

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
    durationMinutes: 15,
    lockAt: localInputValue(new Date(Date.now() + 10 * 60_000)),
    legs: [newLeg('mission_first_try'), newLeg('survive_pursuit'), newLeg('reach_location')],
  }));

  useEffect(() => {
    try {
      setPassword(sessionStorage.getItem(PASSWORD_KEY) ?? '');
    } catch {}
  }, []);

  const loadSessions = useCallback(async () => {
    const { data, error } = await getPublicClient()
      .from('sessions')
      .select('*, legs(*)')
      .order('created_at', { ascending: false })
      .order('position', { referencedTable: 'legs' })
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
    const legs = form.legs.map((leg) =>
      leg.type === 'reach_location'
        ? {
            ...leg,
            params: Object.fromEntries(
              ['x', 'y', 'z', 'radius'].map((key) => [key, Number(leg.params[key])]),
            ),
          }
        : { ...leg, params: {} },
    );
    const result = await call('/api/admin/sessions', {
      title: form.title,
      durationMinutes: Number(form.durationMinutes),
      lockAt: new Date(form.lockAt).toISOString(),
      legs,
    });
    if (result) setMessage({ ok: `Created “${result.session.title}”` });
  }

  function updateLeg(index, patch) {
    setForm((f) => ({ ...f, legs: f.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) }));
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
            {leg.type === 'reach_location' && (
              <div className="row">
                {['x', 'y', 'z', 'radius'].map((key) => (
                  <label key={key} className="field">
                    <span className="label">{key}</span>
                    <input
                      type="number"
                      step="any"
                      value={leg.params[key] ?? ''}
                      onChange={(e) => updateLeg(i, { params: { ...leg.params, [key]: e.target.value } })}
                      required
                    />
                  </label>
                ))}
              </div>
            )}
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
              <code className="muted">session {session.id}</code>
            </div>
          );
        })}
      </section>
    </main>
  );
}
