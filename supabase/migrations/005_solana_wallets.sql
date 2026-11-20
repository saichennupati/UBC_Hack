-- Solana (devnet) wallet linking alongside the Ethereum wallet from migration 002.
begin;

-- Base58 addresses are case-sensitive, so they are stored exactly as the wallet reports them.
create table if not exists public.solana_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  cluster text not null default 'devnet' check (cluster = 'devnet'),
  linked_at timestamptz not null default now()
);
create table if not exists public.solana_wallet_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  message text not null,
  expires_at timestamptz not null
);
alter table public.solana_wallets enable row level security;
alter table public.solana_wallet_challenges enable row level security;
revoke all on public.solana_wallets, public.solana_wallet_challenges from anon, authenticated;
grant all on public.solana_wallets, public.solana_wallet_challenges to service_role;

-- Called only after server-side authentication and signature verification.
create or replace function public.link_solana_wallet(p_user_id uuid, p_message text)
returns public.solana_wallets
language plpgsql security definer set search_path = public as $$
declare
  challenge solana_wallet_challenges;
  linked solana_wallets;
begin
  delete from solana_wallet_challenges
    where user_id = p_user_id and message = p_message and expires_at > clock_timestamp()
    returning * into challenge;
  if not found then raise exception 'wallet challenge expired or used'; end if;
  insert into solana_wallets(user_id, address)
    values(p_user_id, challenge.address)
    on conflict(user_id) do update set address = excluded.address, linked_at = now()
    returning * into linked;
  return linked;
end $$;
revoke execute on function public.link_solana_wallet(uuid, text) from public, anon, authenticated;
grant execute on function public.link_solana_wallet(uuid, text) to service_role;
commit;
