'use client';

import { LegList } from '@/components/LegList';
import {
  formatClock,
  poolTotals,
  useCountdown,
  useExpireWhenDone,
  useLiveSession,
} from '@/lib/use-live-session';

const HEADLINES = { open: 'Bets open', live: 'Live', won: 'PARLAY HIT', lost: 'BUSTED' };

export function Overlay({ id }) {
  const { session, legs, slips, error } = useLiveSession(id);
  const lockRemaining = useCountdown(session?.status === 'open' ? session.lock_at : null);
  const runRemaining = useCountdown(session?.status === 'live' ? session.ends_at : null);
  useExpireWhenDone(session, runRemaining);

  if (error || !session) return null;

  const pools = poolTotals(slips);
  const clock = session.status === 'live' ? runRemaining : lockRemaining;

  return (
    <div className={`overlay overlay-${session.status}`}>
      <div className="overlay-top">
        <span className="overlay-brand">ChaosSlip</span>
        <span className="overlay-headline">{HEADLINES[session.status]}</span>
        {clock != null && <span className="overlay-clock">{formatClock(clock)}</span>}
      </div>
      <div className="overlay-title">{session.title}</div>
      <LegList legs={legs} />
      <div className="overlay-pools">
        <span>✓ {pools.yes.toFixed(3)} ETH</span>
        <span>✗ {pools.no.toFixed(3)} ETH</span>
      </div>
    </div>
  );
}
