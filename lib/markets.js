// Market kinds the host can add on top of the automatic parlay and per-leg markets.
export const EXTRA_MARKET_KINDS = {
  over_under: 'Over / under',
  multiple_choice: 'Multiple choice',
};

const YES_NO = ['Yes', 'No'];

// Validates admin input for extra markets; returns an error string or null.
export function validateMarkets(markets = []) {
  if (!Array.isArray(markets)) return 'markets must be a list';
  if (markets.length > 10) return 'at most 10 extra markets';

  for (const [i, market] of markets.entries()) {
    const where = `market ${i + 1}`;
    if (!(market?.kind in EXTRA_MARKET_KINDS)) return `${where}: unknown kind`;
    if (typeof market.question !== 'string' || !market.question.trim()) return `${where}: question is required`;
    if (market.kind === 'over_under') {
      const line = market.line;
      // A half-point line means the count can never land exactly on it.
      if (!Number.isFinite(line) || line < 0 || line % 1 === 0) return `${where}: line must be a half number like 2.5`;
    }
    if (market.kind === 'multiple_choice') {
      const labels = market.outcomes;
      if (!Array.isArray(labels) || labels.length < 2 || labels.length > 6) return `${where}: give 2–6 outcomes`;
      if (labels.some((label) => typeof label !== 'string' || !label.trim())) return `${where}: outcomes cannot be blank`;
      if (new Set(labels.map((label) => label.trim().toLowerCase())).size !== labels.length) {
        return `${where}: outcomes must be different`;
      }
    }
  }
  return null;
}

// Builds market and outcome rows for a new session: one parlay market, one market per
// leg, then the host's extra markets. `legs` are inserted rows (with id and label).
export function buildSessionMarkets({ sessionId, legs, extras = [], newId = () => crypto.randomUUID() }) {
  const markets = [];
  const outcomes = [];

  function add(market, labels) {
    const id = newId();
    markets.push({ id, session_id: sessionId, position: markets.length, leg_id: null, params: {}, ...market });
    labels.forEach((label, position) => outcomes.push({ market_id: id, position, label: label.trim() }));
  }

  add({ kind: 'parlay', question: 'Does the streamer complete every objective?' }, YES_NO);
  for (const leg of legs) add({ kind: 'leg', question: leg.label, leg_id: leg.id }, YES_NO);
  for (const extra of extras) {
    if (extra.kind === 'over_under') {
      add({ kind: 'over_under', question: extra.question.trim(), params: { line: extra.line, current: 0 } }, [
        `Over ${extra.line}`,
        `Under ${extra.line}`,
      ]);
    } else {
      add({ kind: 'multiple_choice', question: extra.question.trim() }, extra.outcomes);
    }
  }
  return { markets, outcomes };
}

// Picks the winning over/under outcome for a final count. Over is position 0.
export function overUnderWinner(market, count) {
  const position = count > market.params.line ? 0 : 1;
  return market.outcomes.find((outcome) => outcome.position === position);
}

// Sums wei staked per outcome, in ETH, from slip rows.
export function outcomePools(slips) {
  const pools = {};
  for (const slip of slips) {
    if (!slip.outcome_id) continue;
    pools[slip.outcome_id] = (pools[slip.outcome_id] ?? 0) + Number(slip.amount_wei) / 1e18;
  }
  return pools;
}

// Parimutuel implied probability: an outcome's share of its market's pool, or null when empty.
export function impliedOdds(market, pools) {
  const total = market.outcomes.reduce((sum, outcome) => sum + (pools[outcome.id] ?? 0), 0);
  if (total === 0) return null;
  return Object.fromEntries(market.outcomes.map((outcome) => [outcome.id, (pools[outcome.id] ?? 0) / total]));
}
