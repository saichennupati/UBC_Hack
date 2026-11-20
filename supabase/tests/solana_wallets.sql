-- Run after schema.sql (or migration 005) in a test project. All fixtures are rolled back.
begin;
do $$
declare
  first_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  -- Mixed case on purpose: Solana addresses are case-sensitive and must be stored verbatim.
  wallet text := 'GY3icm8xwekg1qLwZT5aYBZnCGbUpK8DS99C8czMVdD4';
begin
  insert into auth.users(id) values(first_user), (second_user);
  insert into solana_wallet_challenges(user_id, address, message, expires_at)
    values(first_user, wallet, 'first-message', now() + interval '5 minutes');
  perform link_solana_wallet(first_user, 'first-message');
  assert (select address = wallet and cluster = 'devnet' from solana_wallets where user_id = first_user);
  assert not exists(select 1 from solana_wallet_challenges where user_id = first_user);
  begin
    perform link_solana_wallet(first_user, 'first-message');
    raise exception 'test: replay accepted';
  exception when raise_exception then
    if sqlerrm <> 'wallet challenge expired or used' then raise; end if;
  end;

  insert into solana_wallet_challenges(user_id, address, message, expires_at)
    values(second_user, wallet, 'second-message', now() + interval '5 minutes');
  begin
    perform link_solana_wallet(second_user, 'second-message');
    raise exception 'test: wallet linked to two accounts';
  exception when unique_violation then null;
  end;
  assert exists(select 1 from solana_wallet_challenges where user_id = second_user), 'failed link must roll back consumption';
  assert not exists(select 1 from solana_wallets where user_id = second_user);

  update solana_wallet_challenges set expires_at = now() - interval '1 second' where user_id = second_user;
  begin
    perform link_solana_wallet(second_user, 'second-message');
    raise exception 'test: expired challenge accepted';
  exception when raise_exception then
    if sqlerrm <> 'wallet challenge expired or used' then raise; end if;
  end;

  -- Ethereum-style and malformed addresses are rejected by the table itself.
  begin
    insert into solana_wallets(user_id, address) values(second_user, '0x' || repeat('a', 40));
    raise exception 'test: accepted an Ethereum address';
  exception when check_violation then null;
  end;

  -- An account can hold one Ethereum and one Solana wallet at the same time.
  insert into account_wallets(user_id, address) values(first_user, '0x' || repeat('b', 40));
  assert exists(select 1 from solana_wallets where user_id = first_user);

  assert not has_function_privilege('anon', 'public.link_solana_wallet(uuid,text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.link_solana_wallet(uuid,text)', 'execute');
  assert not has_table_privilege('authenticated', 'public.solana_wallets', 'insert');
  assert not has_table_privilege('anon', 'public.solana_wallet_challenges', 'select');
end $$;
rollback;
