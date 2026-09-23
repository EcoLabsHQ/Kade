/**
 * Holdings — the aggregate over **signature-verified** linked wallets.
 *
 * Frozen decision §2.2 item 2: a linked wallet is proven by a signature over a
 * server-issued challenge (EIP-191 / EIP-4361-style), and that proof is required
 * to display the wallet's holdings. Frozen decision §2.2 item 3: a pasted
 * address is registration-only and **never** feeds Holdings — the exclusion is
 * structural, not a display convention. As amended v1.2, a wallet connected
 * during onboarding (browser extension or WalletConnect) is displayed in
 * Holdings too, but as an **unverified** connected wallet, in its own labelled
 * section and **excluded from the total**.
 *
 * That structure lives here, in two parts:
 *
 *   1. `classifyWalletRows` is the only producer of a `VerifiedWallet` and of
 *      an `UnverifiedConnectedWallet`. A row is classified exactly once:
 *      - `verified_at` non-null            → VERIFIED (any provider);
 *      - `verified_at` null, provider
 *        `connected-wallet`               → UNVERIFIED CONNECTED;
 *      - `verified_at` null, provider
 *        `pasted-address`/`bitcoin-address`
 *                                         → EXCLUDED from Holdings.
 *      So a pasted row (`verified_at` NULL, the documented "unverified" meaning)
 *      can never satisfy the verified predicate and can never be passed in.
 *   2. Both classes are branded by a module-private `unique symbol`, so neither
 *      can be constructed with an object literal from outside this module.
 *      `aggregateHoldings` takes `VerifiedWallet[]` for the total and a separate
 *      `UnverifiedConnectedWallet[]` for the unverified section: the unverified
 *      class can never contribute to `total`, because the function never adds it.
 *
 * Balances are read through an injected reader (`readBalances`), so these
 * functions are pure, network-free and directly testable, and the same code is
 * reused for every verified wallet. A failed read is reported as a per-wallet
 * `readError` with a null value — never fabricated as zero.
 */

import {
  CONNECTED_WALLET_PROVIDER,
  type EvmChainBalance,
} from './types';

/**
 * One `public.wallets` row as read from Supabase, camel-cased by the caller.
 *
 * `verifiedAt` is `wallets.verified_at`: non-null **only** for a row proven by
 * a signature over a server-issued challenge (front 03 sets it; no other path
 * does).
 */
export interface WalletLinkRow {
  readonly id: number;
  readonly address: string;
  readonly chain: number;
  readonly provider: string | null;
  readonly verifiedAt: string | null;
}

/**
 * Compile-time proof marker for a signature-verified wallet.
 *
 * Deliberately **not exported**: no other module can name this key, so it
 * cannot build a `VerifiedWallet` with an object literal. `selectVerifiedWallets`
 * is the sole producer (it casts internally), which is what makes the pasted
 * exclusion structural rather than a display filter.
 */
declare const ownershipProof: unique symbol;

/** A linked wallet whose control was proven by a signature. */
export interface VerifiedWallet {
  readonly [ownershipProof]: true;
  /** Canonical address as stored, for display. */
  readonly address: string;
  /** ISO timestamp of the signature verification (`wallets.verified_at`). */
  readonly verifiedAt: string;
  /** Distinct chains a stored row exists for, ascending. */
  readonly chainIds: readonly number[];
}

/**
 * Compile-time proof marker for a connected, unverified wallet.
 *
 * Deliberately **not exported**, exactly like `ownershipProof`: a pasted row
 * cannot be named as one of these from outside this module, and the classifier
 * is the sole producer.
 */
declare const connectionProof: unique symbol;

/**
 * A wallet connected during onboarding whose control was **not** proven.
 *
 * `verified_at` is NULL and it is not evidence of control. It is shown in
 * Holdings in its own labelled section and is **excluded from the total**: it is
 * a separate class from `VerifiedWallet`, never a substitute for one.
 */
export interface UnverifiedConnectedWallet {
  readonly [connectionProof]: true;
  /** Canonical address as stored, for display. */
  readonly address: string;
  /** Always `'connected-wallet'`; the connected, unverified encoding. */
  readonly provider: typeof CONNECTED_WALLET_PROVIDER;
  /** Distinct chains a stored row exists for, ascending. */
  readonly chainIds: readonly number[];
}

/** The exact partition of a resident's stored rows. */
export interface ClassifiedWalletRows {
  /** Signature-verified wallets; the only rows that feed the Holdings total. */
  readonly verified: readonly VerifiedWallet[];
  /** Connected but unverified wallets; shown separately, never in the total. */
  readonly unverifiedConnected: readonly UnverifiedConnectedWallet[];
}

