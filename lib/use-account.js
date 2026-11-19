'use client';

import { useEffect, useState } from 'react';
import { getPublicClient } from './supabase-browser';

export function useAccount() {
  const [state, setState] = useState({ user: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    let subscription;
    try {
      const client = getPublicClient();
      ({ data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        if (alive) setState({ user: session?.user ?? null, loading: false, error: null });
      }));
      client.auth.getSession().then(({ error }) => {
        if (alive && error) setState({ user: null, loading: false, error: error.message });
      }).catch(() => {
        if (alive) setState({ user: null, loading: false, error: 'Unable to load your account.' });
      });
    } catch {
      setState({ user: null, loading: false, error: 'Account service is not configured yet.' });
    }
    return () => { alive = false; subscription?.unsubscribe(); };
  }, []);
  return state;
}
