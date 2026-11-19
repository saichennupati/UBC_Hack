// Sends a signed game event for a session's active leg, exactly as the GTA mod will.
// Usage: npm run sim -- <session_id> <done|failed>
import { randomUUID } from 'node:crypto';
import { sign } from '../lib/hmac.js';

const [sessionId, outcome = 'done'] = process.argv.slice(2);
if (!sessionId || !['done', 'failed'].includes(outcome)) {
  console.error('Usage: npm run sim -- <session_id> <done|failed>');
  process.exit(1);
}

const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, MOD_SHARED_SECRET } = process.env;
const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
if (!MOD_SHARED_SECRET) {
  console.error('MOD_SHARED_SECRET is not set in .env.local');
  process.exit(1);
}

const legsRes = await fetch(
  `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/legs?session_id=eq.${sessionId}&status=eq.active&select=id,label`,
  { headers: { apikey: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } },
);
const [leg] = await legsRes.json();
if (!leg) {
  console.error('No active leg — is the session started and still live?');
  process.exit(1);
}

const body = JSON.stringify({
  event_id: randomUUID(),
  session_id: sessionId,
  leg_id: leg.id,
  outcome,
  detail: 'simulated',
});
const timestamp = String(Math.floor(Date.now() / 1000));

const res = await fetch(`${appUrl}/api/game-events`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-timestamp': timestamp,
    'x-signature': sign(MOD_SHARED_SECRET, timestamp, body),
  },
  body,
});
console.log(`${leg.label} → ${outcome}: ${res.status}`, await res.json());
