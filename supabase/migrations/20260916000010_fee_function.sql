-- =============================================================================
-- Kade — the pre-approval fee becomes recomputable inside the database.
--
-- Why this exists
--   `fee_schedule` stored only a single `amount`. For the pre-approval row that
--   amount was the household-size-1 fee (1.25 demo / 335 production USDC), and
--   the per-member increment the frozen formula needs was nowhere in the table,
--   so no database function could recompute the fee. The DOCX section 9
--   (`household_members`: "DB function recomputes the pre-approval fee") and
--   contract section 2.1 require exactly that recomputation.
--
-- What this migration does
--   1. extends `fee_schedule` with the formula parameters as data;
--   2. adds `public.preapproval_fee_usdc(mode, household_size)`;
--   3. recomputes `applications.preapproval_usdc` from `household_members` and
--      on application creation, SECURITY DEFINER, because the authenticated
--      role has no column privilege on `preapproval_usdc` (D2).
--
-- Drift control
--   The arithmetic is not copy-pasted from `preapprovalFeeUsdc()` in
--   `@kade/shared`. `scripts/db/seed-sql.ts` asserts, before it emits a single
--   row, that the seeded parameters reproduce `preapprovalFeeUsdc()` for
--   household sizes 1-1000, and then the seed is what populates this table (ADR
--   0005). The two formulas first diverge at size 13,200, far beyond any real
--   household, so the stated bound is the honest one.
--   If the two ever disagree, seed generation fails loudly.
--
-- Parameters chosen
--   `base_amount`       constant component, USDC
--   `per_member_amount` increment per household member, USDC
--   `rounding_scale`    decimal places the result is rounded to
--   Formula: round(base_amount + per_member_amount * household_size,
--                  rounding_scale)
--
--   The demo formula is exact to the cent (1.75 -> rounding_scale 2). The
--   production formula is the documented XCG table divided by the CBCS peg and
--   rounded to whole USDC (447 -> rounding_scale 0); the XCG values are folded
--   into the USDC parameters by the seed generator, which also keeps the
--   original `amount` (the household-size-1 fee) working unchanged.
--
--   Like the rest of `fee_schedule`, the new columns are populated by the
--   regenerated seed, which is the authoritative writer (ADR 0005); adding a
--   column uses a constant default, so a database that runs this migration but
--   not the seed has zero formula parameters rather than a stale fee. No data
--   backfill is written here, because there is no way to recover the per-member
--   increment from the old `amount` and re-typing the parameters would create a
--   second copy that can drift from the seed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. fee_schedule: the formula parameters are data.
--
-- `amount` is retained unchanged: the household-size-1 fee for the
-- pre-approval key, or the flat fee for the service key, in `currency`. It is
-- now a derived convenience value; the seed generator asserts it equals
-- round(base_amount + per_member_amount, rounding_scale) for every row.
-- ---------------------------------------------------------------------------
alter table public.fee_schedule
  add column base_amount numeric(20, 6) not null default 0,
  add column per_member_amount numeric(20, 6) not null default 0,
  add column rounding_scale integer not null default 2
    constraint fee_schedule_rounding_scale_range check (rounding_scale between 0 and 6);

comment on column public.fee_schedule.amount is
  'Household-size-1 fee (pre-approval) or flat fee (service) in `currency`, '
  'kept for backward compatibility. Derived from the formula parameters; the '
  'seed generator asserts it equals round(base_amount + per_member_amount, '
  'rounding_scale) for pre-approval rows.';
comment on column public.fee_schedule.base_amount is
  'Constant component of the fee formula, in `currency` (USDC). The production '
  'base is the documented XCG 500 divided by the CBCS peg. [documented] '
  'contract section 2.1 / DOCX section 7.';
comment on column public.fee_schedule.per_member_amount is
  'Increment applied per household member (the applicant included) in '
  '`currency` (USDC). This is the parameter the old schedule was missing. '
  '[documented] contract section 2.1: 0.25 demo, XCG 100 production.';
comment on column public.fee_schedule.rounding_scale is
  'Decimal places the recomputed fee is rounded to. [documented] the worked '
  'examples require 2 for demo (1.75) and 0 for production (447).';
comment on table public.fee_schedule is
  'Active fee configuration (DOCX sections 7 and 9). A single env var '
  '(KADE_FEE_MODE) selects demo or production; no amount is hard-coded in the '
  'client (contract section 2.1, ADR 0005). The pre-approval fee is recomputed '
  'from these rows by public.preapproval_fee_usdc().';

