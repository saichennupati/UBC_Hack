import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { rpcErrorResponse } from '@/lib/legs';
import { getServiceClient } from '@/lib/supabase-server';

// Cancels a market so its bets can be refunded.
export async function POST(request, { params }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;

  const { data, error } = await getServiceClient().rpc('void_market', { p_market_id: id });
  if (error) return rpcErrorResponse(error);
  return Response.json({ market: data });
}
