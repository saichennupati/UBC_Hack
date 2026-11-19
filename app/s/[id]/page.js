import Link from 'next/link';
import { SessionView } from '@/components/SessionView';

export default async function SessionPage({ params }) {
  const { id } = await params;
  return (
    <main className="page">
      <Link href="/" className="brand">
        ChaosSlip
      </Link>
      <SessionView id={id} />
    </main>
  );
}
