import Link from 'next/link';
import { AccountPanel } from '@/components/AccountPanel';

export default function AccountPage() {
  return <main className="page stack">
    <Link href="/" className="brand">ChaosSlip</Link>
    <h1>Account & wallet</h1>
    <p className="muted">Create your account and link your Ethereum (Sepolia) or Solana (devnet) wallet for the testnet demo.</p>
    <AccountPanel />
  </main>;
}
