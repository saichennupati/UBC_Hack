import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { rpcErrorResponse } from '@/lib/legs';
import { getServiceClient } from '@/lib/supabase-server';

export async function POST(request, { params }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;

  const { data, error } = await getServiceClient().rpc('start_session', { p_session_id: id });
  if (error) return rpcErrorResponse(error);
  return Response.json({ session: data });
}
