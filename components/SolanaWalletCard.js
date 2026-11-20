'use client';

import { useEffect, useRef, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';
import { PasteAddressForm } from '@/components/PasteAddressForm';
import { getPublicClient } from '@/lib/supabase-browser';

const FAUCET_URL = 'https://faucet.solana.com';

// Wallet Standard wallets (Phantom, Solflare, Backpack, …) that can connect and sign messages.
function solanaWallets() {
  return getWallets().get().filter((wallet) =>
    wallet.chains.some((chain) => chain.startsWith('solana:'))
    && wallet.features['standard:connect'] && wallet.features['solana:signMessage']);
}

async function walletApi(path, body) {
  const { data } = await getPublicClient().auth.getSession();
  if (!data.session) throw new Error('Please sign in again.');
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Wallet request failed.');
  return result;
}

export function SolanaWalletCard({ user }) {
  const [wallets, setWallets] = useState([]);
  const [linked, setLinked] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);

  // Wallet extensions register asynchronously, so keep listening for new ones.
  useEffect(() => {
    setWallets(solanaWallets());
    const { on } = getWallets();
    const offRegister = on('register', () => setWallets(solanaWallets()));
    const offUnregister = on('unregister', () => setWallets(solanaWallets()));
    return () => { offRegister(); offUnregister(); };
  }, []);

  async function load(current = generation.current) {
    const result = await walletApi('/api/wallet/solana');
    if (generation.current !== current) return;
    setLinked(result.wallet);
    setBalance(result.balance ?? null);
  }

  useEffect(() => {
    const current = ++generation.current;
    setLinked(null); setBalance(null); setError(''); setMessage('');
    setLoading(true);
    load(current)
      .catch((e) => { if (generation.current === current) setError(e.message); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current++; };
  }, [user.id]);

  async function link(wallet) {
    setBusy(wallet.name); setError(''); setMessage('');
    const current = generation.current;
    try {
      const { accounts } = await wallet.features['standard:connect'].connect();
      const account = accounts[0] ?? wallet.accounts[0];
      if (!account) throw new Error('No wallet account selected.');
      const { message: challenge } = await walletApi('/api/wallet/solana/challenge', { address: account.address });
      if (current !== generation.current) return;
      const [signed] = await wallet.features['solana:signMessage'].signMessage({
        account, message: new TextEncoder().encode(challenge),
      });
      if (current !== generation.current) return;
      const result = await walletApi('/api/wallet/solana/verify', { signature: bs58.encode(signed.signature) });
      if (current !== generation.current) return;
      setLinked(result.wallet);
      await load(current);
      setMessage(`Wallet ownership verified. Your ${wallet.name} wallet is linked to your account.`);
    } catch (e) {
      if (current === generation.current) setError(e.message ?? 'Wallet connection failed.');
    } finally { setBusy(''); }
  }

  async function pasteAddress(address) {
    setError(''); setMessage('');
    const current = generation.current;
    try {
      await walletApi('/api/wallet/solana/address', { address });
      await load(current);
      if (current === generation.current) setMessage('Wallet linked successfully.');
    } catch (e) {
      if (current === generation.current) setError(e.message);
      throw e;
    }
  }

  async function refreshBalance() {
    setBusy('balance'); setError('');
    try { await load(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  return <section className="card stack">
    <h2>{linked ? 'Your linked Solana wallet' : 'Link your Solana wallet'}</h2>
    <span className="muted">Solana · Devnet</span>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}

    {loading ? <p>Loading linked wallet…</p> : linked ? <>
      {linked.verified
        ? <span className="badge badge-won">Verified wallet</span>
        : <span className="badge badge-open">Unverified — sign with your wallet to verify</span>}
      <code className="wallet-address">{linked.address}</code>
      <div className="solana-balance">
        <span className="label">Devnet balance</span>
        <strong>{balance == null ? 'Unavailable' : `${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`}</strong>
        <button className="button button-quiet" disabled={!!busy} onClick={refreshBalance}>
          {busy === 'balance' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="muted">
        Need test SOL? Paste your address into the <a href={FAUCET_URL} target="_blank" rel="noreferrer">Solana devnet faucet</a>.
        Turn on testnet mode in your wallet to see the same balance there.
      </p>
    </> : <p>Paste your Solana address to link it to your account.</p>}

    {!loading && <PasteAddressForm
      label={linked ? 'Change linked address' : 'Solana address'}
      placeholder="e.g. 7xKX…"
      disabled={!!busy}
      onLink={pasteAddress}
    />}

    {!loading && <details className="verify-details">
      <summary>Verify ownership with a browser wallet (optional)</summary>
      <p className="muted">Sign a verification message with Phantom, Solflare or Backpack. Signing is free and does not send funds or grant spending permission.</p>
      {wallets.length > 0 ? <div className="row">
        {wallets.map((wallet) => (
          <button key={wallet.name} className="button button-quiet solana-wallet-button" disabled={!!busy} onClick={() => link(wallet)}>
            {wallet.icon && <img src={wallet.icon} alt="" width="20" height="20" />}
            {busy === wallet.name ? 'Approve in your wallet…' : `Verify with ${wallet.name}`}
          </button>
        ))}
      </div> : <p className="muted">
        No Solana browser wallet detected. Install <a href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>,{' '}
        <a href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or{' '}
        <a href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a> to verify, then reload this page.
      </p>}
    </details>}
  </section>;
}
