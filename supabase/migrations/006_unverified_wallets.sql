-- Lets accounts link a pasted wallet address without signing. Apply after migrations 002 and 005.
-- Pasted addresses are stored as unverified; signing with the wallet marks them verified.
-- Only verified addresses are unique, so pasting someone else's address can't block its owner.
begin;

alter table public.account_wallets add column if not exists verified boolean not null default true;
alter table public.solana_wallets add column if not exists verified boolean not null default true;

alter table public.account_wallets drop constraint if exists account_wallets_address_key;
alter table public.solana_wallets drop constraint if exists solana_wallets_address_key;
create unique index if not exists account_wallets_verified_address on public.account_wallets(address) where verified;
create unique index if not exists solana_wallets_verified_address on public.solana_wallets(address) where verified;

-- Signature-verified links (same contract as migrations 002 and 005) now also mark the wallet verified.
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
  insert into account_wallets(user_id, address, verified)
    values(p_user_id, challenge.address, true)
    on conflict(user_id) do update set address = excluded.address, verified = true, linked_at = now()
    returning * into linked;
  return linked;
end $$;

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
  insert into solana_wallets(user_id, address, verified)
    values(p_user_id, challenge.address, true)
    on conflict(user_id) do update set address = excluded.address, verified = true, linked_at = now()
    returning * into linked;
  return linked;
end $$;

-- Pasted links. Re-pasting the account's already-verified address keeps it verified;
-- a different address replaces it as unverified.
create or replace function public.link_unverified_account_wallet(p_user_id uuid, p_address text)
returns public.account_wallets
language plpgsql security definer set search_path = public as $$
declare
  linked account_wallets;
begin
  insert into account_wallets(user_id, address, verified)
    values(p_user_id, p_address, false)
    on conflict(user_id) do update set
      verified = account_wallets.verified and account_wallets.address = excluded.address,
      linked_at = case when account_wallets.address = excluded.address then account_wallets.linked_at else now() end,
      address = excluded.address
    returning * into linked;
  return linked;
end $$;

create or replace function public.link_unverified_solana_wallet(p_user_id uuid, p_address text)
returns public.solana_wallets
language plpgsql security definer set search_path = public as $$
declare
  linked solana_wallets;
begin
  insert into solana_wallets(user_id, address, verified)
    values(p_user_id, p_address, false)
    on conflict(user_id) do update set
      verified = solana_wallets.verified and solana_wallets.address = excluded.address,
      linked_at = case when solana_wallets.address = excluded.address then solana_wallets.linked_at else now() end,
      address = excluded.address
    returning * into linked;
  return linked;
end $$;

revoke execute on function public.link_unverified_account_wallet(uuid, text), public.link_unverified_solana_wallet(uuid, text)
  from public, anon, authenticated;
grant execute on function public.link_unverified_account_wallet(uuid, text), public.link_unverified_solana_wallet(uuid, text)
  to service_role;

commit;
