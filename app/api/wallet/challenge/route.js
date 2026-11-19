import { handleWalletRequest } from '@/lib/wallet-api';
import { getServiceClient } from '@/lib/supabase-server';

export async function POST(request) {
  return handleWalletRequest(request, 'challenge', { getClient: getServiceClient, origin: process.env.APP_URL });
}
