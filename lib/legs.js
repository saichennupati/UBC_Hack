// GTA VI objectives. The host resolves them from the admin panel; the label says what counts.
export const LEG_TYPES = {
  mission_first_try: 'Complete the mission on the first attempt',
  survive_pursuit: 'Survive the next police pursuit',
  reach_location: 'Reach the location before time runs out',
  wasted_free: "Don't get wasted",
  custom: 'Custom objective',
};

// Validates admin input for a new session's legs; returns an error string or null.
export function validateLegs(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return 'add at least one leg';
  if (legs.length > 10) return 'at most 10 legs';

  for (const [i, leg] of legs.entries()) {
    if (!(leg.type in LEG_TYPES)) return `leg ${i + 1}: unknown type`;
    if (typeof leg.label !== 'string' || !leg.label.trim()) return `leg ${i + 1}: label is required`;
  }
  return null;
}

// Maps errors raised by the SQL functions to HTTP responses.
export function rpcErrorResponse(error) {
  const conflict = ['session already started', 'session is not live', 'leg is not active', 'session has no legs', 'event ID already used with different payload', 'legacy event requires manual review', 'market is still open', 'market already settled', 'market resolves automatically'];
  if (conflict.includes(error.message)) return Response.json({ error: error.message }, { status: 409 });
  if (error.message.endsWith('not found')) return Response.json({ error: error.message }, { status: 404 });
  if (['invalid outcome', 'invalid event', 'leg does not belong to session', 'outcome does not belong to market'].includes(error.message)) return Response.json({ error: error.message }, { status: 400 });
  console.error(error);
  return Response.json({ error: 'internal error' }, { status: 500 });
}
