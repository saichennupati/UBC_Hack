import Link from 'next/link';
import { StreamWatcher } from '@/components/StreamWatcher';

export const metadata = { title: 'Watch live · ChaosSlip' };

export default function WatchPage() {
  return (
    <div className="discovery-shell">
      <header className="site-header">
        <Link href="/" className="site-logo">
          <span className="logo-mark">C</span>CHAOS<span>SLIP</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">Discover</Link>
          <Link href="/watch" className="active">
            Watch live
          </Link>
        </nav>
      </header>
      <main className="discovery-main">
        <StreamWatcher />
      </main>
    </div>
  );
}
