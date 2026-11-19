import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SKEW_SECONDS, sign, verifySignature } from '../lib/hmac.js';

const secret = 'test-secret';
const body = '{"event_id":"e1","outcome":"done"}';
const now = 1_700_000_000_000;
const timestamp = String(now / 1000);

test('accepts a correctly signed, fresh request', () => {
  const signature = sign(secret, timestamp, body);
  assert.equal(verifySignature({ secret, timestamp, signature, body, now }), true);
});

test('rejects a tampered body', () => {
  const signature = sign(secret, timestamp, body);
  assert.equal(verifySignature({ secret, timestamp, signature, body: body.replace('done', 'failed'), now }), false);
});

test('rejects the wrong secret', () => {
  const signature = sign('other-secret', timestamp, body);
  assert.equal(verifySignature({ secret, timestamp, signature, body, now }), false);
});

test('rejects a stale timestamp', () => {
  const old = String(now / 1000 - MAX_SKEW_SECONDS - 1);
  const signature = sign(secret, old, body);
  assert.equal(verifySignature({ secret, timestamp: old, signature, body, now }), false);
});

test('rejects missing or malformed signatures', () => {
  assert.equal(verifySignature({ secret, timestamp, signature: null, body, now }), false);
  assert.equal(verifySignature({ secret, timestamp, signature: 'zz', body, now }), false);
  assert.equal(verifySignature({ secret: '', timestamp, signature: 'ab', body, now }), false);
});
