import 'server-only';
import { timingSafeEqual } from 'node:crypto';

export function isAdmin(request) {
  const expected = process.env.ADMIN_PASSWORD;
  const given = request.headers.get('x-admin-password');
  if (!expected || !given) return false;

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
