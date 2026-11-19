import Link from 'next/link';
import { GeminiMarkets } from '@/components/GeminiMarkets';
import { SessionView } from '@/components/SessionView';

export default async function SessionPage({ params }) {
  const { id } = await params;
  return (
    <main className="page">
      <Link href="/" className="brand">
        ChaosSlip
      </Link>
      <div className="stack">
        <SessionView id={id} />
        <GeminiMarkets />
      </div>
    </main>
  );
}
