'use client';

import { AccountPanel } from '@/components/AccountPanel';

export function BettingAccess({ bettingOpen }) {
  return <div className="stack">
    <AccountPanel walletOnly />
    <button className="button" disabled>{bettingOpen ? 'Testnet betting coming soon' : 'Betting closed'}</button>
  </div>;
}
