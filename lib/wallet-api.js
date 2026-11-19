import { createWalletChallenge, verifyWalletChallenge } from './wallet.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handleWalletRequest(request, action, { getClient, origin }) {
  let canonical;
  try { canonical = new URL(origin).origin; } catch { return json({ error: 'Wallet linking is not configured.' }, 503); }
  if (request.method !== 'GET' && request.headers.get('origin') !== canonical) {
    return json({ error: 'Unrecognized app origin.' }, 403);
  }
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Sign in to continue.' }, 401);

  try {
    const db = getClient();
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return json({ error: 'Sign in to continue.' }, 401);
    const user = data.user;
    if (!user.email_confirmed_at) return json({ error: 'Confirm your email before linking a wallet.' }, 403);

    if (action === 'read') {
      const result = await db.from('account_wallets').select('address, chain_id, linked_at').eq('user_id', user.id).maybeSingle();
      if (result.error) return json({ error: 'Could not load wallet. Check that migration 002 is applied.' }, 503);
      return json({ wallet: result.data });
    }

    const body = await request.json().catch(() => null);
    if (action === 'challenge') {
      let challenge;
      try { challenge = createWalletChallenge({ address: body?.address, userId: user.id, origin: canonical }); }
      catch { return json({ error: 'Enter a valid Ethereum wallet address.' }, 400); }
      const result = await db.from('wallet_challenges').upsert(challenge, { onConflict: 'user_id' });
      if (result.error) return json({ error: 'Could not start wallet verification. Check that migration 002 is applied.' }, 503);
      return json({ message: challenge.message });
    }

    const result = await db.from('wallet_challenges').select('*').eq('user_id', user.id).maybeSingle();
    if (result.error) return json({ error: 'Could not load wallet challenge.' }, 503);
    if (!await verifyWalletChallenge(result.data, body?.signature)) {
      return json({ error: 'Signature is invalid or expired. Connect and sign again.' }, 400);
    }
    // A transactional compare-and-delete prevents replay and races with newer challenges.
    const linked = await db.rpc('link_account_wallet', { p_user_id: user.id, p_message: result.data.message });
    if (linked.error) {
      if (linked.error.code === '23505') return json({ error: 'This wallet is already linked to another account.' }, 409);
      if (linked.error.message === 'wallet challenge expired or used') return json({ error: 'Verification expired or was already used. Try again.' }, 409);
      return json({ error: 'Could not link wallet.' }, 503);
    }
    return json({ wallet: linked.data });
  } catch {
    return json({ error: 'Account service unavailable. Please try again.' }, 503);
  }
}
