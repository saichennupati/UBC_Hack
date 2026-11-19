import { handleWalletRequest } from '@/lib/wallet-api';
import { getServiceClient } from '@/lib/supabase-server';

export async function GET(request) {
  return handleWalletRequest(request, 'read', { getClient: getServiceClient, origin: process.env.APP_URL });
}
