-- ChaosSlip schema. Run once in the Supabase SQL editor.

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open' check (status in ('open', 'live', 'won', 'lost')),
  duration_seconds int not null check (duration_seconds > 0),
  -- Bets are accepted until lock_at; starting a session pulls lock_at forward to now.
  lock_at timestamptz not null,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Numeric id used by the on-chain pool contract.
  chain_session_id bigint generated always as identity unique,
  created_at timestamptz not null default now()
);

create table if not exists legs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  position int not null,
  type text not null check (type in ('mission_first_try', 'survive_pursuit', 'reach_location')),
  label text not null,
  params jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'active', 'done', 'failed')),
  resolved_at timestamptz,
  unique (session_id, position)
);

-- Audit log of accepted game events; event_id makes delivery idempotent.
create table if not exists game_events (
  event_id text primary key,
  session_id uuid references sessions on delete cascade,
  leg_id uuid references legs on delete cascade,
  outcome text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- Off-chain mirror of on-chain bets, for fast UI.
create table if not exists slips (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  wallet text not null,
  side boolean not null, -- true = streamer completes the parlay
  amount_wei numeric not null check (amount_wei > 0),
  tx_hash text not null unique,
  created_at timestamptz not null default now()
);

-- Public can read sessions, legs and slips; all writes go through the service role.
alter table sessions enable row level security;
alter table legs enable row level security;
alter table game_events enable row level security;
alter table slips enable row level security;

drop policy if exists "public read" on sessions;
create policy "public read" on sessions for select using (true);
drop policy if exists "public read" on legs;
create policy "public read" on legs for select using (true);
drop policy if exists "public read" on slips;
create policy "public read" on slips for select using (true);

alter publication supabase_realtime add table sessions, legs, slips;

-- Starts the timer, closes betting and activates the first leg.
create or replace function start_session(p_session_id uuid) returns sessions
language plpgsql security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  if s.status <> 'open' then raise exception 'session already started'; end if;
  if not exists (select 1 from legs where session_id = p_session_id) then
    raise exception 'session has no legs';
  end if;

  update sessions
     set status = 'live',
         starts_at = now(),
         ends_at = now() + make_interval(secs => duration_seconds),
         lock_at = least(lock_at, now())
   where id = p_session_id
  returning * into s;

  update legs set status = 'active'
   where session_id = p_session_id
     and position = (select min(position) from legs where session_id = p_session_id);

  return s;
end $$;

-- Resolves the active leg. A fail (or a late result) loses the parlay;
-- a success activates the next leg, or wins the parlay if it was the last.
create or replace function apply_leg_outcome(p_leg_id uuid, p_outcome text) returns sessions
language plpgsql security definer set search_path = public as $$
declare
  l legs;
  s sessions;
  v_session_id uuid;
  next_leg_id uuid;
begin
  if p_outcome not in ('done', 'failed') then raise exception 'invalid outcome'; end if;

  select session_id into v_session_id from legs where id = p_leg_id;
  if v_session_id is null then raise exception 'leg not found'; end if;

  -- Lock the session row so concurrent events are applied one at a time.
  select * into s from sessions where id = v_session_id for update;
  if s.status <> 'live' then raise exception 'session is not live'; end if;

  select * into l from legs where id = p_leg_id;
  if l.status <> 'active' then raise exception 'leg is not active'; end if;

  if now() > s.ends_at or p_outcome = 'failed' then
    update legs set status = 'failed', resolved_at = now() where id = l.id;
    update sessions set status = 'lost' where id = s.id returning * into s;
    return s;
  end if;

  update legs set status = 'done', resolved_at = now() where id = l.id;

  select id into next_leg_id from legs
   where session_id = s.id and position > l.position
   order by position limit 1;

  if next_leg_id is null then
    update sessions set status = 'won' where id = s.id returning * into s;
  else
    update legs set status = 'active' where id = next_leg_id;
  end if;

  return s;
end $$;

-- Loses the parlay once the timer has run out. Safe for anyone to trigger:
-- it does nothing unless the session really is live and past ends_at.
create or replace function expire_session(p_session_id uuid) returns sessions
language plpgsql security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  if s.status <> 'live' or now() <= s.ends_at then return s; end if;

  update legs set status = 'failed', resolved_at = now()
   where session_id = p_session_id and status = 'active';
  update sessions set status = 'lost' where id = p_session_id returning * into s;
  return s;
end $$;

revoke execute on function start_session(uuid), apply_leg_outcome(uuid, text), expire_session(uuid)
  from public, anon, authenticated;
grant execute on function start_session(uuid), apply_leg_outcome(uuid, text), expire_session(uuid)
  to service_role;

-- Atomic game-event processing; existing databases use migration 001.
begin;

-- Historical events have no reliable processing receipt and retain NULL.
alter table public.game_events add column if not exists result jsonb;

create or replace function public.process_game_event(
  p_event_id text, p_session_id uuid, p_leg_id uuid, p_outcome text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  existing game_events;
  resolved sessions;
  inserted_count int;
begin
  if p_event_id is null or btrim(p_event_id) = ''
     or p_session_id is null or p_leg_id is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid event';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'failed') then
    raise exception 'invalid outcome';
  end if;
  if not exists (select 1 from sessions where id = p_session_id) then
    raise exception 'session not found';
  end if;
  if not exists (select 1 from legs where id = p_leg_id) then
    raise exception 'leg not found';
  end if;
  if not exists (select 1 from legs where id = p_leg_id and session_id = p_session_id) then
    raise exception 'leg does not belong to session';
  end if;

  -- The unique constraint serializes concurrent deliveries of the same ID.
  -- An outcome failure rolls back the insert, allowing a subsequent retry.
  insert into game_events (event_id, session_id, leg_id, outcome, payload)
    values (p_event_id, p_session_id, p_leg_id, p_outcome, p_payload)
    on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select * into existing from game_events where event_id = p_event_id for update;
    if existing.session_id is distinct from p_session_id
       or existing.leg_id is distinct from p_leg_id
       or existing.outcome is distinct from p_outcome
       or existing.payload is distinct from p_payload then
      raise exception 'event ID already used with different payload';
    end if;
    if existing.result is null then
      raise exception 'legacy event requires manual review';
    end if;
    return jsonb_build_object('duplicate', true, 'session', existing.result);
  end if;

  resolved := apply_leg_outcome(p_leg_id, p_outcome);
  update game_events set result = to_jsonb(resolved) where event_id = p_event_id;
  return jsonb_build_object('duplicate', false, 'session', to_jsonb(resolved));
end $$;

revoke execute on function public.process_game_event(text, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_game_event(text, uuid, uuid, text, jsonb)
  to service_role;

commit;

-- Accounts and verified wallets; existing databases use migration 002.
begin;

create table if not exists public.account_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  chain_id int not null default 11155111 check (chain_id = 11155111),
  linked_at timestamptz not null default now()
);
create table if not exists public.wallet_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  message text not null,
  expires_at timestamptz not null
);
alter table public.account_wallets enable row level security;
alter table public.wallet_challenges enable row level security;
revoke all on public.account_wallets, public.wallet_challenges from anon, authenticated;
grant all on public.account_wallets, public.wallet_challenges to service_role;

-- Called only after server-side authentication and signature verification.
create or replace function public.link_account_wallet(p_user_id uuid, p_message text)
returns public.account_wallets
language plpgsql security definer set search_path = public as $$
declare
  challenge wallet_challenges;
  linked account_wallets;
begin
  delete from wallet_challenges
    where user_id = p_user_id and message = p_message and expires_at > clock_timestamp()
    returning * into challenge;
  if not found then raise exception 'wallet challenge expired or used'; end if;
  insert into account_wallets(user_id, address)
    values(p_user_id, challenge.address)
    on conflict(user_id) do update set address = excluded.address, linked_at = now()
    returning * into linked;
  return linked;
end $$;
revoke execute on function public.link_account_wallet(uuid, text) from public, anon, authenticated;
grant execute on function public.link_account_wallet(uuid, text) to service_role;
commit;

-- Markets per session; existing databases use migration 003.
begin;

-- GTA VI is console-only, so legs are host-resolved; reach_location no longer needs coordinates.
alter table public.legs drop constraint if exists legs_type_check;
alter table public.legs add constraint legs_type_check check (
  type in ('mission_first_try', 'survive_pursuit', 'reach_location', 'wasted_free', 'custom')
);

-- parlay and leg markets resolve automatically from session and leg state;
-- over_under and multiple_choice markets are resolved by the host.
create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  position int not null,
  kind text not null check (kind in ('parlay', 'leg', 'over_under', 'multiple_choice')),
  question text not null,
  leg_id uuid unique references public.legs on delete cascade,
  -- over_under: { line, current?, final? }
  params jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'locked', 'resolved', 'void')),
  winning_outcome_id uuid,
  resolved_at timestamptz,
  unique (session_id, position),
  check ((kind = 'leg') = (leg_id is not null))
);

