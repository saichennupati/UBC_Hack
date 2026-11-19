import { verifySignature } from '@/lib/hmac';
import { rpcErrorResponse } from '@/lib/legs';
import { getServiceClient } from '@/lib/supabase-server';

// Receives leg results from the GTA V mod.
// Headers: X-Timestamp (unix seconds), X-Signature (hex HMAC-SHA256 of `${timestamp}.${body}`).
// Body: { event_id, session_id, leg_id, outcome: 'done' | 'failed', detail? }
export async function POST(request) {
  const body = await request.text();
  const valid = verifySignature({
    secret: process.env.MOD_SHARED_SECRET,
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
  const { event_id, session_id, leg_id, outcome } = event;
  if (typeof event_id !== 'string' || !event_id || !session_id || !leg_id) {
    return Response.json({ error: 'event_id, session_id and leg_id are required' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error: logError } = await supabase
    .from('game_events')
    .insert({ event_id, session_id, leg_id, outcome, payload: event });
  if (logError?.code === '23505') return Response.json({ duplicate: true });
  if (logError) {
    console.error(logError);
    return Response.json({ error: 'could not record event' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('apply_leg_outcome', {
    p_leg_id: leg_id,
    p_outcome: outcome,
  });
  if (error) return rpcErrorResponse(error);
  return Response.json({ session: data });
}
