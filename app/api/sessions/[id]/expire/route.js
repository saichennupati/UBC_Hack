import { rpcErrorResponse } from '@/lib/legs';
import { getServiceClient } from '@/lib/supabase-server';

// Called by viewer and overlay pages when the countdown hits zero.
// Unauthenticated on purpose: expire_session is a no-op until the timer has really run out.
export async function POST(_request, { params }) {
  const { id } = await params;

  const { data, error } = await getServiceClient().rpc('expire_session', { p_session_id: id });
  if (error) return rpcErrorResponse(error);
  return Response.json({ session: data });
}