/**
 * Accept a `verified_at` value only when it is a real timestamp.
 *
 * Returns null for a missing value (a pasted, unverified row) and for an
 * unusable one, so a malformed value can never open the predicate.
 */
function normalizeVerifiedAt(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null;
}

/**
 * The structural pasted-address exclusion.
 *
 * Group the stored rows by address; a group is a verified wallet only when at
 * least one of its rows carries a usable `verified_at`. Rows without one (every
 * pasted Bitcoin and pasted EVM row) are dropped before aggregation, so they
 * cannot contribute a holding. The earliest proof wins, and the address keeps
 * every chain it has a row for.
 */
export function selectVerifiedWallets(
  rows: readonly WalletLinkRow[],
): readonly VerifiedWallet[] {
  const byAddress = new Map<
    string,
    { address: string; verifiedAt: string; chainIds: Set<number> }
  >();

  for (const row of rows) {
    const verifiedAt = normalizeVerifiedAt(row.verifiedAt);
    if (verifiedAt === null) continue;
    if (typeof row.address !== 'string' || row.address.trim() === '') continue;

    const key = row.address.trim().toLowerCase();
    const existing = byAddress.get(key);
    if (existing) {
      existing.chainIds.add(row.chain);
      if (verifiedAt < existing.verifiedAt) existing.verifiedAt = verifiedAt;
      continue;
    }
    byAddress.set(key, {
      address: row.address.trim(),
      verifiedAt,
      chainIds: new Set([row.chain]),
    });
  }

  return [...byAddress.values()].map(
    (entry) =>
      ({
        address: entry.address,
        verifiedAt: entry.verifiedAt,
        chainIds: [...entry.chainIds].sort((a, b) => a - b),
      }) as unknown as VerifiedWallet,
  );
}

/**
 * Partition stored rows into the two Holdings classes, exactly.
 *
 * This is the single classifier the Holdings loader uses:
 *
 *   - a row with a usable `verified_at` is VERIFIED, whatever its provider;
 *   - otherwise a row whose provider is `connected-wallet` is UNVERIFIED
 *     CONNECTED;
 *   - every other row — `verified_at` NULL with a `pasted-address` or
 *     `bitcoin-address` provider, or no provider at all — is EXCLUDED.
 *
 * A verified row always wins for its address: if the same address also has a
 * connected row, only the verified class is produced. That keeps a wallet that
 * was later signature-verified out of the unverified section instead of showing
 * it twice. Like `selectVerifiedWallets`, the pasted exclusion is a predicate
 * here, not a render-time filter.
 */
export function classifyWalletRows(
  rows: readonly WalletLinkRow[],
): ClassifiedWalletRows {
  const verified = selectVerifiedWallets(rows);
  const verifiedAddresses = new Set(
    verified.map((wallet) => wallet.address.trim().toLowerCase()),
  );
  const byAddress = new Map<
    string,
    { address: string; chainIds: Set<number> }
  >();

  for (const row of rows) {
    // A usable verified_at means the row belongs to the verified class above.
    if (normalizeVerifiedAt(row.verifiedAt) !== null) continue;
    if (row.provider !== CONNECTED_WALLET_PROVIDER) continue;
    if (typeof row.address !== 'string' || row.address.trim() === '') continue;

    const key = row.address.trim().toLowerCase();
    // Never duplicate an address that is classified verified.
    if (verifiedAddresses.has(key)) continue;

    const existing = byAddress.get(key);
    if (existing) {
      existing.chainIds.add(row.chain);
      continue;
    }
    byAddress.set(key, {
      address: row.address.trim(),
      chainIds: new Set([row.chain]),
    });
  }

  const unverifiedConnected = [...byAddress.values()]
    .sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    )
    .map(
      (entry) =>
        ({
          address: entry.address,
          provider: CONNECTED_WALLET_PROVIDER,
          chainIds: [...entry.chainIds].sort((a, b) => a - b),
        }) as unknown as UnverifiedConnectedWallet,
    );

  return { verified, unverifiedConnected };
}

/** The balances of one verified address, as returned by the injected reader. */
export interface VerifiedWalletBalances {
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
}

/** Read the balances of one verified address. Injected so tests stay offline. */
export type ReadVerifiedBalances = (
  address: string,
) => Promise<VerifiedWalletBalances>;

/** One wallet's fresh balance read, before it is placed in a class. */
interface WalletBalanceRead {
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readError: string | null;
}

/**
 * Read one wallet's balances, turning a provider failure into a `readError`
 * rather than an exception or a fabricated zero. Shared by both classes, so a
 * connected wallet's failed read is reported exactly as a verified one's.
 */
