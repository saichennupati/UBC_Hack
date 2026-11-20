import { topStreams } from '@/lib/twitch';

// Top live English GTA VI streams on Twitch. Cached briefly to stay well inside Twitch rate limits.
export const revalidate = 60;

export async function GET() {
  return Response.json(await topStreams());
}
