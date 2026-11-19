-- Run after schema.sql (or migration 001) in a test database / SQL editor.
-- All fixtures are rolled back. Any failed assertion aborts the transaction.
begin;
do $$
declare
  s uuid;
  other uuid;
  first_leg uuid;
  second_leg uuid;
  receipt jsonb;
  retry jsonb;
  event_key text := gen_random_uuid()::text;
begin
  insert into sessions(title, duration_seconds, lock_at)
    values ('event reliability test', 60, now()) returning id into s;
  insert into sessions(title, duration_seconds, lock_at)
    values ('other session', 60, now()) returning id into other;
  insert into legs(session_id, position, type, label)
    values(s, 0, 'mission_first_try', 'first') returning id into first_leg;
  insert into legs(session_id, position, type, label)
    values(s, 1, 'survive_pursuit', 'second') returning id into second_leg;

  -- A failed attempt must not consume the event ID.
  begin
    perform process_game_event(event_key, s, first_leg, 'done', '{}');
    raise exception 'test: accepted an event before session start';
  exception when raise_exception then
    if sqlerrm <> 'session is not live' then raise; end if;
  end;
  assert not exists(select 1 from game_events where event_id = event_key), 'failed event was retained';

  perform start_session(s);
  assert (select status = 'active' from legs where id = first_leg);
  begin
    perform process_game_event(event_key, other, first_leg, 'done', '{}');
    raise exception 'test: accepted mismatched session';
  exception when raise_exception then
    if sqlerrm <> 'leg does not belong to session' then raise; end if;
  end;
  begin
    perform process_game_event(event_key, s, second_leg, 'done', '{}');
    raise exception 'test: accepted out-of-order leg';
  exception when raise_exception then
    if sqlerrm <> 'leg is not active' then raise; end if;
  end;

  receipt := process_game_event(event_key, s, first_leg, 'done', '{}');
  assert receipt->>'duplicate' = 'false';
  assert (select status = 'done' from legs where id = first_leg);
  assert (select status = 'active' from legs where id = second_leg);
  retry := process_game_event(event_key, s, first_leg, 'done', '{}');
  assert retry->>'duplicate' = 'true';
  assert retry->'session' = receipt->'session';
  begin
    perform process_game_event(event_key, s, first_leg, 'failed', '{}');
    raise exception 'test: accepted reused ID with different outcome';
  exception when raise_exception then
    if sqlerrm <> 'event ID already used with different payload' then raise; end if;
  end;
  perform process_game_event(event_key || '-end', s, second_leg, 'done', '{}');
  assert (select status = 'won' from sessions where id = s);
  retry := process_game_event(event_key, s, first_leg, 'done', '{}');
  assert retry->'session' = receipt->'session', 'retry must return original receipt';

  -- Reuse the fixture to test failure and expiration paths.
  update sessions set status = 'live', ends_at = now() + interval '1 minute' where id = s;
  update legs set status = 'active' where id = second_leg;
  perform process_game_event(event_key || '-fail', s, second_leg, 'failed', '{}');
  assert (select status = 'lost' from sessions where id = s);
  update sessions set status = 'live', ends_at = now() - interval '1 second' where id = s;
  update legs set status = 'active' where id = second_leg;
  perform process_game_event(event_key || '-late', s, second_leg, 'done', '{}');
  assert (select status = 'lost' from sessions where id = s);
  assert (select status = 'failed' from legs where id = second_leg);

  insert into game_events(event_id, session_id, leg_id, outcome, payload)
    values(event_key || '-legacy', s, second_leg, 'done', '{}');
  begin
    perform process_game_event(event_key || '-legacy', s, second_leg, 'done', '{}');
    raise exception 'test: acknowledged unverified legacy event';
  exception when raise_exception then
    if sqlerrm <> 'legacy event requires manual review' then raise; end if;
  end;
end $$;
rollback;
