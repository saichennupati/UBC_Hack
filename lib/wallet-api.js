import { createWalletChallenge, normalizeEthereumAddress, verifyWalletChallenge } from './wallet.js';
import { createSolanaChallenge, normalizeSolanaAddress, verifySolanaChallenge } from './solana.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Each chain has its own tables and link functions but shares the same authentication,
// origin check, challenge storage and atomic compare-and-delete linking.
// `paste` links an address without a signature; it is stored with verified = false.
const CHAINS = {
  ethereum: {
    wallets: 'account_wallets', challenges: 'wallet_challenges', link: 'link_account_wallet',
    paste: 'link_unverified_account_wallet', normalize: normalizeEthereumAddress,
    columns: 'address, chain_id, verified, linked_at', migration: '002 and 006',
    createChallenge: createWalletChallenge, verifyChallenge: verifyWalletChallenge,
    invalidAddress: 'Enter a valid Ethereum wallet address.',
  },
  solana: {
    wallets: 'solana_wallets', challenges: 'solana_wallet_challenges', link: 'link_solana_wallet',
    paste: 'link_unverified_solana_wallet', normalize: normalizeSolanaAddress,
    columns: 'address, cluster, verified, linked_at', migration: '005 and 006',
    createChallenge: createSolanaChallenge, verifyChallenge: verifySolanaChallenge,
    invalidAddress: 'Enter a valid Solana wallet address.',
  },
};

export async function handleWalletRequest(request, action, { getClient, origin, chain = 'ethereum', getBalance }) {
  const config = CHAINS[chain];
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
      const result = await db.from(config.wallets).select(config.columns).eq('user_id', user.id).maybeSingle();
      if (result.error) return json({ error: `Could not load wallet. Check that migration ${config.migration} is applied.` }, 503);
      if (result.data && getBalance) return json({ wallet: result.data, balance: await getBalance(result.data.address) });
      return json({ wallet: result.data });
    }

    const body = await request.json().catch(() => null);
    if (action === 'paste') {
      const address = config.normalize(body?.address);
      if (!address) return json({ error: config.invalidAddress }, 400);
      const linked = await db.rpc(config.paste, { p_user_id: user.id, p_address: address });
      if (linked.error) return json({ error: `Could not link wallet. Check that migration ${config.migration} is applied.` }, 503);
      return json({ wallet: linked.data });
    }

    if (action === 'challenge') {
      let challenge;
      try { challenge = config.createChallenge({ address: body?.address, userId: user.id, origin: canonical }); }
      catch { return json({ error: config.invalidAddress }, 400); }
      const result = await db.from(config.challenges).upsert(challenge, { onConflict: 'user_id' });
      if (result.error) return json({ error: `Could not start wallet verification. Check that migration ${config.migration} is applied.` }, 503);
      return json({ message: challenge.message });
    }

    const result = await db.from(config.challenges).select('*').eq('user_id', user.id).maybeSingle();
    if (result.error) return json({ error: 'Could not load wallet challenge.' }, 503);
    if (!await config.verifyChallenge(result.data, body?.signature)) {
      return json({ error: 'Signature is invalid or expired. Connect and sign again.' }, 400);
    }
    // A transactional compare-and-delete prevents replay and races with newer challenges.
    const linked = await db.rpc(config.link, { p_user_id: user.id, p_message: result.data.message });
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