async function readWalletBalances(
  address: string,
  readBalances: ReadVerifiedBalances,
): Promise<WalletBalanceRead> {
  try {
    const read = await readBalances(address);
    return {
      chains: read.chains,
      usd: read.usd !== null && Number.isFinite(read.usd) ? read.usd : null,
      readError: null,
    };
  } catch (cause) {
    console.warn('[kade] Could not read wallet balances:', cause);
    return {
      chains: [],
      usd: null,
      readError:
        cause instanceof Error
          ? cause.message
          : 'The balances could not be read.',
    };
  }
}

/** One verified wallet's holding in the aggregate, with its own breakdown. */
export interface HoldingWallet {
  readonly address: string;
  readonly verifiedAt: string;
  /** Chains the wallet has a stored row for (from the signature proof). */
  readonly chainIds: readonly number[];
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readError: string | null;
}

/**
 * One connected, unverified wallet in the aggregate.
 *
 * It is deliberately a separate type from `HoldingWallet`: it has no
 * `verifiedAt`, so a renderer cannot mistake it for a proven wallet.
 */
export interface UnverifiedHoldingWallet {
  readonly address: string;
  /** Always `'connected-wallet'`. */
  readonly provider: string;
  /** Chains the connected wallet has a stored row for. */
  readonly chainIds: readonly number[];
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readError: string | null;
}

/** The Holdings screen's data: a total plus the per-wallet breakdown. */
export interface HoldingsAggregate {
  /** Sum of every readable **verified** wallet USD figure. Nothing else adds. */
  readonly total: number;
  /** Verified wallets counted (one per distinct address). */
  readonly walletCount: number;
  /** Verified wallets with a readable USD figure. */
  readonly valuedCount: number;
  /** Verified wallets whose balance could not be valued and are shown as `—`. */
  readonly unvaluedCount: number;
  readonly wallets: readonly HoldingWallet[];
  /**
   * Connected, unverified wallets. Shown in their own labelled section and
   * **never** included in `total` or in `valuedCount`/`unvaluedCount`.
   */
  readonly unverifiedWallets: readonly UnverifiedHoldingWallet[];
  /** How many unverified connected wallets there are. */
  readonly unverifiedCount: number;
}

/**
 * Aggregate the holdings of verified wallets, plus the unverified connected
 * ones for a separate section.
 *
 * `wallets` is typed `VerifiedWallet[]`, so a caller cannot put a pasted row in
 * the total: it would not typecheck and, at runtime, it cannot carry the private
 * brand. `unverifiedWallets` is a distinct branded class, so it cannot be passed
 * as `wallets` either. Each distinct address is read once even if the input
 * repeats it, and it is never read under both classes. A reader failure becomes
 * that wallet's `readError` and contributes no total, rather than failing the
 * whole screen or inventing a zero.
 *
 * The unverified wallets are read so the screen can show their balances, but
 * their `usd` is **never** added to `total` and they never touch the verified
 * counts: a connection is not a signature and is not evidence of control.
 */
export async function aggregateHoldings(input: {
  readonly wallets: readonly VerifiedWallet[];
  readonly unverifiedWallets?: readonly UnverifiedConnectedWallet[];
  readonly readBalances: ReadVerifiedBalances;
}): Promise<HoldingsAggregate> {
  const seen = new Set<string>();
  const wallets: HoldingWallet[] = [];
  const unverifiedWallets: UnverifiedHoldingWallet[] = [];
  let total = 0;
  let valuedCount = 0;

  for (const wallet of input.wallets) {
    const key = wallet.address.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const read = await readWalletBalances(wallet.address, input.readBalances);
    if (read.usd !== null) {
      total += read.usd;
      valuedCount += 1;
    }
    wallets.push({
      address: wallet.address,
      verifiedAt: wallet.verifiedAt,
      chainIds: wallet.chainIds,
      chains: read.chains,
      usd: read.usd,
      readError: read.readError,
    });
  }

  for (const wallet of input.unverifiedWallets ?? []) {
    const key = wallet.address.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const read = await readWalletBalances(wallet.address, input.readBalances);
    unverifiedWallets.push({
      address: wallet.address,
      provider: wallet.provider,
      chainIds: wallet.chainIds,
      chains: read.chains,
      usd: read.usd,
      readError: read.readError,
    });
  }

  return {
    total,
    walletCount: wallets.length,
    valuedCount,
    unvaluedCount: wallets.length - valuedCount,
    wallets,
    unverifiedWallets,
    unverifiedCount: unverifiedWallets.length,
  };
}

