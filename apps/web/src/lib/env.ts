/**
 * Authentication environment contract.
 *
 * Sources: .env.example (root) and docs/week-1-frozen-delivery-contract.md
 * section 5. The app must fail clearly and safely when Supabase is not
 * configured: it must never crash and never present a fake signed-in state.
 */

/** Env vars that must be present before any Supabase client is created. */
export const REQUIRED_AUTH_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export interface AuthEnv {
  readonly supabaseUrl: string | null;
  readonly supabaseAnonKey: string | null;
  readonly siteUrl: string;
  readonly callbackPath: string;
}

/** [documented] the local development origin from .env.example. */
const DEFAULT_SITE_URL = 'http://localhost:3000';

/** [arbitrary] the Supabase SSR callback path, from .env.example. */
const DEFAULT_CALLBACK_PATH = '/auth/callback';

export function readAuthEnv(): AuthEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL,
    callbackPath:
      process.env.NEXT_PUBLIC_AUTH_CALLBACK_PATH?.trim() || DEFAULT_CALLBACK_PATH,
  };
}

export function isAuthConfigured(env: AuthEnv = readAuthEnv()): boolean {
  return env.supabaseUrl !== null && env.supabaseAnonKey !== null;
}

/**
 * Supabase service-role key.
 *
 * Server-only, and deliberately **not** `NEXT_PUBLIC_`: it grants elevated
 * database capability, including writing `passkey_credentials.signer_address`,
 * which the `authenticated` role is denied. It is read on the server and never
 * exposed to the browser. Returns null when it is absent, so a caller can
 * degrade honestly instead of pretending the capability exists.
 */
export function readServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

/** Absolute URL the auth provider redirects back to after the consent step. */
export function authCallbackUrl(env: AuthEnv = readAuthEnv()): string {
  return new URL(env.callbackPath, env.siteUrl).toString();
}

/**
 * Behaviour switches.
 *
 * These are server-only: neither is `NEXT_PUBLIC_`, so they are read on the
 * server and the resolved values are passed down as props. The browser can
 * neither read nor override them, which is what "no amount is hard-coded in
 * the client" requires (contract section 2.1).
 */

/** Chain sets the application knows how to talk about. */
export const CHAIN_ENVS = ['testnet', 'mainnet'] as const;
export type ChainEnv = (typeof CHAIN_ENVS)[number];

/** Fee schedules seeded in `fee_schedule`. */
export const FEE_MODES = ['demo', 'production'] as const;
export type FeeMode = (typeof FEE_MODES)[number];

/** [documented] iteration 1 is all-testnet (week-1 contract section 2, item 7). */
const DEFAULT_CHAIN_ENV: ChainEnv = 'testnet';

/** [documented] the demo schedule is the iteration-1 default (contract 2.1). */
const DEFAULT_FEE_MODE: FeeMode = 'demo';

function readEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  const value = raw?.trim();
  if (!value) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.warn(
    `[kade] ${name}="${value}" is not one of ${allowed.join(' | ')}; using "${fallback}".`,
  );
  return fallback;
}

/** Which chain set is active. `testnet` in iteration 1. */
export function readChainEnv(): ChainEnv {
  return readEnum(
    process.env.KADE_CHAIN_ENV,
    CHAIN_ENVS,
    DEFAULT_CHAIN_ENV,
    'KADE_CHAIN_ENV',
  );
}

/** Which `fee_schedule` rows are authoritative. */
export function readFeeMode(): FeeMode {
  return readEnum(
    process.env.KADE_FEE_MODE,
    FEE_MODES,
    DEFAULT_FEE_MODE,
    'KADE_FEE_MODE',
  );
}

/**
 * Sepolia JSON-RPC endpoint.
 *
 * Used to ask the deployed Safe WebAuthn signer factory for a signer address,
 * so the address comes from the contract that will actually deploy the signer
 * rather than from a local re-implementation of its arithmetic.
 *
 * Deliberately **not** `NEXT_PUBLIC_`: the endpoint carries a provider key, so
 * it is read on the server and reached through a server action. The key is not
 * in the browser bundle and cannot be read from the page.
 */
export function readSepoliaRpcUrl(): string | null {
  return process.env.SEPOLIA_RPC_URL?.trim() || null;
}

/** [arbitrary] the public mempool.space Esplora endpoint. */
const DEFAULT_BITCOIN_API_BASE = 'https://mempool.space';

/**
 * Base URL of the Bitcoin balance provider.
 *
 * Server-only, and deliberately **not** `NEXT_PUBLIC_`: the browser must never
 * call the provider, so the resolved base is read in a server action and the
 * balance is passed down as a value. There is no API key; the override exists so
 * a self-hosted Esplora instance can be used (`KADE_BITCOIN_API_BASE`). Defaults
 * to the public mempool.space endpoint.
 */
export function readBitcoinApiBase(): string {
  return (
    process.env.KADE_BITCOIN_API_BASE?.trim() || DEFAULT_BITCOIN_API_BASE
  );
}
