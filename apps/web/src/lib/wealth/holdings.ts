/**
 * Holdings — the aggregate over **signature-verified** linked wallets.
 *
 * Frozen decision §2.2 item 2: a linked wallet is proven by a signature over a
 * server-issued challenge (EIP-191 / EIP-4361-style), and that proof is required
 * to display the wallet's holdings. Frozen decision §2.2 item 3: a pasted
 * address is registration-only and **never** feeds Holdings — the exclusion is
 * structural, not a display convention.
 *
 * That structure lives here, in two parts:
 *
 *   1. `selectVerifiedWallets` is the only producer of a `VerifiedWallet`. It
 *      drops every row whose `verified_at` is absent or unusable, so a pasted
 *      row (`verified_at` NULL, the documented "unverified" meaning) can never
 *      satisfy the predicate.
 *   2. `VerifiedWallet` is branded by a module-private `unique symbol`, so it
 *      cannot be constructed with an object literal from outside this module.
 *      `aggregateHoldings` takes `VerifiedWallet[]` as its input: a pasted row
 *      is not merely filtered out at render time, it cannot be passed in.
 *
 * Balances are read through an injected reader (`readBalances`), so these
 * functions are pure, network-free and directly testable, and the same code is
 * reused for every verified wallet. A failed read is reported as a per-wallet
 * `readError` with a null value — never fabricated as zero.
 */

import type { EvmChainBalance } from './types';

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

/** The balances of one verified address, as returned by the injected reader. */
export interface VerifiedWalletBalances {
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
}

/** Read the balances of one verified address. Injected so tests stay offline. */
export type ReadVerifiedBalances = (
  address: string,
) => Promise<VerifiedWalletBalances>;

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

/** The Holdings screen's data: a total plus the per-wallet breakdown. */
export interface HoldingsAggregate {
  /** Sum of every readable wallet USD figure. Unreadable wallets add nothing. */
  readonly total: number;
  /** Verified wallets counted (one per distinct address). */
  readonly walletCount: number;
  /** Wallets with a readable USD figure. */
  readonly valuedCount: number;
  /** Wallets whose balance could not be valued and are shown as `—`. */
  readonly unvaluedCount: number;
  readonly wallets: readonly HoldingWallet[];
}

/**
 * Aggregate the holdings of verified wallets only.
 *
 * The parameter type is `VerifiedWallet[]`, so a caller cannot pass a pasted
 * row: it would not typecheck and, at runtime, it cannot carry the private
 * brand. Each distinct address is read once even if the input repeats it. A
 * reader failure becomes that wallet's `readError` and contributes no total,
 * rather than failing the whole screen or inventing a zero.
 */
export async function aggregateHoldings(input: {
  readonly wallets: readonly VerifiedWallet[];
  readonly readBalances: ReadVerifiedBalances;
}): Promise<HoldingsAggregate> {
  const seen = new Set<string>();
  const wallets: HoldingWallet[] = [];
  let total = 0;
  let valuedCount = 0;

  for (const wallet of input.wallets) {
    const key = wallet.address.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const read = await input.readBalances(wallet.address);
      const usd =
        read.usd !== null && Number.isFinite(read.usd) ? read.usd : null;
      if (usd !== null) {
        total += usd;
        valuedCount += 1;
      }
      wallets.push({
        address: wallet.address,
        verifiedAt: wallet.verifiedAt,
        chainIds: wallet.chainIds,
        chains: read.chains,
        usd,
        readError: null,
      });
    } catch (cause) {
      console.warn('[kade] Could not read verified wallet balances:', cause);
      wallets.push({
        address: wallet.address,
        verifiedAt: wallet.verifiedAt,
        chainIds: wallet.chainIds,
        chains: [],
        usd: null,
        readError:
          cause instanceof Error
            ? cause.message
            : 'The balances could not be read.',
      });
    }
  }

  return {
    total,
    walletCount: wallets.length,
    valuedCount,
    unvaluedCount: wallets.length - valuedCount,
    wallets,
  };
}