-- ---------------------------------------------------------------------------
-- 2. The fee as a queryable function.
--
-- SECURITY INVOKER: it reads only `fee_schedule`, which authenticated may
-- already read, so it grants no new capability. Input validation mirrors the
-- RangeError in preapprovalFeeUsdc() so an invalid size cannot silently return
-- a value the shared implementation would reject.
-- ---------------------------------------------------------------------------
create or replace function public.preapproval_fee_usdc(
  p_mode text,
  p_household_size integer
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fee numeric;
begin
  if p_household_size is null or p_household_size < 1 then
    raise exception 'household_size must be an integer >= 1, received %',
      p_household_size
      using errcode = '22023';
  end if;

  select round(
           s.base_amount + s.per_member_amount * p_household_size,
           s.rounding_scale
         )
    into v_fee
    from public.fee_schedule s
   where s.mode = p_mode
     and s.key = 'preapproval';

  if v_fee is null then
    raise exception 'no pre-approval fee configured for mode %', p_mode
      using errcode = '22023';
  end if;

  return v_fee;
end;
$$;

comment on function public.preapproval_fee_usdc(text, integer) is
  'Pre-approval fee in USDC for (mode, household_size), computed from the '
  'seeded fee_schedule parameters. household_size includes the applicant '
  '(contract section 2.1). Authoritative for the D2 recomputation; the client '
  'may display the result but cannot override it.';

-- ---------------------------------------------------------------------------
-- 3. Recompute applications.preapproval_usdc.
--
-- SECURITY DEFINER: `preapproval_usdc` is removed from the authenticated
-- column privileges (20260916000009_rls.sql), so a resident-triggered write
-- only succeeds when it runs as the definer. search_path is pinned.
--
-- Active mode: contract section 2.1 says one environment variable selects the
-- mode. `KADE_FEE_MODE` is the application-side variable; the database mirror
-- is the `kade.fee_mode` setting. The default 'demo' matches the application
-- default (apps/web/src/lib/env.ts, contract section 2.1 iteration 1). The
-- setting name is [arbitrary]; the mapping to the env var is deliberate.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_application_preapproval_fee(
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := coalesce(
    nullif(current_setting('kade.fee_mode', true), ''),
    'demo'
  );
  v_size integer;
begin
  if p_application_id is null then
    return;
  end if;

  -- The applicant is included in the size that drives the multiplier.
  select 1 + count(*)
    into v_size
    from public.household_members h
   where h.application_id = p_application_id;

  update public.applications
     set preapproval_usdc = public.preapproval_fee_usdc(v_mode, v_size)
   where id = p_application_id;
end;
$$;

comment on function public.recompute_application_preapproval_fee(uuid) is
  'Recomputes applications.preapproval_usdc from the active schedule. SECURITY '
  'DEFINER because the authenticated role cannot write that protected column.';

-- Household changes: insert, delete, and an update that moves a member to a
-- different application (then both applications are recomputed).
create or replace function public.recompute_preapproval_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recompute_application_preapproval_fee(new.application_id);
  elsif tg_op = 'DELETE' then
    perform public.recompute_application_preapproval_fee(old.application_id);
  else
    perform public.recompute_application_preapproval_fee(new.application_id);
    if new.application_id is distinct from old.application_id then
      perform public.recompute_application_preapproval_fee(old.application_id);
    end if;
  end if;
  return null;
end;
$$;

comment on function public.recompute_preapproval_fee() is
  'AFTER INSERT/UPDATE/DELETE trigger on household_members: keeps '
  'applications.preapproval_usdc in step with the active fee schedule and the '
  'household size (DOCX section 9).';

create trigger household_members_recompute_preapproval_fee
  after insert or update or delete on public.household_members
  for each row execute function public.recompute_preapproval_fee();

-- An application with no household_members rows still has a household size of
-- one, because the applicant is included. Nothing else would set the initial
-- fee, so initialise it on creation rather than leaving it NULL until the
-- first additional member is added.
create or replace function public.init_preapproval_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recompute_application_preapproval_fee(new.id);
  return null;
end;
$$;

comment on function public.init_preapproval_fee() is
  'AFTER INSERT trigger on applications: sets the size-1 pre-approval fee so '
  'an applicant-only household is never left with NULL.';

create trigger applications_init_preapproval_fee
  after insert on public.applications
  for each row execute function public.init_preapproval_fee();

-- ---------------------------------------------------------------------------
-- 4. Privileges.
--
-- The fee is not secret (authenticated may already read fee_schedule), so the
-- queryable function is granted to authenticated. The trigger helpers are
-- internal: they only need to be executable by their owner, who is also the
-- definer that fires them.
-- ---------------------------------------------------------------------------
revoke all on function public.preapproval_fee_usdc(text, integer)
  from public, anon;
grant execute on function public.preapproval_fee_usdc(text, integer)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.preapproval_fee_usdc(text, integer)
      to service_role;
  end if;
end
$$;

revoke all on function public.recompute_application_preapproval_fee(uuid)
  from public, anon, authenticated;
revoke all on function public.recompute_preapproval_fee()
  from public, anon, authenticated;
revoke all on function public.init_preapproval_fee()
  from public, anon, authenticated;
