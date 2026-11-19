import Link from 'next/link';
import { GeminiMarkets } from '@/components/GeminiMarkets';
import { AccountPanel } from '@/components/AccountPanel';
import { getPublicClient } from '@/lib/supabase-browser';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { data: sessions, error } = await getPublicClient()
    .from('sessions')
    .select('id, title, status, lock_at')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <main className="page stack">
      <div>
        <span className="brand">ChaosSlip</span>
        <nav className="row"><Link href="/account">Account & wallet</Link></nav>
        <h1>Live GTA VI challenge markets</h1>
        <p className="muted">
          Bet on the full parlay, on each objective, and on side markets like deaths and how the run ends.
        </p>
      </div>

      <AccountPanel walletOnly />

      {error && <p className="error">Could not load sessions: {error.message}</p>}
      {sessions?.length === 0 && <p className="muted">No sessions yet.</p>}

      <ul className="session-list">
        {sessions?.map((session) => (
          <li key={session.id} className="card">
            <Link href={`/s/${session.id}`} className="session-link">
              <strong>{session.title}</strong>
              <span className={`badge badge-${session.status}`}>{session.status}</span>
            </Link>
          </li>
        ))}
      </ul>

      <GeminiMarkets />
    </main>
  );
}
