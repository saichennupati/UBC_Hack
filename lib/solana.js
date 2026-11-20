import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

export const SOLANA_CLUSTER = 'devnet';
export const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000;

function decode(value, length) {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return null;
  try {
    const bytes = bs58.decode(value);
    return bytes.length === length ? bytes : null;
  } catch { return null; }
}

// A Solana address is the base58 encoding of a 32-byte ed25519 public key.
export function isSolanaAddress(address) {
  return decode(address, 32) !== null;
}

// Address for storage (trimmed, case preserved), or null.
export function normalizeSolanaAddress(address) {
  return typeof address === 'string' && isSolanaAddress(address.trim()) ? address.trim() : null;
}

// Sign-In With Solana message; wallets such as Phantom recognise this layout and show it as a sign-in.
// Addresses are case-sensitive, so they are stored exactly as given.
export function createSolanaChallenge({ address, userId, origin, now = new Date() }) {
  if (!isSolanaAddress(address)) throw new Error('Invalid wallet address');
  const url = new URL(origin);
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const message = [
    `${url.host} wants you to sign in with your Solana account:`,
    address,
    '',
    `Link this wallet to ChaosSlip account ${userId}. This does not authorize a transaction or spending.`,
    '',
    `URI: ${url.origin}`,
    'Version: 1',
    `Chain ID: ${SOLANA_CLUSTER}`,
    `Nonce: ${randomBytes(24).toString('hex')}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
  return { user_id: userId, address, message, expires_at: expiresAt.toISOString() };
}

// Signature is the base58 encoding of the wallet's 64-byte ed25519 signature over the exact message.
export async function verifySolanaChallenge(challenge, signature, now = Date.now()) {
  if (!challenge || !Number.isFinite(Date.parse(challenge.expires_at)) || Date.parse(challenge.expires_at) <= now) return false;
  const signatureBytes = decode(signature, 64);
  const publicKey = decode(challenge.address, 32);
  if (!signatureBytes || !publicKey) return false;
  try {
    return ed25519.verify(signatureBytes, new TextEncoder().encode(challenge.message), publicKey);
  } catch { return false; }
}

// Devnet SOL balance for an address, or null if the RPC can't be reached.
export async function getSolBalance(address, { fetchImpl = fetch, rpcUrl = SOLANA_RPC_URL } = {}) {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const lamports = (await response.json())?.result?.value;
    return Number.isSafeInteger(lamports) ? lamports / LAMPORTS_PER_SOL : null;
  } catch { return null; }
}
