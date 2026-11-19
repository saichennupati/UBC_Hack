-- Multiple markets per session. Apply to an existing database after migrations 001 and 002.
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
