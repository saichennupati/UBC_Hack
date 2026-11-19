import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { validateLegs } from '@/lib/legs';
import { getServiceClient } from '@/lib/supabase-server';

export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'invalid JSON' }, { status: 400 });

  const { title, durationMinutes, lockAt, legs } = body;
  if (typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 180) {
    return Response.json({ error: 'duration must be 1–180 minutes' }, { status: 400 });
  }
  const lockTime = new Date(lockAt);
  if (Number.isNaN(lockTime.getTime())) {
    return Response.json({ error: 'lock time is invalid' }, { status: 400 });
  }
  const legError = validateLegs(legs);
  if (legError) return Response.json({ error: legError }, { status: 400 });

  const supabase = getServiceClient();
  const { data: session, error } = await supabase
    .from('sessions')
    .insert({
      title: title.trim(),
      duration_seconds: Math.round(durationMinutes * 60),
      lock_at: lockTime.toISOString(),
    })
    .select()
    .single();
  if (error) {
    console.error(error);
    return Response.json({ error: 'could not create session' }, { status: 500 });
  }

  const { error: legsError } = await supabase.from('legs').insert(
    legs.map((leg, position) => ({
      session_id: session.id,
      position,
      type: leg.type,
      label: leg.label.trim(),
      params: leg.params ?? {},
    })),
  );
  if (legsError) {
    console.error(legsError);
    await supabase.from('sessions').delete().eq('id', session.id);
    return Response.json({ error: 'could not create legs' }, { status: 500 });
  }

  return Response.json({ session }, { status: 201 });
}
