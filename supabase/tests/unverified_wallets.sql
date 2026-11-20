-- Run after migration 006 (or schema.sql) in a test project. All fixtures are rolled back.
begin;
do $$
declare
  owner uuid := gen_random_uuid();
  squatter uuid := gen_random_uuid();
  sol text := 'GY3icm8xwekg1qLwZT5aYBZnCGbUpK8DS99C8czMVdD4';
  eth text := '0x' || repeat('c', 40);
begin
  insert into auth.users(id) values(owner), (squatter);

  -- Pasting stores an unverified link.
  perform link_unverified_solana_wallet(squatter, sol);
  assert (select address = sol and not verified from solana_wallets where user_id = squatter);
  perform link_unverified_account_wallet(squatter, eth);
  assert (select address = eth and not verified from account_wallets where user_id = squatter);

  -- Someone else's unverified paste never blocks the real owner from verifying.
  perform link_unverified_solana_wallet(owner, sol);
  insert into solana_wallet_challenges(user_id, address, message, expires_at)
    values(owner, sol, 'owner-message', now() + interval '5 minutes');
  perform link_solana_wallet(owner, 'owner-message');
  assert (select verified from solana_wallets where user_id = owner);
  assert (select not verified from solana_wallets where user_id = squatter), 'squatter stays unverified';

  -- Only one account can hold an address as verified.
  insert into solana_wallet_challenges(user_id, address, message, expires_at)
    values(squatter, sol, 'squatter-message', now() + interval '5 minutes');
  begin
    perform link_solana_wallet(squatter, 'squatter-message');
    raise exception 'test: address verified by two accounts';
  exception when unique_violation then null;
  end;

  -- Re-pasting your own verified address keeps it verified; a new address resets to unverified.
  perform link_unverified_solana_wallet(owner, sol);
  assert (select verified from solana_wallets where user_id = owner), 're-paste must not downgrade';
  perform link_unverified_solana_wallet(owner, '11111111111111111111111111111111');
  assert (select address = '11111111111111111111111111111111' and not verified from solana_wallets where user_id = owner);

  -- The address checks still reject the wrong chain's format.
  begin
    perform link_unverified_account_wallet(owner, sol);
    raise exception 'test: accepted a Solana address as Ethereum';
  exception when check_violation then null;
  end;

  assert not has_function_privilege('anon', 'public.link_unverified_solana_wallet(uuid,text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.link_unverified_account_wallet(uuid,text)', 'execute');
end $$;
rollback;
