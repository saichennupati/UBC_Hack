'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AccountPanel } from '@/components/AccountPanel';
import { outcomePools } from '@/lib/markets';
import { decimalOdds, filterSessions, MARKET_LABELS, streamSource } from '@/lib/discovery';

function Market({ market, sessionId, pools, onSelect }) {
  const odds = decimalOdds(market, pools);
  return <div className="discovery-market">
    <span className="eyebrow">{MARKET_LABELS[market.kind] || market.kind}</span>
    <h3>{market.question}</h3>
    <div className="odds-grid">{(market.outcomes ?? []).slice(0, 6).map(o => <button key={o.id} className="odds-button" onClick={() => onSelect({ market, outcome: o, odds: odds[o.id], sessionId })}>
      <span>{o.label}</span><strong>{odds[o.id] == null ? '—' : `${odds[o.id].toFixed(2)}×`}</strong>
    </button>)}</div>
  </div>;
}

function StreamArtwork({ session, hero = false }) {
  const [host, setHost] = useState('');
  useEffect(() => setHost(window.location.hostname), []);
  const source = streamSource(session?.stream_url, host);
  const [failed, setFailed] = useState(false);
  const thumbnail = session?.thumbnail_url || source?.thumbnail;
  return <div className={`stream-art ${hero ? 'hero-art' : ''}`}>
    {hero && source && host ? <iframe title={`${session.title} stream preview`} src={source.embed} allow="fullscreen; encrypted-media; picture-in-picture" allowFullScreen /> : <>
      {thumbnail && !failed && <img src={thumbnail} alt="" loading="lazy" onError={() => setFailed(true)} />}
      <div className="art-grid" aria-hidden="true" />
      <div className="art-word" aria-hidden="true">{session?.game_name || 'CHAOS'}<span>LIVE CHALLENGES</span></div>
      {hero && <div className="preview-empty"><span className="play-symbol">▷</span><span>{session ? 'Stream preview not connected' : 'The next big moment starts here'}</span></div>}
    </>}
    {!hero && <span className={`stream-status ${session.status === 'live' ? 'is-live' : ''}`}>{session.status === 'live' ? '● LIVE' : session.status === 'open' ? 'UPCOMING' : session.status.toUpperCase()}</span>}
  </div>;
}

function StreamCard({ session, pools, onSelect }) {
  return <article className="stream-card">
    <Link href={`/s/${session.id}`} aria-label={`View ${session.title}`}><StreamArtwork session={session} /></Link>
    <div className="stream-card-body">
      <div className="stream-meta"><span>{session.streamer_name || 'Unnamed streamer'}</span><span>{session.viewer_count == null ? 'Viewers —' : `${session.viewer_count.toLocaleString()} viewers*`}</span></div>
      <Link className="card-title" href={`/s/${session.id}`}>{session.title}</Link>
      <span className="muted">{session.game_name || 'Unspecified game'}</span>
      {session.markets[0] ? <Market market={session.markets[0]} sessionId={session.id} pools={pools} onSelect={onSelect} /> : <p className="muted">Markets haven’t been added yet.</p>}
      <div className="card-pool"><span>Recorded pool</span><strong>{session.markets.reduce((sum, m) => sum + m.outcomes.reduce((n,o) => n + (pools[o.id] || 0), 0), 0).toFixed(4)} ETH</strong></div>
    </div>
  </article>;
}

