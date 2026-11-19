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
