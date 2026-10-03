-- =============================================================================
-- Kade — extend applications.tier with the Colosseum Resident demo tier.
--
-- Additive only: the original CHECK in 20260916000002_applications.sql named
-- the three production values and cannot be altered in place without editing an
-- applied migration. This drops that constraint and recreates it with the one
-- additional value, 'colosseum', matching
-- packages/shared/src/onboarding.ts TIER_DATABASE_VALUES.
--
-- The three production values and their meaning are unchanged. The Colosseum
-- Resident tier is a demo-scale entry (10 USDC minimum, DOCX section 7); no
-- column, table, RPC or policy is added here.
-- =============================================================================

alter table public.applications
  drop constraint if exists applications_tier_check;

alter table public.applications
  add constraint applications_tier_check
    check (tier in ('3-year', '5-year', 'indefinite', 'colosseum'));

comment on column public.applications.tier is
  'Qualifying tier. [documented] values from DOCX section 4 (3-year / 5-year / '
  'Indefinite); the lower-case encoding of "indefinite" is [arbitrary]. '
  '[arbitrary] "colosseum" is the demo-scale Colosseum Resident tier added by '
  '20261002000001_colosseum_tier.sql.';
