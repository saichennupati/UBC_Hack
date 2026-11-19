import { verifySignature } from './hmac.js';
import { rpcErrorResponse } from './legs.js';

// Receives leg results from the GTA V mod.
// Headers: X-Timestamp (unix seconds), X-Signature (hex HMAC-SHA256 of `${timestamp}.${body}`).
// Body: { event_id, session_id, leg_id, outcome: 'done' | 'failed', detail? }
export async function handleGameEvent(request, { secret, getClient }) {
  const body = await request.text();
  const valid = verifySignature({
    secret,
    timestamp: request.headers.get('x-timestamp'),
    signature: request.headers.get('x-signature'),
    body,
  });
  if (!valid) return Response.json({ error: 'bad signature' }, { status: 401 });

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || typeof event.event_id !== 'string' || !event.event_id.trim()
    || typeof event.session_id !== 'string' || !uuid.test(event.session_id)
    || typeof event.leg_id !== 'string' || !uuid.test(event.leg_id)
    || !['done', 'failed'].includes(event.outcome)) {
    return Response.json({ error: 'valid event_id, session_id, leg_id and outcome are required' }, { status: 400 });
  }
  const { data, error } = await getClient().rpc('process_game_event', {
    p_event_id: event.event_id,
    p_session_id: event.session_id,
    p_leg_id: event.leg_id,
    p_outcome: event.outcome,
    p_payload: event,
  });
  if (error) return rpcErrorResponse(error);
  return Response.json(data);
}
