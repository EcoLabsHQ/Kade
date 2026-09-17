-- =============================================================================
-- Supabase shim for running the pgTAP suites against a plain PostgreSQL.
--
-- `supabase test db` (and the migration set) assume a Supabase project that
-- already provides three things: the `auth` schema with `auth.uid()`, the API
-- roles (`anon`, `authenticated`, `service_role`), and the `extensions`
-- schema. This file supplies exactly those so `supabase/tests/` can be executed
-- on a disposable `postgres:16` container.
--
-- It is NOT a migration and NOT a test. It is never applied to a real
-- environment: a real Supabase project already has all of it.
--
-- Idempotent: safe to apply repeatedly.
-- =============================================================================

create extension if not exists pgcrypto;
create schema if not exists extensions;
create schema if not exists auth;

-- Supabase-shaped auth.users, limited to the columns the fixtures insert.
create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key default gen_random_uuid(),
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Supabase reads the subject from the request JWT. Tests set it with
-- `set_config('request.jwt.claim.sub', <uuid>, true)`.
create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
