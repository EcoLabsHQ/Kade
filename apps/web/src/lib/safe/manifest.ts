import type { SupabaseClient } from '@supabase/supabase-js';
import { getAddress, type Hex } from 'viem';
import {
  ACTIVE_SAFE_VERSION,
  CHAIN_IDS,
  DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
  SAFE_DEPLOYMENTS,
  SAFE_PASSKEY_MODULE,
  SAFE_THRESHOLD,
  assertSameAddressAcrossChains,
  type Address,
  type ChainId,
  type SafeDeploymentRecord,
} from '@kade/shared';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';

/**
 * Persistence for the resident Safe prediction and its deployment outcome (D4).
 *
 * D4 requires the Sepolia transaction, Safe address, predicted L2 addresses,
 * Safe version, factory, singleton, initializer, handler, owner, threshold,
 * salt and creation-code assumptions to be *stored*. This module owns that
 * record. The field names mirror
 * `packages/contracts/safe/SafeDeploymentManifest.schema.json`; the constants
 * are read from `@kade/shared` rather than re-declared here.
 *
 * The address is counterfactual until the Safe is deployed, and funds may be
 * sent to it first. A prediction therefore has to be recorded complete before
 * any deposit address is shown, and a deployment outcome can only update an
 * existing prediction — never create one. `recordDeployment` and
 * `recordDeploymentFailure` update by `(profile_id, safe_address)`, so an
 * address that was never predicted changes no rows and raises
 * `SafeDeploymentNotPredictedError`.
 *
 * Everything the browser could not be trusted to name — the address, the
 * deployment transaction hash and the manifest inputs — is written through the
 * service role with the elevated client; the `authenticated` role has no
 * column privilege on any of them (migration 20260916000016).
 */

/* -------------------------------------------------------------------------- */
/* Manifest shape (mirrors SafeDeploymentManifest.schema.json)                */
/* -------------------------------------------------------------------------- */

export const SAFE_DEPLOYMENT_STATUSES = [
  'predicted',
  'queued',
  'deployed',
  'failed',
] as const;
export type SafeDeploymentStatus = (typeof SAFE_DEPLOYMENT_STATUSES)[number];

export type SafeProvenance = 'unapproved' | 'approved';

export interface PredictedL2Address {
  readonly chainId: number;
  readonly name: string;
  readonly address: Address;
}

export interface SafeSalt {
  /** uint256 salt nonce, as a decimal string. */
  readonly saltNonce: string;
  readonly initializerHash: Hex;
  readonly salt: Hex;
}

export interface SafeCreationCodeAssumptions {
  readonly proxyCreationCodeHash: Hex;
  readonly initCodeHash: Hex;
  readonly initCodeFormula: string;
  readonly saltFormula: string;
  readonly create2Formula: string;
  readonly chainSpecific: false;
}

/** The D4 manifest, exactly the JSON Schema's field names. */
export interface SafeDeploymentManifest {
  readonly deploymentTxHash: Hex | null;
  readonly deploymentChainId: number;
  readonly safeAddress: Address;
  readonly predictedL2Addresses: readonly PredictedL2Address[];
  readonly safeVersion: string;
  readonly factory: Address;
  readonly singleton: Address;
  readonly initializer: Hex;
  readonly handler: Address;
  readonly owner: Address;
  readonly threshold: 1;
  readonly salt: SafeSalt;
  readonly creationCodeAssumptions: SafeCreationCodeAssumptions;
  readonly provenance: SafeProvenance;
}

/** The formulas the schema fixes; a change to any is a change-control item. */
const INIT_CODE_FORMULA = 'proxyCreationCode ++ uint256(uint160(singleton))';
const SALT_FORMULA = 'keccak256(keccak256(initializer) ++ uint256(saltNonce))';
const CREATE2_FORMULA = 'keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]';

/**
 * The passkey signer factory the Safe owner is derived through.
 *
 * Exposed so the deployment path and the manifest agree on the module that
 * produced the owner. The manifest stores the derived owner, not the factory.
 */
export function passkeySignerFactory(): Address {
  return getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value);
}

