export const LEG_TYPES = {
  mission_first_try: 'Complete the mission on the first attempt',
  survive_pursuit: 'Survive the next police pursuit',
  reach_location: 'Reach the location before time runs out',
};

// Validates admin input for a new session's legs; returns an error string or null.
export function validateLegs(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return 'add at least one leg';
  if (legs.length > 10) return 'at most 10 legs';

  for (const [i, leg] of legs.entries()) {
    if (!(leg.type in LEG_TYPES)) return `leg ${i + 1}: unknown type`;
    if (typeof leg.label !== 'string' || !leg.label.trim()) return `leg ${i + 1}: label is required`;
    if (leg.type === 'reach_location') {
      const { x, y, z, radius } = leg.params ?? {};
      if (![x, y, z, radius].every(Number.isFinite)) return `leg ${i + 1}: x, y, z and radius must be numbers`;
      if (radius <= 0) return `leg ${i + 1}: radius must be positive`;
    }
  }
  return null;
}

// Maps errors raised by the SQL functions to HTTP responses.
export function rpcErrorResponse(error) {
  const conflict = ['session already started', 'session is not live', 'leg is not active', 'session has no legs'];
  if (conflict.includes(error.message)) return Response.json({ error: error.message }, { status: 409 });
  if (error.message.endsWith('not found')) return Response.json({ error: error.message }, { status: 404 });
  if (error.message === 'invalid outcome') return Response.json({ error: error.message }, { status: 400 });
  console.error(error);
  return Response.json({ error: 'internal error' }, { status: 500 });
}
