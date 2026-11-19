import Link from 'next/link';
import { AccountPanel } from '@/components/AccountPanel';

export default function AccountPage() {
  return <main className="page stack">
    <Link href="/" className="brand">ChaosSlip</Link>
    <h1>Account & wallet</h1>
    <p className="muted">Create your account and link your wallet for the Sepolia testnet demo.</p>
    <AccountPanel />
  </main>;
}
