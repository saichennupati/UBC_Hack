'use client';

import { LegList } from '@/components/LegList';
import { BettingAccess } from '@/components/BettingAccess';
import {
  formatClock,
  poolTotals,
  useCountdown,
  useExpireWhenDone,
  useLiveSession,
} from '@/lib/use-live-session';

export function SessionView({ id }) {
  const { session, legs, slips, error, loading } = useLiveSession(id);
  const lockRemaining = useCountdown(session?.status === 'open' ? session.lock_at : null);
  const runRemaining = useCountdown(session?.status === 'live' ? session.ends_at : null);
  useExpireWhenDone(session, runRemaining);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error">{error}</p>;

  const pools = poolTotals(slips);
  const bettingOpen = session.status === 'open' && lockRemaining > 0;
  const done = legs.filter((leg) => leg.status === 'done').length;

  return (
    <div className="stack">
      <header className="session-header">
        <span className={`badge badge-${session.status}`}>{session.status}</span>
        <h1>{session.title}</h1>
      </header>

      <section className="card clock-card">
        {session.status === 'open' && (
          <>
            <div className="label">{bettingOpen ? 'Betting closes in' : 'Betting closed — starting soon'}</div>
            <div className="clock">{formatClock(lockRemaining)}</div>
          </>
        )}
        {session.status === 'live' && (
          <>
            <div className="label">Time left</div>
            <div className="clock">{formatClock(runRemaining)}</div>
          </>
        )}
        {session.status === 'won' && <div className="result result-won">Parlay hit 🎉</div>}
        {session.status === 'lost' && <div className="result result-lost">Parlay busted</div>}
        <div className="muted">
          {done} / {legs.length} objectives complete
        </div>
      </section>

      <section className="card">
        <h2>The slip</h2>
        <LegList legs={legs} />
      </section>

      <section className="card">
        <h2>Pool</h2>
        <div className="pools">
          <div>
            <div className="label">Completes</div>
            <div className="pool">{pools.yes.toFixed(4)} ETH</div>
          </div>
          <div>
            <div className="label">Fails</div>
            <div className="pool">{pools.no.toFixed(4)} ETH</div>
          </div>
        </div>
        <BettingAccess bettingOpen={bettingOpen} />
      </section>
    </div>
  );
}
