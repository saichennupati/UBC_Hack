import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { createSolanaChallenge, getSolBalance, isSolanaAddress, verifySolanaChallenge } from '../lib/solana.js';
import { handleWalletRequest } from '../lib/wallet-api.js';

function keypair() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, address: bs58.encode(ed25519.getPublicKey(secretKey)) };
}
const sign = (secretKey, message) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), secretKey));

const wallet = keypair();
const userId = '00000000-0000-4000-8000-000000000001';
const origin = 'https://chaosslip.example';
const challenge = () => createSolanaChallenge({ address: wallet.address, userId, origin });

test('validates base58 Solana addresses of exactly 32 bytes', () => {
  assert.equal(isSolanaAddress(wallet.address), true);
  assert.equal(isSolanaAddress('11111111111111111111111111111111'), true); // System Program
  for (const bad of ['', 'bad', '0x' + 'a'.repeat(40), wallet.address + '1', wallet.address.replace(/./, 'O'), null]) {
    assert.equal(isSolanaAddress(bad), false, String(bad));
  }
});

test('challenge binds the wallet, app, user, cluster, nonce and expiration', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const value = createSolanaChallenge({ address: wallet.address, userId, origin, now });
  const lines = value.message.split('\n');
  assert.equal(lines[0], 'chaosslip.example wants you to sign in with your Solana account:');
  assert.equal(lines[1], wallet.address);
  assert.ok(value.message.includes(userId));
  assert.ok(value.message.includes(`URI: ${origin}`));
  assert.ok(value.message.includes('Chain ID: devnet'));
  assert.ok(value.message.includes('Expiration Time: 2026-11-20T12:05:00.000Z'));
  assert.equal(value.address, wallet.address, 'case-sensitive address must not be altered');
  assert.equal(value.expires_at, '2026-11-20T12:05:00.000Z');
  const nonce = (m) => m.match(/Nonce: (\w+)/)[1];
  assert.notEqual(nonce(value.message), nonce(challenge().message));
  assert.throws(() => createSolanaChallenge({ address: 'bad', userId, origin }));
});

test('accepts a real ed25519 signature, rejects wrong signer, changed message and expired challenge', async () => {
  const value = challenge();
  const signature = sign(wallet.secretKey, value.message);
  assert.equal(await verifySolanaChallenge(value, signature), true);
  assert.equal(await verifySolanaChallenge(value, sign(keypair().secretKey, value.message)), false);
  assert.equal(await verifySolanaChallenge({ ...value, message: value.message + 'tampered' }, signature), false);
  assert.equal(await verifySolanaChallenge({ ...value, address: keypair().address }, signature), false);
  assert.equal(await verifySolanaChallenge(value, signature, Date.parse(value.expires_at)), false);
  assert.equal(await verifySolanaChallenge({ ...value, expires_at: 'invalid' }, signature), false);
  assert.equal(await verifySolanaChallenge(value, 'not-base58!'), false);
  assert.equal(await verifySolanaChallenge(value, bs58.encode(new Uint8Array(63))), false);
  assert.equal(await verifySolanaChallenge(null, signature), false);
});

function request(path, body, headers = {}) {
  return new Request(`${origin}${path}`, body === undefined
    ? { headers: { authorization: 'Bearer token', ...headers } }
    : { method: 'POST', headers: { origin, authorization: 'Bearer token', ...headers }, body: JSON.stringify(body) });
}
const confirmed = { id: userId, email_confirmed_at: '2026-11-20T00:00:00Z' };

// Minimal Supabase stub that records which tables and functions the handler touches.
function fakeDb({ stored = null, wallet: linkedWallet = null, rpc } = {}) {
  const touched = [];
  return {
    touched,
    auth: { getUser: async () => ({ data: { user: confirmed } }) },
    from(table) {
      touched.push(table);
      return {
        upsert: async (row, options) => { touched.push({ upsert: row, options }); return { error: null }; },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table.endsWith('challenges') ? stored : linkedWallet, error: null }) }) }),
      };
    },
    rpc: async (name, params) => { touched.push({ rpc: name, params }); return rpc ? rpc(name, params) : { data: linkedWallet, error: null }; },
  };
}

test('Solana challenges use the Solana tables and reject Ethereum addresses', async () => {
  const db = fakeDb();
  const ok = await handleWalletRequest(request('/api/wallet/solana/challenge', { address: wallet.address }), 'challenge', { getClient: () => db, origin, chain: 'solana' });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).message, /sign in with your Solana account/);
  assert.equal(db.touched[0], 'solana_wallet_challenges');
  assert.equal(db.touched[1].upsert.address, wallet.address);
  assert.equal(db.touched[1].upsert.user_id, userId);

  const eth = await handleWalletRequest(request('/api/wallet/solana/challenge', { address: '0x' + 'a'.repeat(40) }), 'challenge', { getClient: () => fakeDb(), origin, chain: 'solana' });
  assert.equal(eth.status, 400);
  assert.deepEqual(await eth.json(), { error: 'Enter a valid Solana wallet address.' });
});

