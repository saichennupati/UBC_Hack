'use client';

import Link from 'next/link';
import { useAccount } from '@/lib/use-account';

export function BettingAccess({ bettingOpen }) {
  const { user, loading, error } = useAccount();
  return <div className="stack">
    <p className="muted">Sepolia testnet preview. Betting will open once the testnet contract is available.</p>
    {error && <p className="error">{error}</p>}
    <Link className="button button-quiet" href="/account">
      {loading ? 'Account & wallet' : user ? 'Manage your wallet' : 'Create account / sign in'}
    </Link>
    <button className="button" disabled>{bettingOpen ? 'Testnet betting coming soon' : 'Betting closed'}</button>
  </div>;
}