create table if not exists public.outcomes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets on delete cascade,
  position int not null,
  label text not null,
  unique (market_id, position)
);

alter table public.markets drop constraint if exists markets_winning_outcome_id_fkey;
alter table public.markets add constraint markets_winning_outcome_id_fkey
  foreign key (winning_outcome_id) references public.outcomes;

-- A slip now backs one outcome of one market; side is kept for older rows.
alter table public.slips add column if not exists market_id uuid references public.markets on delete cascade;
alter table public.slips add column if not exists outcome_id uuid references public.outcomes;
alter table public.slips alter column side drop not null;

alter table public.markets enable row level security;
alter table public.outcomes enable row level security;
drop policy if exists "public read" on public.markets;
create policy "public read" on public.markets for select using (true);
drop policy if exists "public read" on public.outcomes;
create policy "public read" on public.outcomes for select using (true);

alter publication supabase_realtime add table public.markets;

-- Brings automatic markets in line with session and leg state. Call with the session row locked.
-- Yes is outcome position 0 and No is position 1 for parlay and leg markets.
create or replace function public.sync_session_markets(p_session_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id;

  if s.status <> 'open' then
    update markets set status = 'locked' where session_id = p_session_id and status = 'open';
  end if;

  update markets m
     set status = 'resolved',
         resolved_at = now(),
         winning_outcome_id = (
           select o.id from outcomes o
            where o.market_id = m.id and o.position = case when l.status = 'done' then 0 else 1 end
         )
    from legs l
   where m.session_id = p_session_id and m.kind = 'leg' and l.id = m.leg_id
     and m.status = 'locked' and l.status in ('done', 'failed');

  if s.status in ('won', 'lost') then
    update markets m
       set status = 'resolved',
           resolved_at = now(),
           winning_outcome_id = (
             select o.id from outcomes o
              where o.market_id = m.id and o.position = case when s.status = 'won' then 0 else 1 end
           )
     where m.session_id = p_session_id and m.kind = 'parlay' and m.status = 'locked';

    -- Legs the streamer never reached were not attempted, so their bets are refunded.
    update markets m
       set status = 'void', resolved_at = now()
      from legs l
     where m.session_id = p_session_id and m.kind = 'leg' and l.id = m.leg_id
       and m.status = 'locked' and l.status = 'pending';
  end if;
end $$;

-- The lifecycle functions keep their signatures (process_game_event depends on
-- apply_leg_outcome) and now finish by syncing the session's markets.
create or replace function public.start_session(p_session_id uuid) returns sessions
language plpgsql security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  if s.status <> 'open' then raise exception 'session already started'; end if;
  if not exists (select 1 from legs where session_id = p_session_id) then
    raise exception 'session has no legs';
  end if;

  update sessions
     set status = 'live',
         starts_at = now(),
         ends_at = now() + make_interval(secs => duration_seconds),
         lock_at = least(lock_at, now())
   where id = p_session_id
  returning * into s;

  update legs set status = 'active'
   where session_id = p_session_id
     and position = (select min(position) from legs where session_id = p_session_id);

  perform sync_session_markets(p_session_id);
  return s;
end $$;

create or replace function public.apply_leg_outcome(p_leg_id uuid, p_outcome text) returns sessions
language plpgsql security definer set search_path = public as $$
declare
  l legs;
  s sessions;
  v_session_id uuid;
  next_leg_id uuid;
begin
  if p_outcome not in ('done', 'failed') then raise exception 'invalid outcome'; end if;

  select session_id into v_session_id from legs where id = p_leg_id;
  if v_session_id is null then raise exception 'leg not found'; end if;

  -- Lock the session row so concurrent events are applied one at a time.
  select * into s from sessions where id = v_session_id for update;
  if s.status <> 'live' then raise exception 'session is not live'; end if;

  select * into l from legs where id = p_leg_id;
  if l.status <> 'active' then raise exception 'leg is not active'; end if;

  if now() > s.ends_at or p_outcome = 'failed' then
    update legs set status = 'failed', resolved_at = now() where id = l.id;
    update sessions set status = 'lost' where id = s.id returning * into s;
  else
    update legs set status = 'done', resolved_at = now() where id = l.id;

    select id into next_leg_id from legs
     where session_id = s.id and position > l.position
     order by position limit 1;

    if next_leg_id is null then
      update sessions set status = 'won' where id = s.id returning * into s;
    else
      update legs set status = 'active' where id = next_leg_id;
    end if;
  end if;

  perform sync_session_markets(s.id);
  return s;
end $$;

create or replace function public.expire_session(p_session_id uuid) returns sessions
language plpgsql security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  if s.status <> 'live' or now() <= s.ends_at then return s; end if;

  update legs set status = 'failed', resolved_at = now()
   where session_id = p_session_id and status = 'active';
  update sessions set status = 'lost' where id = p_session_id returning * into s;

  perform sync_session_markets(p_session_id);
  return s;
end $$;

-- Host resolution for over_under and multiple_choice markets. Allowed once betting has
-- locked, including after the session ends, since side markets can settle later.
create or replace function public.resolve_market(p_market_id uuid, p_outcome_id uuid) returns markets
language plpgsql security definer set search_path = public as $$
declare
  m markets;
  v_session_id uuid;
begin
  select session_id into v_session_id from markets where id = p_market_id;
  if v_session_id is null then raise exception 'market not found'; end if;
  perform 1 from sessions where id = v_session_id for update;

  select * into m from markets where id = p_market_id;
  if m.kind not in ('over_under', 'multiple_choice') then raise exception 'market resolves automatically'; end if;
  if m.status = 'open' then raise exception 'market is still open'; end if;
  if m.status <> 'locked' then raise exception 'market already settled'; end if;
  if not exists (select 1 from outcomes where id = p_outcome_id and market_id = p_market_id) then
    raise exception 'outcome does not belong to market';
  end if;

  update markets
     set status = 'resolved', winning_outcome_id = p_outcome_id, resolved_at = now()
   where id = p_market_id
  returning * into m;
  return m;
end $$;

-- Cancels a market so its bets can be refunded.
create or replace function public.void_market(p_market_id uuid) returns markets
language plpgsql security definer set search_path = public as $$
declare
  m markets;
  v_session_id uuid;
begin
  select session_id into v_session_id from markets where id = p_market_id;
  if v_session_id is null then raise exception 'market not found'; end if;
  perform 1 from sessions where id = v_session_id for update;

  select * into m from markets where id = p_market_id;
  if m.status not in ('open', 'locked') then raise exception 'market already settled'; end if;

  update markets set status = 'void', resolved_at = now() where id = p_market_id returning * into m;
  return m;
end $$;

revoke execute on function public.sync_session_markets(uuid), public.start_session(uuid),
  public.apply_leg_outcome(uuid, text), public.expire_session(uuid),
  public.resolve_market(uuid, uuid), public.void_market(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_session_markets(uuid), public.start_session(uuid),
  public.apply_leg_outcome(uuid, text), public.expire_session(uuid),
  public.resolve_market(uuid, uuid), public.void_market(uuid)
  to service_role;

commit;
