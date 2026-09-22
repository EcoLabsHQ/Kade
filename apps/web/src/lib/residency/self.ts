import { EAS_SCHEMAS } from '@kade/shared';

/**
 * The Self (self.xyz) identity-verification path (D16 / EXE-012).
 *
 * The residency identity check is completed by verifying a Self zero-knowledge
 * passport proof and writing the disclosed fields as `kade.kyc.v1`. The
 * disclosure set is derived from the frozen shared schema
 * (`EAS_SCHEMAS['kade.kyc.v1'].fields`), so it cannot drift from the encoding.
 *
 * **BLOCKED: Self config.** No Self project configuration is supplied, so this
 * module is explicitly config-gated. It builds the verification request and
 * reports the gate; it never fabricates a KYC result. `verified` is
 * intentionally not a producible outcome in this build — the on-chain proof
 * exchange is not wired and no `identity_attestations` row is written here.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The `kade.kyc.v1` fields a Self proof discloses, in schema order. */
export type SelfDisclosure = (typeof EAS_SCHEMAS)['kade.kyc.v1']['fields'][number]['name'];

export interface SelfConfig {
  readonly appId: string;
  readonly scope: string;
  readonly verifierAddress: `0x${string}`;
  readonly chainId: number;
}

/**
 * The Self configuration, or null when it is not supplied.
 *
 * Read from the server environment (the same `KADE_SELF_*` keys the project
 * supplies). The Self integration does not edit `@/lib/env`, which is owned by
 * the mainnet-config front; the keys are local to this path and documented here.
 */
export function readSelfConfig(): SelfConfig | null {
  const appId = process.env.KADE_SELF_APP_ID?.trim();
  const scope = process.env.KADE_SELF_SCOPE?.trim();
  const verifierAddress = process.env.KADE_SELF_VERIFIER_ADDRESS?.trim();
  const chainId = Number(process.env.KADE_SELF_CHAIN_ID?.trim() ?? '');

  if (!appId || !scope || !verifierAddress) return null;
  if (!ADDRESS_PATTERN.test(verifierAddress)) return null;
  if (!Number.isInteger(chainId) || chainId <= 0) return null;

  return { appId, scope, verifierAddress: verifierAddress as `0x${string}`, chainId };
}

export function isSelfVerificationConfigured(
  config: SelfConfig | null = readSelfConfig(),
): boolean {
  return config !== null;
}

/**
 * The disclosure set, in the exact order of the frozen `kade.kyc.v1` schema.
 * Reading it from the schema means the request names `nationality`, `over18`,
 * `notSanctioned`, `selfNullifier` and `expiresAt` and nothing else.
 */
export const SELF_DISCLOSURES: readonly SelfDisclosure[] = EAS_SCHEMAS[
  'kade.kyc.v1'
].fields.map((field) => field.name);

export interface SelfVerificationRequest {
  readonly appId: string;
  readonly scope: string;
  readonly verifierAddress: `0x${string}`;
  readonly chainId: number;
  readonly disclosures: readonly SelfDisclosure[];
}

/** Build the request a resident's Self app would answer. No proof is produced. */
export function buildSelfVerificationRequest(
  config: SelfConfig,
): SelfVerificationRequest {
  return {
    appId: config.appId,
    scope: config.scope,
    verifierAddress: config.verifierAddress,
    chainId: config.chainId,
    disclosures: SELF_DISCLOSURES,
  };
}

/**
 * The outcome of starting Self verification.
 *
 * `verified` is deliberately absent: this build has no Self SDK and no wired
 * on-chain verifier, so it can only report that the path is gated. When the
 * configuration is supplied and the verifier is wired, a future implementation
 * may add a `verified` variant carrying the disclosed fields; until then no
 * code path can present an unverified resident as KYC-verified.
 */
export type SelfVerificationOutcome =
  | { readonly status: 'not-configured' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'unauthenticated' };

export function startSelfVerification(
  config: SelfConfig | null = readSelfConfig(),
): SelfVerificationOutcome {
  if (config === null) {
    return { status: 'not-configured' };
  }
  return {
    status: 'unavailable',
    reason:
      'Self is configured but the onchain proof exchange is not wired in this ' +
      'build, so no verification was performed.',
  };
}
