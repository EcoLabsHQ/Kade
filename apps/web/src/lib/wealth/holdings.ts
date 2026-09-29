/**
 * Holdings — the aggregate over **signature-verified** linked wallets, plus the
 * unverified wallets displayed beside them.
 *
 * Frozen decision §2.2 item 2: a linked wallet is proven by a signature over a
 * server-issued challenge (EIP-191 / EIP-4361-style), and that proof is required
 * to feed the Holdings total. As amended v1.2, a wallet connected during
 * onboarding (browser extension or WalletConnect) is displayed in Holdings too,
 * but as an **unverified** wallet, in its own labelled section and **excluded
 * from the total**. As amended v1.3, a **pasted EVM** (`0x…`) address is
 * displayed the same way, while a pasted **Bitcoin** address remains
 * registration-only and **never** feeds Holdings — that exclusion stays
 * structural, not a display convention.
 *
 * That structure lives here, in two parts:
 *
 *   1. `classifyWalletRows` is the only producer of a `VerifiedWallet` and of
 *      an `UnverifiedWallet`. A row is classified exactly once:
 *      - `verified_at` non-null            → VERIFIED (any provider);
 *      - `verified_at` null, provider
 *        `connected-wallet` or
 *        `pasted-address`                 → UNVERIFIED;
 *      - `verified_at` null, provider
 *        `bitcoin-address` (or none)      → EXCLUDED from Holdings.
 *      So a pasted Bitcoin row (`verified_at` NULL, the documented "unverified"
 *      meaning) can never satisfy the verified predicate and can never be passed
 *      in.
 *   2. Both classes are branded by a module-private `unique symbol`, so neither
 *      can be constructed with an object literal from outside this module.
 *      `aggregateHoldings` takes `VerifiedWallet[]` for the total and a separate
 *      `UnverifiedWallet[]` for the unverified section: the unverified class can
 *      never contribute to `total`, because the function never adds it.
 *
 * Balances are read through an injected reader (`readBalances`), so these
 * functions are pure, network-free and directly testable, and the same code is
 * reused for every wallet. A failed read is reported as a per-wallet `readError`
 * with a null value — never fabricated as zero.
 */

import {
  CONNECTED_WALLET_PROVIDER,
  EVM_PROVIDER,
  type EvmChainBalance,
} from './types';
import type { EvmReadFailure } from './evm';

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
 * Compile-time proof marker for a displayed, unverified wallet.
 *
 * Deliberately **not exported**, exactly like `ownershipProof`: a pasted row
 * cannot be named as one of these from outside this module, and the classifier
 * is the sole producer.
 */
declare const connectionProof: unique symbol;

/**
 * A wallet displayed in Holdings whose control was **not** proven: a connected
 * wallet or a pasted EVM address.
 *
 * `verified_at` is NULL and it is not evidence of control. It is shown in
 * Holdings in its own labelled section and is **excluded from the total**: it is
 * a separate class from `VerifiedWallet`, never a substitute for one. The
 * `provider` is carried through so the UI can show provenance (`connected-wallet`
 * or `pasted-address`) and label each row.
 */
export interface UnverifiedWallet {
  readonly [connectionProof]: true;
  /** Canonical address as stored, for display. */
  readonly address: string;
  /** The stored provider, so the UI can label provenance. */
  readonly provider: string;
  /** Distinct chains a stored row exists for, ascending. */
  readonly chainIds: readonly number[];
}

