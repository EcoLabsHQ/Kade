import type { EvmChainBalance } from '@/lib/wealth/types';

/**
 * The one place a balance-read failure is turned into display text for the
 * connected-wallet surfaces.
 *
 * The Holdings fix introduced `EvmChainBalance.tokenFailure?: EvmReadFailure`
 * and folds every unread reason into the record's `readError`; this helper does
 * not invent a second mechanism, it just reuses both:
 *
 *   - a chain that read natively but whose USDC sub-read failed is named as
 *     `USDC — <reason>`, the same wording the Holdings verification modal uses;
 *   - a whole-chain failure keeps the record's own `readError` message.
 *
 * The token messages are removed from `readError` before the remainder is
 * rendered, so a wallet with both a token and a chain failure names each reason
 * exactly once. A fully successful read yields nothing and no zero is ever
 * fabricated for an unread amount.
 */
export interface ReadFailureSource {
  readonly chains?: readonly EvmChainBalance[];
  readonly readError?: string | null;
}

export function readFailureNotes(
  source: ReadFailureSource,
): readonly string[] {
  const notes: string[] = [];
  let remainder = source.readError ?? '';
  for (const chain of source.chains ?? []) {
    const failure = chain.tokenFailure;
    if (!failure) continue;
    notes.push(`USDC — ${failure.message}`);
    remainder = remainder.replace(failure.message, ' ');
  }
  const wholeChainReason = remainder.trim();
  if (wholeChainReason !== '') notes.push(wholeChainReason);
  return notes;
}
