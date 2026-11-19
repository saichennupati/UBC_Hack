import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { rpcErrorResponse } from '@/lib/legs';
import { overUnderWinner } from '@/lib/markets';
import { getServiceClient } from '@/lib/supabase-server';

// Settles a host-resolved market. Body: { outcomeId } for multiple choice, { count } for over/under.
export async function POST(request, { params }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;
  const { outcomeId, count } = (await request.json().catch(() => null)) ?? {};

  const supabase = getServiceClient();
  let winnerId = outcomeId;

  if (count !== undefined) {
    if (!Number.isInteger(count) || count < 0) {
      return Response.json({ error: 'count must be a whole number' }, { status: 400 });
    }
    const { data: market, error } = await supabase
      .from('markets')
      .select('kind, params, outcomes!outcomes_market_id_fkey(id, position)')
      .eq('id', id)
      .maybeSingle();
    if (error) return rpcErrorResponse(error);
    if (!market) return Response.json({ error: 'market not found' }, { status: 404 });
    if (market.kind !== 'over_under') {
      return Response.json({ error: 'only over/under markets take a count' }, { status: 400 });
    }
    winnerId = overUnderWinner(market, count).id;
  }

  if (typeof winnerId !== 'string') return Response.json({ error: 'outcomeId or count is required' }, { status: 400 });

  const { data, error } = await supabase.rpc('resolve_market', { p_market_id: id, p_outcome_id: winnerId });
  if (error) return rpcErrorResponse(error);
  if (count !== undefined) {
    await supabase.from('markets').update({ params: { ...data.params, current: count, final: count } }).eq('id', id);
  }
  return Response.json({ market: data });
}