/** The exact partition of a resident's stored rows. */
export interface ClassifiedWalletRows {
  /** Signature-verified wallets; the only rows that feed the Holdings total. */
  readonly verified: readonly VerifiedWallet[];
  /**
   * Connected or pasted-EVM wallets, unverified; shown separately, never in the
   * total.
   */
  readonly unverifiedWallets: readonly UnverifiedWallet[];
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
 * The structural verified-only selection.
 *
 * Group the stored rows by address; a group is a verified wallet only when at
 * least one of its rows carries a usable `verified_at`. Rows without one (every
 * pasted Bitcoin and pasted EVM row) are omitted, so they cannot contribute a
 * holding; the classifier below may still display a pasted EVM row as
 * unverified. The earliest proof wins, and the address keeps every chain it has
 * a row for.
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
 * The providers that classify as displayed-but-unverified.
 *
 * A connected wallet and a pasted EVM address are shown; a pasted Bitcoin
 * address (`bitcoin-address`) is deliberately absent, so it stays excluded by
 * construction.
 */
const UNVERIFIED_PROVIDERS: ReadonlySet<string> = new Set([
  CONNECTED_WALLET_PROVIDER,
  EVM_PROVIDER,
]);

/**
 * Partition stored rows into the Holdings classes, exactly.
 *
 * This is the single classifier the Holdings loader uses:
 *
 *   - a row with a usable `verified_at` is VERIFIED, whatever its provider;
 *   - otherwise a row whose provider is `connected-wallet` or `pasted-address`
 *     is UNVERIFIED;
 *   - every other row — `verified_at` NULL with a `bitcoin-address` provider, or
 *     no provider at all — is EXCLUDED.
 *
 * A verified row always wins for its address: if the same address also has an
 * unverified row, only the verified class is produced. That keeps a wallet that
 * was later signature-verified out of the unverified section instead of showing
 * it twice. Like `selectVerifiedWallets`, the Bitcoin exclusion is a predicate
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
    { address: string; provider: string; chainIds: Set<number> }
  >();

  for (const row of rows) {
    // A usable verified_at means the row belongs to the verified class above.
    if (normalizeVerifiedAt(row.verifiedAt) !== null) continue;
    if (row.provider === null || !UNVERIFIED_PROVIDERS.has(row.provider)) {
      continue;
    }
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
      provider: row.provider,
      chainIds: new Set([row.chain]),
    });
  }

  const unverifiedWallets = [...byAddress.values()]
    .sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    )
    .map(
      (entry) =>
        ({
          address: entry.address,
          provider: entry.provider,
          chainIds: [...entry.chainIds].sort((a, b) => a - b),
        }) as unknown as UnverifiedWallet,
    );

  return { verified, unverifiedWallets };
}

/** The balances of one verified address, as returned by the injected reader. */
export interface VerifiedWalletBalances {
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  /**
   * Chains whose balance could not be read, each with a specific reason.
   *
   * Optional so a reader that only reports successful reads remains valid; when
   * present, the reasons are carried through to the UI instead of being
   * flattened into a generic `readError`.
   */
  readonly failures?: readonly EvmReadFailure[];
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
  readonly failures: readonly EvmReadFailure[];
}

/**
 * Read one wallet's balances, turning a provider failure into a `readError`
 * rather than an exception or a fabricated zero. Shared by both classes, so an
 * unverified wallet's failed read is reported exactly as a verified one's.
 *
 * Per-chain failures are kept on `failures`, so the screen can name the chain
 * and the specific reason a balance is missing.
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
      failures: read.failures ?? [],
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
      failures: [],
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
  /**
   * Chains whose balance could not be read, each with its specific reason.
   * Optional so existing fixtures remain valid; when present the screen shows
   * the real reason rather than a generic "could not be read".
   */
  readonly failures?: readonly EvmReadFailure[];
}

/**
 * One displayed, unverified wallet in the aggregate.
 *
 * It is deliberately a separate type from `HoldingWallet`: it has no
 * `verifiedAt`, so a renderer cannot mistake it for a proven wallet.
 */
export interface UnverifiedHoldingWallet {
  readonly address: string;
  /** The stored provider (`connected-wallet` or `pasted-address`). */
  readonly provider: string;
  /** Chains the unverified wallet has a stored row for. */
  readonly chainIds: readonly number[];
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readError: string | null;
  /** Per-chain unread reasons, as on `HoldingWallet`. */
  readonly failures?: readonly EvmReadFailure[];
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
   * Connected or pasted-EVM, unverified wallets. Shown in their own labelled
   * section and **never** included in `total` or in
   * `valuedCount`/`unvaluedCount`.
   */
  readonly unverifiedWallets: readonly UnverifiedHoldingWallet[];
  /** How many unverified wallets there are. */
  readonly unverifiedCount: number;
}

/**
 * Aggregate the holdings of verified wallets, plus the unverified ones for a
 * separate section.
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
 * counts: neither a connection nor a pasted address is a signature, and neither
 * is evidence of control.
 */
export async function aggregateHoldings(input: {
  readonly wallets: readonly VerifiedWallet[];
  readonly unverifiedWallets?: readonly UnverifiedWallet[];
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
      failures: read.failures,
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
      failures: read.failures,
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

