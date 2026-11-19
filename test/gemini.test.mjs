import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GEMINI_EVENTS_URL, listEvents } from '../lib/gemini.js';

const liveShapedEvent = {
  id: '475183',
  ticker: 'NCAAM-TAMU-TCU',
  title: 'Texas A&M vs TCU',
  category: 'Sports',
  expiryDate: '2026-11-22T01:00:00.000Z',
  volume: '915.29',
  contracts: [
    { label: 'Texas A&M', marketState: 'open', prices: { buy: { yes: '0.5', no: '0.51' }, lastTradePrice: '0.51' } },
    { label: 'TCU', marketState: 'closed', prices: { buy: { yes: null } } },
  ],
};

test('queries active events by search text and trims them for the UI', async () => {
  let requested;
  const events = await listEvents({
    search: 'GTA',
    limit: 3,
    fetchImpl: async (url) => {
      requested = url;
      return Response.json({ data: [liveShapedEvent], pagination: { total: 1 } });
    },
  });

  assert.equal(requested.origin + requested.pathname, GEMINI_EVENTS_URL);
  assert.equal(requested.searchParams.get('status'), 'active');
  assert.equal(requested.searchParams.get('search'), 'GTA');
  assert.equal(requested.searchParams.get('limit'), '3');
  assert.deepEqual(events, [{
    ticker: 'NCAAM-TAMU-TCU',
    title: 'Texas A&M vs TCU',
    category: 'Sports',
    expiryDate: '2026-11-22T01:00:00.000Z',
    contracts: [
      { label: 'Texas A&M', yesPercent: 50, lastTradePercent: 51, open: true },
      { label: 'TCU', yesPercent: null, lastTradePercent: null, open: false },
    ],
  }]);
});

test('returns an empty list for HTTP errors, bad bodies and network failures', async () => {
  for (const fetchImpl of [
    async () => new Response('down', { status: 503 }),
    async () => Response.json({ unexpected: true }),
    async () => new Response('not json'),
    async () => { throw new TypeError('fetch failed'); },
  ]) {
    assert.deepEqual(await listEvents({ search: 'GTA', fetchImpl }), []);
  }
});
