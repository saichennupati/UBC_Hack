import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';

// Updates the running count shown on the overlay for an over/under market. Body: { current }.
export async function POST(request, { params }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;
  const { current } = (await request.json().catch(() => null)) ?? {};
  if (!Number.isInteger(current) || current < 0) {
    return Response.json({ error: 'current must be a whole number' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: market, error } = await supabase.from('markets').select('kind, status, params').eq('id', id).maybeSingle();
  if (error) {
    console.error(error);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
  if (!market) return Response.json({ error: 'market not found' }, { status: 404 });
  if (market.kind !== 'over_under') return Response.json({ error: 'only over/under markets have a count' }, { status: 400 });
  if (market.status === 'resolved' || market.status === 'void') {
    return Response.json({ error: 'market already settled' }, { status: 409 });
  }

  const { data, error: updateError } = await supabase
    .from('markets')
    .update({ params: { ...market.params, current } })
    .eq('id', id)
    .select()
    .single();
  if (updateError) {
    console.error(updateError);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
  return Response.json({ market: data });
}
