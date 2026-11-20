import { getSolBalance } from '@/lib/solana';
import { handleWalletRequest } from '@/lib/wallet-api';
import { getServiceClient } from '@/lib/supabase-server';

// The linked Solana wallet and its devnet SOL balance.
export async function GET(request) {
  return handleWalletRequest(request, 'read', {
    getClient: getServiceClient, origin: process.env.APP_URL, chain: 'solana', getBalance: getSolBalance,
  });
}
