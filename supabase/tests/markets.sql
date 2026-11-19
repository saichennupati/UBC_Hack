-- Run after schema.sql (or migration 003) in a test database / SQL editor.
-- All fixtures are rolled back. Any failed assertion aborts the transaction.
begin;
do $$
declare
  s uuid;
  leg1 uuid;
  leg2 uuid;
  leg3 uuid;
  parlay uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  ou uuid;
  mc uuid;
  ou_over uuid;
  mc_first uuid;
  stranger uuid;

  function_outcome uuid;
begin
  insert into sessions(title, duration_seconds, lock_at)
    values ('markets test', 60, now() + interval '5 minutes') returning id into s;
  insert into legs(session_id, position, type, label) values (s, 0, 'mission_first_try', 'one') returning id into leg1;
  insert into legs(session_id, position, type, label) values (s, 1, 'survive_pursuit', 'two') returning id into leg2;
  insert into legs(session_id, position, type, label) values (s, 2, 'custom', 'three') returning id into leg3;

  insert into markets(session_id, position, kind, question) values (s, 0, 'parlay', 'all') returning id into parlay;
  insert into markets(session_id, position, kind, question, leg_id) values (s, 1, 'leg', 'one', leg1) returning id into m1;
  insert into markets(session_id, position, kind, question, leg_id) values (s, 2, 'leg', 'two', leg2) returning id into m2;
  insert into markets(session_id, position, kind, question, leg_id) values (s, 3, 'leg', 'three', leg3) returning id into m3;
  insert into markets(session_id, position, kind, question, params)
    values (s, 4, 'over_under', 'deaths', '{"line": 2.5}') returning id into ou;
  insert into markets(session_id, position, kind, question) values (s, 5, 'multiple_choice', 'ending') returning id into mc;
  insert into outcomes(market_id, position, label)
    select id, p, case p when 0 then 'Yes' else 'No' end
      from unnest(array[parlay, m1, m2, m3]) id, generate_series(0, 1) p;
  insert into outcomes(market_id, position, label) values (ou, 0, 'Over') returning id into ou_over;
  insert into outcomes(market_id, position, label) values (ou, 1, 'Under');
  insert into outcomes(market_id, position, label) values (mc, 0, 'Wasted') returning id into mc_first;
  insert into outcomes(market_id, position, label) values (mc, 1, 'Busted');

  -- Host markets cannot settle while betting is open; automatic markets never settle by hand.
  begin
    perform resolve_market(ou, ou_over);
    raise exception 'test: resolved an open market';
  exception when raise_exception then
    if sqlerrm <> 'market is still open' then raise; end if;
  end;
  begin
    perform resolve_market(parlay, (select id from outcomes where market_id = parlay and position = 0));
    raise exception 'test: hand-resolved a parlay market';
  exception when raise_exception then
    if sqlerrm <> 'market resolves automatically' then raise; end if;
  end;

  perform start_session(s);
  assert not exists (select 1 from markets where session_id = s and status <> 'locked'), 'start must lock every market';

  -- Leg 1 succeeds: its market resolves Yes, nothing else settles.
  perform apply_leg_outcome(leg1, 'done');
  assert (select status = 'resolved' from markets where id = m1);
  assert (select o.position = 0 from markets m join outcomes o on o.id = m.winning_outcome_id where m.id = m1);
  assert (select status = 'locked' from markets where id = parlay);

  -- Leg 2 fails: its market resolves No, the parlay resolves No, the unreached leg 3 is voided.
  perform apply_leg_outcome(leg2, 'failed');
  assert (select o.position = 1 from markets m join outcomes o on o.id = m.winning_outcome_id where m.id = m2);
  assert (select o.position = 1 from markets m join outcomes o on o.id = m.winning_outcome_id where m.id = parlay);
  assert (select status = 'void' from markets where id = m3);
  assert (select status = 'locked' from markets where id = ou), 'host markets wait for the host';

  -- Host settles side markets after the session ends; outcomes must belong to the market.
  begin
    perform resolve_market(ou, mc_first);
    raise exception 'test: accepted an outcome from another market';
  exception when raise_exception then
    if sqlerrm <> 'outcome does not belong to market' then raise; end if;
  end;
  perform resolve_market(ou, ou_over);
  assert (select winning_outcome_id = ou_over from markets where id = ou);
  begin
    perform resolve_market(ou, ou_over);
    raise exception 'test: resolved a market twice';
  exception when raise_exception then
    if sqlerrm <> 'market already settled' then raise; end if;
  end;

  perform void_market(mc);
  assert (select status = 'void' from markets where id = mc);
  begin
    perform void_market(mc);
    raise exception 'test: voided a market twice';
  exception when raise_exception then
    if sqlerrm <> 'market already settled' then raise; end if;
  end;

  -- A winning run resolves every leg market and the parlay Yes.
  insert into sessions(title, duration_seconds, lock_at)
    values ('markets win test', 60, now()) returning id into stranger;
  insert into legs(session_id, position, type, label) values (stranger, 0, 'wasted_free', 'solo') returning id into leg1;
  insert into markets(session_id, position, kind, question) values (stranger, 0, 'parlay', 'all') returning id into parlay;
  insert into markets(session_id, position, kind, question, leg_id) values (stranger, 1, 'leg', 'solo', leg1) returning id into m1;
  insert into outcomes(market_id, position, label)
    select id, p, case p when 0 then 'Yes' else 'No' end from unnest(array[parlay, m1]) id, generate_series(0, 1) p;
  perform start_session(stranger);
  perform apply_leg_outcome(leg1, 'done');
  select winning_outcome_id into function_outcome from markets where id = parlay;
  assert (select position = 0 from outcomes where id = function_outcome), 'won session must resolve parlay Yes';

  -- Expiry fails the active leg and resolves its market No.
  insert into sessions(title, duration_seconds, lock_at)
    values ('markets expiry test', 60, now()) returning id into stranger;
  insert into legs(session_id, position, type, label) values (stranger, 0, 'custom', 'slow') returning id into leg1;
  insert into markets(session_id, position, kind, question, leg_id) values (stranger, 0, 'leg', 'slow', leg1) returning id into m1;
  insert into outcomes(market_id, position, label)
    select m1, p, case p when 0 then 'Yes' else 'No' end from generate_series(0, 1) p;
  perform start_session(stranger);
  update sessions set ends_at = now() - interval '1 second' where id = stranger;
  perform expire_session(stranger);
  assert (select o.position = 1 from markets m join outcomes o on o.id = m.winning_outcome_id where m.id = m1);
end $$;
rollback;
