-- HIGH THOUGHTS: the credit ledger.
--
-- Everything a creation costs money for lives here. Three rules shape it:
--
--   1. The tables sit in a schema PostgREST does not expose, so no API key
--      reaches them directly. All access goes through the functions below.
--   2. A spend is one conditional UPDATE. Two requests racing for the last
--      credit cannot both win, which is the bug the JSON file could not fix.
--   3. Tokens arrive already hashed. The database never sees a spendable
--      secret, so a database dump is not a wallet.

create schema if not exists high_thoughts;

-- Nothing but the owner and the service role should be able to name the
-- schema, let alone read it.
revoke all on schema high_thoughts from public;

create table if not exists high_thoughts.accounts (
  token_hash  text primary key,
  credits     integer     not null default 0 check (credits >= 0),
  spent       integer     not null default 0 check (spent >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Who has already had their free creation. The claim hash is a salted hash of
-- whatever identified a first-time visitor, so this table holds no addresses
-- and no identities — only the fact that one key has been used.
create table if not exists high_thoughts.free_claims (
  claim_hash  text primary key,
  token_hash  text        not null references high_thoughts.accounts (token_hash) on delete cascade,
  claimed_at  timestamptz not null default now()
);

alter table high_thoughts.accounts    enable row level security;
alter table high_thoughts.free_claims enable row level security;
-- No policies, deliberately. Every path in runs through a function owned by
-- the definer below, so there is no legitimate direct reader to write one for.


-- Spend one credit.
--
-- The WHERE clause carries the balance check, so the database — not the
-- server — is what makes a spend atomic.
create or replace function public.ht_redeem(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = high_thoughts, pg_temp
as $$
declare
  v_remaining integer;
begin
  update accounts
     set credits = credits - 1,
         spent   = spent + 1,
         updated_at = now()
   where token_hash = p_token_hash
     and credits >= 1
  returning credits into v_remaining;

  if v_remaining is not null then
    return jsonb_build_object('ok', true, 'remaining', v_remaining);
  end if;

  if exists (select 1 from accounts where token_hash = p_token_hash) then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'unknown');
end;
$$;


-- Hand a credit back when a creation fails. Silent on an unknown token: the
-- caller is refunding something it already charged, and there is nothing
-- useful it could do with the complaint.
create or replace function public.ht_refund(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = high_thoughts, pg_temp
as $$
declare
  v_remaining integer;
begin
  update accounts
     set credits = credits + 1,
         spent   = greatest(0, spent - 1),
         updated_at = now()
   where token_hash = p_token_hash
  returning credits into v_remaining;

  return jsonb_build_object('ok', v_remaining is not null, 'remaining', coalesce(v_remaining, 0));
end;
$$;


-- Add credits, creating the account if needed. This is what a payment calls.
create or replace function public.ht_grant(p_token_hash text, p_credits integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = high_thoughts, pg_temp
as $$
declare
  v_credits integer;
begin
  if p_credits is null or p_credits < 1 then
    raise exception 'credits must be a positive integer';
  end if;

  insert into accounts (token_hash, credits, note)
       values (p_token_hash, p_credits, p_note)
  on conflict (token_hash) do update
       set credits = accounts.credits + excluded.credits,
           note    = coalesce(excluded.note, accounts.note),
           updated_at = now()
  returning credits into v_credits;

  return jsonb_build_object('credits', v_credits);
end;
$$;


-- The free first creation, once per claim key.
--
-- The primary key on free_claims is the whole mechanism: two simultaneous
-- claims for one key means one insert wins and the other reads as 'already'.
create or replace function public.ht_claim_free(p_claim_hash text, p_token_hash text, p_credits integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = high_thoughts, pg_temp
as $$
begin
  if exists (select 1 from free_claims where claim_hash = p_claim_hash) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  insert into accounts (token_hash, credits, note)
       values (p_token_hash, greatest(1, coalesce(p_credits, 1)), 'free first creation');

  insert into free_claims (claim_hash, token_hash)
       values (p_claim_hash, p_token_hash);

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    -- Lost the race. The other caller has the token; this one gets nothing,
    -- and the account row inserted above rolls back with the exception.
    return jsonb_build_object('ok', false, 'reason', 'already');
end;
$$;


-- Balance and existence in one call, because the phone always wants both.
create or replace function public.ht_account(p_token_hash text)
returns jsonb
language sql
security definer
set search_path = high_thoughts, pg_temp
as $$
  select jsonb_build_object(
    'credits', coalesce((select credits from accounts where token_hash = p_token_hash), 0),
    'known',   exists (select 1 from accounts where token_hash = p_token_hash)
  );
$$;


-- For the startup banner, so it is obvious the server is talking to the right
-- database before anybody tries to spend anything.
create or replace function public.ht_stats()
returns jsonb
language sql
security definer
set search_path = high_thoughts, pg_temp
as $$
  select jsonb_build_object(
    'accounts', (select count(*) from accounts),
    'claims',   (select count(*) from free_claims)
  );
$$;


-- Functions are granted to PUBLIC by default, and these run as their owner.
-- Leaving that in place would let anyone holding the publishable key mint
-- credits, which is the one thing this whole file exists to prevent.
do $$
declare
  v_signature text;
begin
  for v_signature in
    select format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ht_redeem', 'ht_refund', 'ht_grant', 'ht_claim_free', 'ht_account', 'ht_stats')
  loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('revoke all on function %s from authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;
