import { handleGameEvent } from '@/lib/game-events';
import { getServiceClient } from '@/lib/supabase-server';

export async function POST(request) {
  return handleGameEvent(request, {
    secret: process.env.MOD_SHARED_SECRET,
    getClient: getServiceClient,
  });
}
