import { GeminiMarkets } from '@/components/GeminiMarkets';
import { Discovery } from '@/components/Discovery';
import { getPublicClient } from '@/lib/supabase-browser';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const db = getPublicClient();
  const sessions = await db.from('sessions').select('*, markets(*, outcomes!outcomes_market_id_fkey(*))')
    .order('created_at', { ascending: false }).order('position', { referencedTable: 'markets' })
    .order('position', { referencedTable: 'markets.outcomes' }).limit(100);
  const ids = (sessions.data ?? []).map(s => s.id);
  const slips = [];
  let error = sessions.error?.message;
  if (ids.length) {
    for (let offset = 0; ; offset += 1000) {
      const page = await db.from('slips').select('id, session_id, outcome_id, amount_wei, created_at')
        .in('session_id', ids).order('id').range(offset, offset + 999);
      if (page.error) { error = page.error.message; slips.length = 0; break; }
      slips.push(...page.data);
      if (page.data.length < 1000) break;
    }
  }
  return <Discovery sessions={sessions.data ?? []} slips={slips} error={error}><GeminiMarkets /></Discovery>;
}