export function Discovery({ sessions, slips, error, children }) {
  const router = useRouter();
  const [filters, setFilters] = useState({ game: '', streamer: '', kind: '', minOdds: '' });
  const [selected, setSelected] = useState(null);
  const drawer = useRef(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = e => {
      if (e.key === 'Escape') setSelected(null);
      if (e.key !== 'Tab') return;
      const items = drawer.current?.querySelectorAll('button, a[href]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [selected]);
  const [walletOpen, setWalletOpen] = useState(false);
  useEffect(() => { const timer = setInterval(() => router.refresh(), 30000); return () => clearInterval(timer); }, [router]);
  const pools = outcomePools(slips);
  const filtered = filterSessions(sessions, filters, pools);
  const total = s => (s.markets ?? []).reduce((sum, m) => sum + m.outcomes.reduce((n, o) => n + (pools[o.id] ?? 0), 0), 0);
  const live = filtered.filter(s => s.status === 'live').sort((a, b) => (b.viewer_count ?? -1) - (a.viewer_count ?? -1) || total(b) - total(a));
  const upcoming = filtered.filter(s => s.status === 'open').sort((a,b) => Date.parse(a.lock_at) - Date.parse(b.lock_at));
  const featured = live[0] || upcoming[0];
  const recent = slips.filter(s => Date.parse(s.created_at) > Date.now() - 86400000);
  const activity = s => recent.filter(b => b.session_id === s.id).length;
  const trending = filtered.filter(s => activity(s) > 0).sort((a,b) => activity(b) - activity(a));
  const biggest = filtered.filter(s => total(s) > 0).sort((a,b) => total(b) - total(a));
  const selectFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  const section = (id, title, subtitle, rows, empty) => <section className="discovery-section" id={id}>
    <div className="section-heading"><div><h2>{title}<span className="count-pill">{rows.length}</span></h2><p>{subtitle}</p></div></div>
    {rows.length ? <div className="stream-grid">{rows.slice(0, 6).map(s => <StreamCard key={s.id} session={s} pools={pools} onSelect={setSelected} />)}</div> : <div className="empty-row"><span className="empty-mark" aria-hidden="true">◇</span><div><strong>{empty}</strong><p>New sessions and market activity will appear here.</p></div></div>}
  </section>;
  return <div className="discovery-shell">
    <header className="site-header"><Link href="/" className="site-logo"><span className="logo-mark">C</span>CHAOS<span>SLIP</span></Link>
      <nav aria-label="Main navigation"><a href="#live-now" className="active">Discover</a><Link href="/watch">Watch live</Link><a href="#trending">Trending</a><a href="#biggest-pools">Pools</a></nav>
      <div className="header-actions"><span className="network-pill">Sepolia testnet</span><Link className="button button-quiet" href="/account">Account</Link><button className="button" onClick={() => setWalletOpen(!walletOpen)} aria-expanded={walletOpen}>Link wallet</button></div>
    </header>
    <main className="discovery-main">
      <div className="discovery-intro"><div><span className="eyebrow">THE STREAM IS LIVE. THE CALL IS YOURS.</span><h1>Watch the moment.<br /><span>Back your instinct.</span></h1></div><p>Live streams. Real-time challenges.<br />A front-row seat to every outcome.</p></div>
      {walletOpen && <AccountPanel walletOnly />}
      {error && <p className="error" role="alert">Could not load all discovery data: {error}</p>}
      <div className="filter-bar" aria-label="Filter streams and markets">
        <span className="filter-label">Explore</span>
        {[['game','Game', [...new Set(sessions.map(s => s.game_name || 'Unspecified game'))]], ['streamer','Streamer',[...new Set(sessions.map(s => s.streamer_name || 'Unnamed streamer'))]]].map(([key,label,options]) => <label className="filter-chip" key={key}><span>{label}</span><select aria-label={label} value={filters[key]} onChange={e => selectFilter(key,e.target.value)}><option value="">All</option>{options.map(o => <option key={o}>{o}</option>)}</select></label>)}
        <label className="filter-chip"><span>Market type</span><select aria-label="Market type" value={filters.kind} onChange={e => selectFilter('kind',e.target.value)}><option value="">All</option>{Object.entries(MARKET_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="filter-chip"><span>Min odds</span><select aria-label="Minimum decimal odds" value={filters.minOdds} onChange={e => selectFilter('minOdds',e.target.value)}><option value="">Any</option><option value="1.5">1.50×</option><option value="2">2.00×</option><option value="3">3.00×</option></select></label>
        <button className="clear-filters" onClick={() => setFilters({game:'',streamer:'',kind:'',minOdds:''})}>Reset</button>
      </div>
      <section className="feature-strip" aria-label="Featured stream">
        <div className="feature-video"><StreamArtwork key={featured?.id || 'empty'} session={featured} hero /><div className="feature-caption"><span className="eyebrow">{featured?.status === 'live' ? '● FEATURED LIVE' : 'UP NEXT'}</span><h2>{featured?.title || 'Your next watch starts here'}</h2><p>{featured ? `${featured.streamer_name || 'Unnamed streamer'} · ${featured.game_name || 'Unspecified game'}` : 'Explore challenges as streamers go live.'}</p>{featured && <Link href={`/s/${featured.id}`} className="button button-quiet">Explore this session</Link>}</div></div>
        <aside className="feature-markets"><div className="feature-markets-heading"><span className="eyebrow">IN THE SPOTLIGHT</span><h2>Top markets</h2></div>{featured?.markets.length ? featured.markets.slice(0,3).map(m => <Market key={m.id} market={m} sessionId={featured.id} pools={pools} onSelect={setSelected} />) : <div className="feature-placeholder"><span>◇</span><h3>Waiting for the opening line</h3><p>Featured markets appear when a session is created.</p><Link href="/admin" className="button button-quiet">Host a session</Link></div>}<p className="odds-note">Indicative pool odds · Testnet only</p></aside>
      </section>
      {section('live-now','Live Now','Follow the action. Find your next call.',live,'No live sessions match your filters.')}
      {section('starting-soon','Starting Soon','Open sessions, ordered by betting cutoff.',upcoming,'No upcoming sessions match your filters.')}
      {section('trending','Trending Bets','Ranked by recorded slips in the last 24 hours.',trending,'No recent betting activity yet.')}
      {section('biggest-pools','Biggest Pools','Largest recorded pools among the 100 most recent sessions.',biggest,'Pools will appear when stakes are recorded.')}
      {children && <section className="discovery-section">{children}</section>}
      <footer className="discovery-footer"><span>CHAOSSLIP <span className="muted">/ Made for the moment.</span></span><p>Sepolia testnet. Transactions are not enabled. Odds are indicative pool ratios, not guaranteed payouts. *Viewer counts are host-provided snapshots. Refreshes every 30 seconds.</p></footer>
    </main>
    {selected && <div className="selection-backdrop" onClick={() => setSelected(null)}><section ref={drawer} className="selection-panel" role="dialog" aria-modal="true" aria-label="Market selection" onClick={e => e.stopPropagation()}><button className="button button-quiet" autoFocus onClick={() => setSelected(null)}>Close</button><span className="eyebrow">YOUR SELECTION</span><h2>{selected.market.question}</h2><div className="selection-outcome"><span>{selected.outcome.label}</span><strong>{selected.odds ? `${selected.odds.toFixed(2)}×` : 'Odds pending'}</strong></div><p>Bet placement is not available yet. Link your wallet to prepare for the Sepolia testnet launch.</p><Link className="button" href="/account">Link your wallet</Link><Link className="button button-quiet" href={`/s/${selected.sessionId}`}>View full market</Link></section></div>}
  </div>;
}