test('verification links through link_solana_wallet with the stored message, never the client claim', async () => {
  const stored = challenge();
  const linkedWallet = { address: wallet.address, cluster: 'devnet', linked_at: '2026-11-20T00:00:00Z' };
  const db = fakeDb({ stored, wallet: linkedWallet });
  const response = await handleWalletRequest(
    request('/api/wallet/solana/verify', { signature: sign(wallet.secretKey, stored.message), address: keypair().address, userId: 'someone-else' }),
    'verify', { getClient: () => db, origin, chain: 'solana' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { wallet: linkedWallet });
  assert.deepEqual(db.touched.find((t) => t.rpc), { rpc: 'link_solana_wallet', params: { p_user_id: userId, p_message: stored.message } });

  const forged = await handleWalletRequest(request('/api/wallet/solana/verify', { signature: sign(keypair().secretKey, stored.message) }),
    'verify', { getClient: () => fakeDb({ stored, rpc: () => assert.fail('must not link') }), origin, chain: 'solana' });
  assert.equal(forged.status, 400);

  const taken = await handleWalletRequest(request('/api/wallet/solana/verify', { signature: sign(wallet.secretKey, stored.message) }),
    'verify', { getClient: () => fakeDb({ stored, rpc: () => ({ error: { code: '23505', message: 'duplicate' } }) }), origin, chain: 'solana' });
  assert.equal(taken.status, 409);
});

test('reading the Solana wallet includes its balance; Ethereum stays the default chain', async () => {
  const linkedWallet = { address: wallet.address, cluster: 'devnet', linked_at: '2026-11-20T00:00:00Z' };
  const db = fakeDb({ wallet: linkedWallet });
  const response = await handleWalletRequest(request('/api/wallet/solana'), 'read',
    { getClient: () => db, origin, chain: 'solana', getBalance: async (address) => (address === wallet.address ? 1.5 : 0) });
  assert.deepEqual(await response.json(), { wallet: linkedWallet, balance: 1.5 });
  assert.equal(db.touched[0], 'solana_wallets');

  const ethDb = fakeDb();
  await handleWalletRequest(request('/api/wallet'), 'read', { getClient: () => ethDb, origin });
  assert.equal(ethDb.touched[0], 'account_wallets');
});

test('pasting links an address unverified on either chain, validating it per chain', async () => {
  const solDb = fakeDb({ rpc: (name, params) => ({ data: { address: params.p_address, verified: false }, error: null }) });
  const sol = await handleWalletRequest(request('/api/wallet/solana/address', { address: `  ${wallet.address} ` }), 'paste',
    { getClient: () => solDb, origin, chain: 'solana' });
  assert.equal(sol.status, 200);
  assert.deepEqual(await sol.json(), { wallet: { address: wallet.address, verified: false } });
  assert.deepEqual(solDb.touched.find((t) => t.rpc), { rpc: 'link_unverified_solana_wallet', params: { p_user_id: userId, p_address: wallet.address } });

  const checksummed = '0x52908400098527886E0F7030069857D2E4169EE7';
  const ethDb = fakeDb({ rpc: (name, params) => ({ data: { address: params.p_address, verified: false }, error: null }) });
  const eth = await handleWalletRequest(request('/api/wallet/address', { address: checksummed }), 'paste', { getClient: () => ethDb, origin });
  assert.equal(eth.status, 200);
  assert.deepEqual(ethDb.touched.find((t) => t.rpc), { rpc: 'link_unverified_account_wallet', params: { p_user_id: userId, p_address: checksummed.toLowerCase() } });

  const noRpc = () => fakeDb({ rpc: () => assert.fail('invalid addresses must not reach the database') });
  for (const [chain, address] of [
    ['solana', '0x' + 'a'.repeat(40)], ['solana', 'not an address'], ['solana', undefined],
    ['ethereum', wallet.address], ['ethereum', '0x52908400098527886E0F7030069857D2E4169EE8'.replace('E8', 'e8')], ['ethereum', '0x123'],
  ]) {
    const res = await handleWalletRequest(request('/x', { address }), 'paste', { getClient: noRpc, origin, chain });
    assert.equal(res.status, 400, `${chain} ${address}`);
  }

  const missingMigration = await handleWalletRequest(request('/api/wallet/solana/address', { address: wallet.address }), 'paste',
    { getClient: () => fakeDb({ rpc: () => ({ error: { message: 'function does not exist' } }) }), origin, chain: 'solana' });
  assert.equal(missingMigration.status, 503);
  assert.match((await missingMigration.json()).error, /migration 005 and 006/);

  const foreign = await handleWalletRequest(request('/x', { address: wallet.address }, { origin: 'https://evil.example' }), 'paste',
    { getClient: unavailableDb, origin, chain: 'solana' });
  assert.equal(foreign.status, 403);
});

const unavailableDb = () => { throw new Error('Database should not be called'); };

test('balance reads lamports from the devnet RPC and returns null on failure', async () => {
  let sent;
  const balance = await getSolBalance(wallet.address, {
    fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return Response.json({ result: { value: 2_500_000_000 } }); },
  });
  assert.equal(balance, 2.5);
  assert.equal(sent.url, 'https://api.devnet.solana.com');
  assert.equal(sent.body.method, 'getBalance');
  assert.equal(sent.body.params[0], wallet.address);

  for (const fetchImpl of [
    async () => new Response('', { status: 429 }),
    async () => Response.json({ error: { message: 'Invalid param' } }),
    async () => { throw new TypeError('fetch failed'); },
  ]) assert.equal(await getSolBalance(wallet.address, { fetchImpl }), null);
});
