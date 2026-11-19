'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicClient } from '@/lib/supabase-browser';

// Loads a session with its legs, markets and slips, and refetches whenever any of them change.
export function useLiveSession(id) {
  const [data, setData] = useState({ session: null, legs: [], markets: [], slips: [], error: null, loading: true });

  const load = useCallback(async () => {
    const supabase = getPublicClient();
    const [session, legs, markets, slips] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', id).maybeSingle(),
      supabase.from('legs').select('*').eq('session_id', id).order('position'),
      supabase
        .from('markets')
        .select('*, outcomes!outcomes_market_id_fkey(*)')
        .eq('session_id', id)
        .order('position')
        .order('position', { referencedTable: 'outcomes' }),
      supabase.from('slips').select('outcome_id, amount_wei').eq('session_id', id),
    ]);
    const error = session.error ?? legs.error ?? markets.error ?? slips.error;
    setData({
      session: session.data,
      legs: legs.data ?? [],
      markets: markets.data ?? [],
      slips: slips.data ?? [],
      error: error?.message ?? (session.data ? null : 'Session not found'),
      loading: false,
    });
  }, [id]);

  useEffect(() => {
    load();
    const supabase = getPublicClient();
    const channel = supabase
      .channel(`session-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'legs', filter: `session_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'markets', filter: `session_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slips', filter: `session_id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, load]);

  return data;
}

// Milliseconds until `target`, ticking a few times a second. Null when there is no target.
export function useCountdown(target) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [target]);
  return target ? Math.max(0, new Date(target).getTime() - now) : null;
}

// Asks the server to close out a live session once its timer reaches zero.
export function useExpireWhenDone(session, remainingMs) {
  const requested = useRef(false);
  useEffect(() => {
    if (session?.status !== 'live' || remainingMs !== 0 || requested.current) return;
    requested.current = true;
    fetch(`/api/sessions/${session.id}/expire`, { method: 'POST' }).catch(() => {
      requested.current = false;
    });
  }, [session, remainingMs]);
}

export function formatClock(ms) {
  if (ms == null) return '--:--';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
