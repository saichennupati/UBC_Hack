'use client';

import { LegList } from '@/components/LegList';
import { formatClock, useCountdown, useExpireWhenDone, useLiveSession } from '@/lib/use-live-session';

const HEADLINES = { open: 'Bets open', live: 'Live', won: 'PARLAY HIT', lost: 'BUSTED' };

// One compact line per host market, e.g. "Deaths · 1 so far (o/u 2.5)".
function sideMarketLine(market) {
  const winner = market.outcomes.find((outcome) => outcome.id === market.winning_outcome_id);
  if (market.status === 'void') return `${market.question} · void`;
  if (winner) return `${market.question} · ${winner.label}`;
  if (market.kind === 'over_under') return `${market.question} · ${market.params.current ?? 0} so far (o/u ${market.params.line})`;
  return market.question;
}

export function Overlay({ id }) {
  const { session, legs, markets, error } = useLiveSession(id);
  const lockRemaining = useCountdown(session?.status === 'open' ? session.lock_at : null);
  const runRemaining = useCountdown(session?.status === 'live' ? session.ends_at : null);
  useExpireWhenDone(session, runRemaining);

  if (error || !session) return null;

  const clock = session.status === 'live' ? runRemaining : lockRemaining;
  const sideMarkets = markets.filter((market) => market.kind === 'over_under' || market.kind === 'multiple_choice');

  return (
    <div className={`overlay overlay-${session.status}`}>
      <div className="overlay-top">
        <span className="overlay-brand">ChaosSlip</span>
        <span className="overlay-headline">{HEADLINES[session.status]}</span>
        {clock != null && <span className="overlay-clock">{formatClock(clock)}</span>}
      </div>
      <div className="overlay-title">{session.title}</div>
      <LegList legs={legs} />
      {sideMarkets.length > 0 && (
        <ul className="overlay-markets">
          {sideMarkets.map((market) => (
            <li key={market.id}>{sideMarketLine(market)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
