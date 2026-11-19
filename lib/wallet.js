import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { createSiweMessage } from 'viem/siwe';

export const SEPOLIA_CHAIN_ID = 11155111;

export function createWalletChallenge({ address, userId, origin, now = new Date() }) {
  if (!isAddress(address)) throw new Error('Invalid wallet address');
  const url = new URL(origin);
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const message = createSiweMessage({
    address: getAddress(address), chainId: SEPOLIA_CHAIN_ID,
    domain: url.host, uri: url.origin, version: '1',
    nonce: randomBytes(24).toString('hex'), issuedAt: now, expirationTime: expiresAt,
    statement: `Link this wallet to ChaosSlip account ${userId}. This does not authorize a transaction or spending.`,
  });
  return { user_id: userId, address: address.toLowerCase(), message, expires_at: expiresAt.toISOString() };
}

// EOA signatures only: smart-contract wallets need a chain-aware verifier later.
export async function verifyWalletChallenge(challenge, signature, now = Date.now()) {
  if (!challenge || Date.parse(challenge.expires_at) <= now || !Number.isFinite(Date.parse(challenge.expires_at))) return false;
  if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) return false;
  try {
    return await verifyMessage({ address: challenge.address, message: challenge.message, signature });
  } catch { return false; }
}
