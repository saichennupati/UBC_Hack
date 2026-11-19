import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSessionMarkets, impliedOdds, outcomePools, overUnderWinner, validateMarkets } from '../lib/markets.js';

test('accepts valid extra markets and rejects bad ones', () => {
  assert.equal(validateMarkets([]), null);
  assert.equal(validateMarkets([
    { kind: 'over_under', question: 'Deaths', line: 2.5 },
    { kind: 'multiple_choice', question: 'Ending', outcomes: ['Wasted', 'Busted'] },
  ]), null);

  for (const [market, message] of [
    [{ kind: 'parlay', question: 'x' }, 'unknown kind'],
    [{ kind: 'over_under', question: ' ', line: 2.5 }, 'question is required'],
    [{ kind: 'over_under', question: 'Deaths', line: 3 }, 'half number'],
    [{ kind: 'over_under', question: 'Deaths', line: -0.5 }, 'half number'],
    [{ kind: 'multiple_choice', question: 'Ending', outcomes: ['Only'] }, '2–6 outcomes'],
    [{ kind: 'multiple_choice', question: 'Ending', outcomes: ['A', ' '] }, 'blank'],
    [{ kind: 'multiple_choice', question: 'Ending', outcomes: ['Wasted', 'wasted'] }, 'different'],
  ]) {
    assert.match(validateMarkets([market]), new RegExp(message), JSON.stringify(market));
  }
  assert.match(validateMarkets(Array(11).fill({ kind: 'over_under', question: 'q', line: 0.5 })), /at most 10/);
});

test('builds a parlay market, one market per leg, then the extras, with Yes as outcome 0', () => {
  let n = 0;
  const { markets, outcomes } = buildSessionMarkets({
    sessionId: 's1',
    legs: [{ id: 'l1', label: 'Mission' }, { id: 'l2', label: 'Pursuit' }],
    extras: [
      { kind: 'over_under', question: ' Deaths ', line: 2.5 },
      { kind: 'multiple_choice', question: 'Ending', outcomes: ['Wasted', 'Busted', 'Timer'] },
    ],
    newId: () => `m${n++}`,
  });

  assert.deepEqual(markets.map((m) => [m.kind, m.position, m.leg_id]), [
    ['parlay', 0, null], ['leg', 1, 'l1'], ['leg', 2, 'l2'], ['over_under', 3, null], ['multiple_choice', 4, null],
  ]);
  assert.equal(markets[3].question, 'Deaths');
  assert.deepEqual(markets[3].params, { line: 2.5, current: 0 });
  const labels = (id) => outcomes.filter((o) => o.market_id === id).map((o) => [o.position, o.label]);
  assert.deepEqual(labels('m0'), [[0, 'Yes'], [1, 'No']]);
  assert.deepEqual(labels('m3'), [[0, 'Over 2.5'], [1, 'Under 2.5']]);
  assert.deepEqual(labels('m4'), [[0, 'Wasted'], [1, 'Busted'], [2, 'Timer']]);
});

test('over/under picks Over above the line and Under below it', () => {
  const market = { params: { line: 2.5 }, outcomes: [{ id: 'over', position: 0 }, { id: 'under', position: 1 }] };
  assert.equal(overUnderWinner(market, 3).id, 'over');
  assert.equal(overUnderWinner(market, 2).id, 'under');
  assert.equal(overUnderWinner(market, 0).id, 'under');
});

test('pools and implied odds come from slips per outcome', () => {
  const pools = outcomePools([
    { outcome_id: 'a', amount_wei: '3000000000000000000' },
    { outcome_id: 'b', amount_wei: '1000000000000000000' },
    { outcome_id: 'a', amount_wei: '0' },
    { outcome_id: null, side: true, amount_wei: '5000000000000000000' },
  ]);
  assert.deepEqual(pools, { a: 3, b: 1 });

  const market = { outcomes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.deepEqual(impliedOdds(market, pools), { a: 0.75, b: 0.25, c: 0 });
  assert.equal(impliedOdds(market, {}), null);
});
