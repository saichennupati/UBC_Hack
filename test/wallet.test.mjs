import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';
import { createWalletChallenge, verifyWalletChallenge } from '../lib/wallet.js';
import { handleWalletRequest } from '../lib/wallet-api.js';

const account = privateKeyToAccount(generatePrivateKey());
const userId = '00000000-0000-4000-8000-000000000001';
const origin = 'https://chaosslip.example';
const challenge = () => createWalletChallenge({ address: account.address, userId, origin });

test('challenge binds the wallet, app, user, network, nonce and expiration', () => {
  const value = challenge();
  const parsed = parseSiweMessage(value.message);
  assert.equal(parsed.domain, 'chaosslip.example');
  assert.equal(parsed.uri, origin);
  assert.equal(parsed.chainId, 11155111);
  assert.equal(parsed.address.toLowerCase(), account.address.toLowerCase());
  assert.ok(parsed.statement.includes(userId));
  assert.equal(parsed.expirationTime - parsed.issuedAt, 300000);
  assert.notEqual(parsed.nonce, parseSiweMessage(challenge().message).nonce);
  assert.throws(() => createWalletChallenge({ address: 'bad', userId, origin }));
});

test('accepts a real EOA signature, rejects wrong signer, changed message and expired challenge', async () => {
  const value = challenge();
  const signature = await account.signMessage({ message: value.message });
  assert.equal(await verifyWalletChallenge(value, signature), true);
  const other = privateKeyToAccount(generatePrivateKey());
  assert.equal(await verifyWalletChallenge(value, await other.signMessage({ message: value.message })), false);
  assert.equal(await verifyWalletChallenge({ ...value, message: value.message + 'tampered' }, signature), false);
  assert.equal(await verifyWalletChallenge(value, signature, Date.parse(value.expires_at)), false);
  assert.equal(await verifyWalletChallenge({ ...value, expires_at: 'invalid' }, signature), false);
  assert.equal(await verifyWalletChallenge(value, '0x1234'), false);
  assert.equal(await verifyWalletChallenge(null, signature), false);
});

function request(body = {}, headers = {}) {
  return new Request(`${origin}/api/wallet/verify`, { method: 'POST',
    headers: { origin, authorization: 'Bearer token', ...headers }, body: JSON.stringify(body) });
}
const unavailable = () => { throw new Error('Database should not be called'); };

test('rejects missing tokens and unexpected origins before database access', async () => {
  assert.equal((await handleWalletRequest(request({}, { authorization: '' }), 'verify', { getClient: unavailable, origin })).status, 401);
  assert.equal((await handleWalletRequest(request({}, { origin: 'https://other.example' }), 'verify', { getClient: unavailable, origin })).status, 403);
});

test('rejects invalid auth tokens and unconfirmed accounts', async () => {
  for (const [user, status] of [[null, 401], [{ id: userId }, 403]]) {
    const db = { auth: { getUser: async (token) => { assert.equal(token, 'token'); return { data: { user } }; } } };
    assert.equal((await handleWalletRequest(request(), 'verify', { getClient: () => db, origin })).status, status);
  }
});

test('verification uses authenticated user and stored message, not user-supplied account claims', async () => {
  const value = challenge();
  const signature = await account.signMessage({ message: value.message });
  let rpcCalls = 0;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId, email_confirmed_at: '2026-01-01' } } }) },
    from(table) {
      assert.equal(table, 'wallet_challenges');
      return { select() { return this; }, eq(column, id) {
        assert.equal(column, 'user_id'); assert.equal(id, userId); return this;
      }, async maybeSingle() { return { data: value }; } };
    },
    async rpc(name, args) {
      rpcCalls++;
      assert.equal(name, 'link_account_wallet');
      assert.deepEqual(args, { p_user_id: userId, p_message: value.message });
      return { data: { address: value.address, chain_id: 11155111 } };
    },
  };
  const res = await handleWalletRequest(request({ signature, user_id: 'attacker', address: 'attacker' }), 'verify', { getClient: () => db, origin });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).wallet.address, value.address);
  assert.equal(rpcCalls, 1);
  assert.equal((await handleWalletRequest(request({ signature: 'invalid' }), 'verify', { getClient: () => db, origin })).status, 400);
  assert.equal(rpcCalls, 1);
  db.rpc = async () => ({ error: { code: '23505' } });
  assert.equal((await handleWalletRequest(request({ signature }), 'verify', { getClient: () => db, origin })).status, 409);
  db.rpc = async () => ({ error: { message: 'wallet challenge expired or used' } });
  assert.equal((await handleWalletRequest(request({ signature }), 'verify', { getClient: () => db, origin })).status, 409);
});
