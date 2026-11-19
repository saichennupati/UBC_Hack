import { createHmac, timingSafeEqual } from 'node:crypto';

// Requests older (or newer) than this are rejected, bounding the replay window.
// Replays inside the window are caught by the unique event_id in game_events.
export const MAX_SKEW_SECONDS = 60;

export function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifySignature({ secret, timestamp, signature, body, now = Date.now() }) {
  if (!secret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) return false;

  const expected = Buffer.from(sign(secret, timestamp, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
