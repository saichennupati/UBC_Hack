import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleGameEvent } from '../lib/game-events.js';
import { sign } from '../lib/hmac.js';

const secret = 'test-secret';
const event = {
  event_id: 'delivery-1',
  session_id: '00000000-0000-4000-8000-000000000001',
  leg_id: '00000000-0000-4000-8000-000000000002',
  outcome: 'done',
};
function request(value, { raw = false, signed = true } = {}) {
  const body = raw ? value : JSON.stringify(value);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request('http://localhost/api/game-events', {
    method: 'POST', body,
    headers: { 'x-timestamp': timestamp, 'x-signature': signed ? sign(secret, timestamp, body) : 'bad' },
  });
}
const noDatabase = () => { throw new Error('Invalid requests must not access the database'); };

test('rejects unsigned requests before accessing the database', async () => {
  const response = await handleGameEvent(request(event, { signed: false }), { secret, getClient: noDatabase });
  assert.equal(response.status, 401);
});

test('rejects malformed JSON and invalid event shapes without database access', async () => {
  for (const body of ['{', 'null', '[]', '42', '{}', JSON.stringify({ ...event, outcome: 'win' }),
    JSON.stringify({ ...event, session_id: 'not-a-uuid' }), JSON.stringify({ ...event, leg_id: null }),
    JSON.stringify({ ...event, event_id: ' ' })]) {
    const response = await handleGameEvent(request(body, { raw: true }), { secret, getClient: noDatabase });
    assert.equal(response.status, 400, body);
  }
});

test('sends one atomic RPC and returns its receipt for original and duplicate deliveries', async () => {
  for (const duplicate of [false, true]) {
    let calls = 0;
    const receipt = { duplicate, session: { id: event.session_id, status: 'won' } };
    const response = await handleGameEvent(request(event), { secret, getClient: () => ({
      async rpc(name, params) {
        calls++;
        assert.equal(name, 'process_game_event');
        assert.deepEqual(params, { p_event_id: event.event_id, p_session_id: event.session_id,
          p_leg_id: event.leg_id, p_outcome: event.outcome, p_payload: event });
        return { data: receipt, error: null };
      },
    }) });
    assert.equal(calls, 1);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), receipt);
  }
});

test('maps database validation and state errors to appropriate HTTP responses', async () => {
  for (const [message, status] of [
    ['leg does not belong to session', 400], ['invalid outcome', 400],
    ['session not found', 404], ['leg not found', 404],
    ['session is not live', 409], ['leg is not active', 409],
    ['event ID already used with different payload', 409], ['legacy event requires manual review', 409],
  ]) {
    const response = await handleGameEvent(request(event), { secret,
      getClient: () => ({ rpc: async () => ({ error: { message } }) }),
    });
    assert.equal(response.status, status, message);
    assert.deepEqual(await response.json(), { error: message });
  }
});
