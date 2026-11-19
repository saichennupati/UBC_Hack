-- Use a test project. All fixtures are rolled back.
begin;
do $$
declare
  first_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  wallet text := '0x' || replace(gen_random_uuid()::text, '-', '') || '12345678';
begin
  insert into auth.users(id) values(first_user), (second_user);
  insert into wallet_challenges(user_id, address, message, expires_at)
    values(first_user, wallet, 'first-message', now() + interval '5 minutes');
  perform link_account_wallet(first_user, 'first-message');
  assert (select address = wallet from account_wallets where user_id = first_user);
  assert not exists(select 1 from wallet_challenges where user_id = first_user);
  begin
    perform link_account_wallet(first_user, 'first-message');
    raise exception 'test: replay accepted';
  exception when raise_exception then
    if sqlerrm <> 'wallet challenge expired or used' then raise; end if;
  end;

  insert into wallet_challenges(user_id, address, message, expires_at)
    values(second_user, wallet, 'second-message', now() + interval '5 minutes');
  begin
    perform link_account_wallet(second_user, 'second-message');
    raise exception 'test: wallet linked to two accounts';
  exception when unique_violation then null;
  end;
  assert exists(select 1 from wallet_challenges where user_id = second_user), 'failed link must roll back consumption';
  assert not exists(select 1 from account_wallets where user_id = second_user);

  begin
    perform link_account_wallet(second_user, 'first-message');
    raise exception 'test: wrong account challenge accepted';
  exception when raise_exception then
    if sqlerrm <> 'wallet challenge expired or used' then raise; end if;
  end;
  update wallet_challenges set expires_at = now() - interval '1 second' where user_id = second_user;
  begin
    perform link_account_wallet(second_user, 'second-message');
    raise exception 'test: expired challenge accepted';
  exception when raise_exception then
    if sqlerrm <> 'wallet challenge expired or used' then raise; end if;
  end;
  assert not has_function_privilege('anon', 'public.link_account_wallet(uuid,text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.link_account_wallet(uuid,text)', 'execute');
  assert not has_table_privilege('authenticated', 'public.account_wallets', 'insert');
  assert not has_table_privilege('anon', 'public.wallet_challenges', 'select');
end $$;
rollback;
