import {
  assertSessionCannotAuthoriseTransaction,
  type ApplicationSession,
  type TransactionAuthorisation,
} from '@kade/shared';

/**
 * Transaction-authorisation seam.
 *
 * Contract section 2 items 3-4: Google credentials cannot authorise financial
 * transactions; only the passkey can. The guard is a runtime throw here and a
 * type error wherever the signature is used.
 *
 * There is no signing implementation in Week 1 (the Safe signer address is an
 * Account-gate input), so this function only proves the separation.
 */
export function asTransactionAuthorisation(
  authorisation: TransactionAuthorisation | ApplicationSession,
): TransactionAuthorisation {
  assertSessionCannotAuthoriseTransaction(authorisation);
  return authorisation;
}

export function describeAuthority(
  authorisation: TransactionAuthorisation | ApplicationSession,
): 'application-session' | 'transaction-signing' {
  return authorisation.domain;
}
