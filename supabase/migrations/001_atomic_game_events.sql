-- Apply to an existing database before deploying the updated game-event API.
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
