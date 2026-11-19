import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { rpcErrorResponse } from '@/lib/legs';
import { getServiceClient } from '@/lib/supabase-server';

// Manual override: lets the host resolve a leg when the mod misses it,
// and doubles as an event simulator for demos without the game running.
export async function POST(request, { params }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;
  const { outcome } = (await request.json().catch(() => null)) ?? {};

  const { data, error } = await getServiceClient().rpc('apply_leg_outcome', {
    p_leg_id: id,
    p_outcome: outcome,
  });
  if (error) return rpcErrorResponse(error);
  return Response.json({ session: data });
}
