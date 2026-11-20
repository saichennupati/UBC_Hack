import { handleWalletRequest } from '@/lib/wallet-api';
import { getServiceClient } from '@/lib/supabase-server';

// Links a pasted Ethereum address without a signature; it is stored as unverified.
export async function POST(request) {
  return handleWalletRequest(request, 'paste', { getClient: getServiceClient, origin: process.env.APP_URL });
}
