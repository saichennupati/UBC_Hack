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

-- Raw audit log of everything the game mod sent; event_id makes delivery idempotent.
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
