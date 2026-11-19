import { Overlay } from '@/components/Overlay';

export const metadata = { title: 'ChaosSlip overlay' };

// Add as an OBS browser source (e.g. 460×520); the page background is transparent.
export default async function OverlayPage({ params }) {
  const { id } = await params;
  return (
    <>
      <style>{'html, body { background: transparent !important; }'}</style>
      <Overlay id={id} />
    </>
  );
}
