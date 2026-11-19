import { impliedOdds } from '@/lib/markets';

const STATUS_LABELS = { open: 'open', locked: 'live', resolved: 'settled', void: 'void — refunded' };

export function MarketList({ markets, pools }) {
  return (
    <ul className="markets">
      {markets.map((market) => {
        const odds = impliedOdds(market, pools);
        return (
          <li key={market.id} className={`market market-${market.status}`}>
            <div className="market-head">
              <span className="market-question">
                {market.question}
                {market.kind === 'over_under' && market.status !== 'resolved' && (
                  <span className="muted"> · {market.params.current ?? 0} so far</span>
                )}
              </span>
              <span className="market-status">{STATUS_LABELS[market.status]}</span>
            </div>
            <ul className="market-outcomes">
              {market.outcomes.map((outcome) => (
                <li key={outcome.id} className={outcome.id === market.winning_outcome_id ? 'outcome-won' : undefined}>
                  <span>{outcome.label}</span>
                  <span className="muted">{(pools[outcome.id] ?? 0).toFixed(3)} ETH</span>
                  <span className="outcome-odds">{odds ? `${Math.round(odds[outcome.id] * 100)}%` : '—'}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
