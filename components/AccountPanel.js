'use client';

import { useEffect, useRef, useState } from 'react';
import { createWalletClient, custom } from 'viem';
import { sepolia } from 'viem/chains';
import { getPublicClient } from '@/lib/supabase-browser';
import { useAccount } from '@/lib/use-account';

async function walletApi(path, token, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Wallet request failed.');
  return result;
}

export function AccountPanel() {
  const { user, loading, error: accountError } = useAccount();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [connected, setConnected] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setWallet(null);
    setError('');
    setMessage('');
    if (!user) { setWalletLoading(false); return; }
    setWalletLoading(true);
    (async () => {
      const { data } = await getPublicClient().auth.getSession();
      const result = await walletApi('/api/wallet', data.session?.access_token);
      if (generation.current === current) setWallet(result.wallet);
    })().catch((e) => {
      if (generation.current === current) setError(e.message);
    }).finally(() => {
      if (generation.current === current) setWalletLoading(false);
    });
    return () => { generation.current++; };
  }, [user?.id]);

  useEffect(() => {
    const provider = window.ethereum;
    const changed = () => { setConnected(''); };
    provider?.on?.('accountsChanged', changed);
    provider?.on?.('chainChanged', changed);
    provider?.on?.('disconnect', changed);
    return () => {
      provider?.removeListener?.('accountsChanged', changed);
      provider?.removeListener?.('chainChanged', changed);
      provider?.removeListener?.('disconnect', changed);
    };
  }, []);

  async function authenticate(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const auth = getPublicClient().auth;
      const result = mode === 'signup'
        ? await auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/account` } })
        : await auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setPassword('');
      if (mode === 'signup' && !result.data.session) setMessage('Check your email to confirm your account, then sign in.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError('');
    try {
      const { error } = await getPublicClient().auth.signOut();
      if (error) throw error;
      setConnected(''); setWallet(null); setMessage('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function connectWallet() {
    setBusy(true); setError(''); setMessage('');
    const current = generation.current;
    try {
      if (!window.ethereum) throw new Error('Open this page in a browser with an Ethereum wallet such as MetaMask installed.');
      const { data } = await getPublicClient().auth.getSession();
      if (!data.session || data.session.user.id !== user.id) throw new Error('Please sign in again.');
      const token = data.session.access_token;
      const client = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });
      const [address] = await client.requestAddresses();
      if (!address) throw new Error('No wallet account selected.');
      await client.switchChain({ id: sepolia.id });
      if (current !== generation.current) return;
      const { message: challenge } = await walletApi('/api/wallet/challenge', token, { address });
      const signature = await client.signMessage({ account: address, message: challenge });
      if (current !== generation.current) return;
      const result = await walletApi('/api/wallet/verify', token, { signature });
      if (current !== generation.current) return;
      setWallet(result.wallet);
      const [selected] = await client.getAddresses();
      const chainId = await client.getChainId();
      if (current !== generation.current) return;
      setConnected(selected?.toLowerCase() === address.toLowerCase() && chainId === sepolia.id ? address : '');
      setMessage('Wallet ownership verified. Your wallet is linked to your account.');
    } catch (e) {
      if (current === generation.current) setError(e.shortMessage ?? e.message ?? 'Wallet connection failed.');
    } finally { setBusy(false); }
  }

  if (loading) return <p className="muted">Loading account…</p>;
  return <div className="stack">
    {(error || accountError) && <p className="error" role="alert">{error || accountError}</p>}
    {message && <p role="status">{message}</p>}
    {!user ? <form className="card stack" onSubmit={authenticate}>
      <h2>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2>
      <label className="field">Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field">Password<input type="password" minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="button" disabled={busy || !!accountError}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <button className="button button-quiet" type="button" disabled={busy} onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setMessage(''); }}>
        {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </form> : <>
      <section className="card stack">
        <h2>Your account</h2>
        <p className="wallet-address">{user.email}</p>
        <button className="button button-quiet" disabled={busy} onClick={signOut}>Sign out</button>
      </section>
      <section className="card stack">
        <h2>Your wallet · Sepolia testnet</h2>
        {walletLoading ? <p>Loading linked wallet…</p> : wallet ? <>
          <span className="badge badge-won">Verified wallet</span>
          <code className="wallet-address">{wallet.address}</code>
          <p className="muted">{connected ? 'Connected in this browser.' : 'Linked to your account. Reconnect when you want to use this wallet.'}</p>
        </> : <p>Link an Ethereum wallet to prepare your account for testnet betting.</p>}
        <p className="muted">You’ll approve a connection, switch to Sepolia, and sign an ownership message. This does not send funds or grant spending permission.</p>
        <button className="button" disabled={busy || walletLoading} onClick={connectWallet}>{busy ? 'Please wait…' : wallet ? 'Connect / change wallet' : 'Connect and verify wallet'}</button>
        <p className="muted">Testnet betting is not available yet. No deposits or bets can be submitted.</p>
      </section>
    </>}
  </div>;
}