/** Per-resident values needed to build a complete prediction. */
export interface SafePredictionInput {
  readonly profileId: string;
  readonly safeAddress: Address;
  readonly owner: Address;
  readonly initializer: Hex;
  readonly initializerHash: Hex;
  /** uint256 salt nonce, as a decimal string. */
  readonly saltNonce: string;
  readonly salt: Hex;
  readonly initCodeHash: Hex;
  /** Defaults to the recorded deployed-factory creation-code hash. */
  readonly proxyCreationCodeHash?: Hex;
  /** Defaults to Base Sepolia pointing at `safeAddress`. */
  readonly predictedL2Addresses?: readonly PredictedL2Address[];
  /** Defaults to the active Safe release. */
  readonly safeVersion?: string;
}

/**
 * Build the complete manifest for a prediction.
 *
 * Rejects anything incomplete or inconsistent rather than persisting a partial
 * row: a bad address, a missing hash, or an L2 prediction that does not equal
 * the deployment address all throw. This is the single place the shared
 * constants are assembled, so no caller can invent its own factory or version.
 */
export function buildSafeDeploymentManifest(
  input: SafePredictionInput,
): SafeDeploymentManifest {
  const deployment = SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION];
  const safeAddress = assertAddress(input.safeAddress, 'safeAddress');
  const owner = assertAddress(input.owner, 'owner');

  const predictedL2Addresses = (
    input.predictedL2Addresses ?? [
      {
        chainId: CHAIN_IDS.baseSepolia,
        name: 'Base Sepolia',
        address: safeAddress,
      },
    ]
  ).map((entry) => ({
    chainId: entry.chainId,
    name: entry.name,
    address: assertAddress(entry.address, 'predictedL2Addresses.address'),
  }));
  if (predictedL2Addresses.length === 0) {
    throw new Error('A prediction must name at least one predicted L2 address.');
  }

  const manifest: SafeDeploymentManifest = {
    deploymentTxHash: null,
    deploymentChainId: CHAIN_IDS.sepolia,
    safeAddress,
    predictedL2Addresses,
    safeVersion: input.safeVersion ?? ACTIVE_SAFE_VERSION,
    factory: assertAddress(deployment.safeProxyFactory.value, 'factory'),
    singleton: assertAddress(deployment.safeL2.value, 'singleton'),
    initializer: assertHexData(input.initializer, 'initializer'),
    handler: assertAddress(
      deployment.compatibilityFallbackHandler.value,
      'handler',
    ),
    owner,
    threshold: SAFE_THRESHOLD,
    salt: {
      saltNonce: assertDecimal(input.saltNonce, 'salt.saltNonce'),
      initializerHash: assertBytes32(input.initializerHash, 'salt.initializerHash'),
      salt: assertBytes32(input.salt, 'salt.salt'),
    },
    creationCodeAssumptions: {
      proxyCreationCodeHash: assertBytes32(
        input.proxyCreationCodeHash ?? DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
        'creationCodeAssumptions.proxyCreationCodeHash',
      ),
      initCodeHash: assertBytes32(
        input.initCodeHash,
        'creationCodeAssumptions.initCodeHash',
      ),
      initCodeFormula: INIT_CODE_FORMULA,
      saltFormula: SALT_FORMULA,
      create2Formula: CREATE2_FORMULA,
      chainSpecific: false,
    },
    provenance: 'unapproved',
  };

  // D4: one address on every active chain. This throws if an L2 prediction
  // disagrees, so an inconsistent manifest is never stored.
  assertSameAddressAcrossChains(safeDeploymentRecords(manifest));
  return manifest;
}

/**
 * The per-chain records the manifest describes, for
 * `assertSameAddressAcrossChains`. The Sepolia record is the only one that may
 * carry a deployment transaction.
 */
export function safeDeploymentRecords(
  manifest: SafeDeploymentManifest,
): SafeDeploymentRecord[] {
  return [
    {
      chainId: manifest.deploymentChainId as ChainId,
      safeAddress: manifest.safeAddress,
      // The shared record types a transaction hash as an address; a hash is 32
      // bytes. Cast here rather than widen the shared contract.
      deploymentTxHash: manifest.deploymentTxHash as Address | null,
      predicted: manifest.deploymentTxHash === null,
    },
    ...manifest.predictedL2Addresses.map((entry) => ({
      chainId: entry.chainId as ChainId,
      safeAddress: entry.address,
      deploymentTxHash: null,
      predicted: true,
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* Persisted shape                                                            */
/* -------------------------------------------------------------------------- */

export interface PersistedSafeDeployment {
  readonly profileId: string;
  readonly safeAddress: Address;
  readonly status: SafeDeploymentStatus;
  readonly deploymentTxHash: Hex | null;
  readonly manifest: SafeDeploymentManifest;
  readonly provenance: SafeProvenance;
  readonly failureReason: string | null;
  readonly predictedAt: string;
  readonly queuedAt: string | null;
  readonly deployedAt: string | null;
  readonly failedAt: string | null;
  readonly updatedAt: string;
}

interface SafeDeploymentRow {
  readonly profile_id: string;
  readonly safe_address: string;
  readonly status: string;
  readonly deployment_tx_hash: string | null;
  readonly deployment_chain_id: number;
  readonly predicted_l2_addresses: readonly PredictedL2Address[];
  readonly safe_version: string;
  readonly factory: string;
  readonly singleton: string;
  readonly initializer: string;
  readonly handler: string;
  readonly owner: string;
  readonly threshold: number;
  readonly salt: SafeSalt;
  readonly creation_code_assumptions: SafeCreationCodeAssumptions;
  readonly provenance: string;
  readonly failure_reason: string | null;
  readonly predicted_at: string;
  readonly queued_at: string | null;
  readonly deployed_at: string | null;
  readonly failed_at: string | null;
  readonly updated_at: string;
}

function manifestFromRow(row: SafeDeploymentRow): SafeDeploymentManifest {
  return {
    deploymentTxHash: (row.deployment_tx_hash as Hex | null) ?? null,
    deploymentChainId: row.deployment_chain_id,
    safeAddress: row.safe_address as Address,
    predictedL2Addresses: row.predicted_l2_addresses,
    safeVersion: row.safe_version,
    factory: row.factory as Address,
    singleton: row.singleton as Address,
    initializer: row.initializer as Hex,
    handler: row.handler as Address,
    owner: row.owner as Address,
    threshold: row.threshold as 1,
    salt: row.salt,
    creationCodeAssumptions: row.creation_code_assumptions,
    provenance: row.provenance as SafeProvenance,
  };
}

function toPersisted(row: SafeDeploymentRow): PersistedSafeDeployment {
  return {
    profileId: row.profile_id,
    safeAddress: row.safe_address as Address,
    status: row.status as SafeDeploymentStatus,
    deploymentTxHash: (row.deployment_tx_hash as Hex | null) ?? null,
    manifest: manifestFromRow(row),
    provenance: row.provenance as SafeProvenance,
    failureReason: row.failure_reason,
    predictedAt: row.predicted_at,
    queuedAt: row.queued_at,
    deployedAt: row.deployed_at,
    failedAt: row.failed_at,
    updatedAt: row.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Raised when a deployment outcome names an address that was never predicted. */
export class SafeDeploymentNotPredictedError extends Error {
  constructor(safeAddress: string) {
    super(
      `No Safe prediction exists for ${safeAddress}; a deployment outcome can ` +
        'only be recorded for an address that was predicted first.',
    );
    this.name = 'SafeDeploymentNotPredictedError';
  }
}

/** Raised when the manifest cannot be written without the service role. */
export class SafeDeploymentServiceRoleError extends Error {
  constructor() {
    super(
      'Recording the Safe address and its manifest inputs requires ' +
        'SUPABASE_SERVICE_ROLE_KEY: those columns are not writable by the ' +
        'authenticated role. Set it in the server environment (see ' +
        '.env.example).',
    );
    this.name = 'SafeDeploymentServiceRoleError';
  }
}

/** Raised when there is no Supabase configuration at all. */
export class SafeDeploymentNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured, so the Safe deployment record cannot be ' +
        'read or written. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).',
    );
    this.name = 'SafeDeploymentNotConfiguredError';
  }
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export interface RecordSafeDeploymentInput {
  readonly profileId: string;
  readonly safeAddress: Address;
  readonly deploymentTxHash: Hex;
}

export interface RecordSafeDeploymentFailureInput {
  readonly profileId: string;
  readonly safeAddress: Address;
  readonly reason: string;
}

export interface SafeDeploymentStore {
  /** Persist the counterfactual prediction. Idempotent on `safe_address`. */
  recordPrediction(input: SafePredictionInput): Promise<PersistedSafeDeployment>;
  /** Record a successful Sepolia deployment of an already-predicted address. */
  recordDeployment(
    input: RecordSafeDeploymentInput,
  ): Promise<PersistedSafeDeployment>;
  /** Record a failed deployment of an already-predicted address. */
  recordDeploymentFailure(
    input: RecordSafeDeploymentFailureInput,
  ): Promise<PersistedSafeDeployment>;
  /** Load one prediction by address, scoped to the owning resident. */
  getByAddress(
    profileId: string,
    safeAddress: Address,
  ): Promise<PersistedSafeDeployment | null>;
  /** Load the resident's most recently predicted Safe, if any. */
  getForProfile(profileId: string): Promise<PersistedSafeDeployment | null>;
}

export interface SafeDeploymentStoreClients {
  /** Session-scoped client; row level security applies as the resident. */
  readonly getClient: () => Promise<SupabaseClient>;
  /** Elevated client, or null when the service-role key is absent. */
  readonly getServiceClient: () => Promise<SupabaseClient | null>;
}

function predictionRow(
  profileId: string,
  manifest: SafeDeploymentManifest,
): Record<string, unknown> {
  return {
    profile_id: profileId,
    safe_address: manifest.safeAddress,
    status: 'predicted',
    deployment_tx_hash: null,
    deployment_chain_id: manifest.deploymentChainId,
    predicted_l2_addresses: manifest.predictedL2Addresses,
    safe_version: manifest.safeVersion,
    factory: manifest.factory,
    singleton: manifest.singleton,
    initializer: manifest.initializer,
    handler: manifest.handler,
    owner: manifest.owner,
    threshold: manifest.threshold,
    salt: manifest.salt,
    creation_code_assumptions: manifest.creationCodeAssumptions,
    provenance: manifest.provenance,
  };
}

export function createSafeDeploymentStore(
  clients: SafeDeploymentStoreClients,
): SafeDeploymentStore {
  async function requireServiceClient(): Promise<SupabaseClient> {
    const serviceClient = await clients.getServiceClient();
    if (serviceClient === null) throw new SafeDeploymentServiceRoleError();
    return serviceClient;
  }

  /** Run an update on the service client; null means no row matched. */
  async function updateOutcome(
    build: (client: SupabaseClient) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>,
  ): Promise<PersistedSafeDeployment | null> {
    const client = await requireServiceClient();
    const result = await build(client);
    if (result.error) {
      throw new Error(
        `Recording the Safe deployment outcome failed: ${result.error.message}`,
      );
    }
    return result.data ? toPersisted(result.data as SafeDeploymentRow) : null;
  }

  /** Read through the resident-scoped client, so RLS proves ownership. */
  async function read(
    build: (client: SupabaseClient) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>,
  ): Promise<PersistedSafeDeployment | null> {
    const client = await clients.getClient();
    const result = await build(client);
    if (result.error) {
      throw new Error(
        `Loading the Safe deployment record failed: ${result.error.message}`,
      );
    }
    return result.data ? toPersisted(result.data as SafeDeploymentRow) : null;
  }

  return {
    async recordPrediction(input) {
      const manifest = buildSafeDeploymentManifest(input);
      const serviceClient = await requireServiceClient();

      // `ignoreDuplicates` maps to ON CONFLICT DO NOTHING against the UNIQUE
      // safe_address, so a repeat prediction is the same row, not a duplicate,
      // and cannot move the address's inputs.
      const upsert = await serviceClient
        .from('safe_deployments')
        .upsert(predictionRow(input.profileId, manifest), {
          onConflict: 'safe_address',
          ignoreDuplicates: true,
        });
      if (upsert.error) {
        throw new Error(
          `Storing the Safe prediction failed: ${upsert.error.message}`,
        );
      }

      const saved = await read((client) =>
        client
          .from('safe_deployments')
          .select('*')
          .eq('profile_id', input.profileId)
          .eq('safe_address', manifest.safeAddress)
          .maybeSingle(),
      );
      if (saved === null) {
        throw new Error(
          'The Safe prediction was written but could not be read back; the ' +
            'record cannot be confirmed.',
        );
      }
      return saved;
    },

    async recordDeployment(input) {
      const safeAddress = assertAddress(input.safeAddress, 'safeAddress');
      const deploymentTxHash = assertBytes32(
        input.deploymentTxHash,
        'deploymentTxHash',
      );
      const now = new Date().toISOString();

      const saved = await updateOutcome((client) =>
        client
          .from('safe_deployments')
          .update({
            status: 'deployed',
            deployment_tx_hash: deploymentTxHash,
            provenance: 'approved',
            failure_reason: null,
            deployed_at: now,
            updated_at: now,
          })
          .eq('profile_id', input.profileId)
          .eq('safe_address', safeAddress)
          .select('*')
          .maybeSingle(),
      );
      // An update that matched no row means the address was never predicted:
      // there is no insert path for an outcome.
      if (saved === null) {
        throw new SafeDeploymentNotPredictedError(safeAddress);
      }
      return saved;
    },

    async recordDeploymentFailure(input) {
      const safeAddress = assertAddress(input.safeAddress, 'safeAddress');
      const now = new Date().toISOString();

      const saved = await updateOutcome((client) =>
        client
          .from('safe_deployments')
          .update({
            status: 'failed',
            failure_reason: input.reason,
            failed_at: now,
            updated_at: now,
          })
          .eq('profile_id', input.profileId)
          .eq('safe_address', safeAddress)
          .select('*')
          .maybeSingle(),
      );
      if (saved === null) {
        throw new SafeDeploymentNotPredictedError(safeAddress);
      }
      return saved;
    },

    async getByAddress(profileId, safeAddress) {
      return read((client) =>
        client
          .from('safe_deployments')
          .select('*')
          .eq('profile_id', profileId)
          .eq('safe_address', assertAddress(safeAddress, 'safeAddress'))
          .maybeSingle(),
      );
    },

    async getForProfile(profileId) {
      return read((client) =>
        client
          .from('safe_deployments')
          .select('*')
          .eq('profile_id', profileId)
          .order('predicted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Default store                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The store backed by the real Supabase clients.
 *
 * Throws `SafeDeploymentNotConfiguredError` when the database is not
 * configured, rather than silently returning a store that cannot persist. The
 * service client is resolved lazily and may be null; a write then raises
 * `SafeDeploymentServiceRoleError`, which is explicit rather than a partial
 * success.
 */
export function safeDeploymentStore(): SafeDeploymentStore {
  if (!isAuthConfigured(readAuthEnv())) {
    throw new SafeDeploymentNotConfiguredError();
  }
  return createSafeDeploymentStore({
    getClient: async () => {
      const { createSupabaseServerClient } = await import(
        '@/lib/supabase/server'
      );
      return createSupabaseServerClient();
    },
    getServiceClient: async () => {
      const { createSupabaseServiceClient, isServiceRoleConfigured } =
        await import('@/lib/supabase/server');
      if (!isServiceRoleConfigured()) return null;
      return createSupabaseServiceClient();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_DATA_PATTERN = /^0x[0-9a-fA-F]*$/;
const DECIMAL_PATTERN = /^\d+$/;

function assertAddress(value: string, field: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address, got "${value}".`);
  }
  return getAddress(value);
}

function assertBytes32(value: string, field: string): Hex {
  if (!BYTES32_PATTERN.test(value)) {
    throw new Error(`${field} must be a 32-byte hex value, got "${value}".`);
  }
  return value as Hex;
}

function assertHexData(value: string, field: string): Hex {
  if (!HEX_DATA_PATTERN.test(value)) {
    throw new Error(`${field} must be hex calldata, got "${value}".`);
  }
  return value as Hex;
}

function assertDecimal(value: string, field: string): string {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`${field} must be a decimal uint256 string, got "${value}".`);
  }
  return value;
}
