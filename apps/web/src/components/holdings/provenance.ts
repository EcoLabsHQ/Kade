import { CONNECTED_WALLET_PROVIDER, EVM_PROVIDER } from '@/lib/wealth/types';

/**
 * The resident-facing name of an unverified wallet's provenance.
 *
 * A connected wallet and a pasted EVM address are both displayed unverified in
 * Holdings (week-2 contract v1.2 and v1.3), and the screen distinguishes them by
 * how they arrived. Shared by the table and the verify modal so the two cannot
 * label the same row differently.
 */
export function provenanceLabel(provider: string): string {
  switch (provider) {
    case CONNECTED_WALLET_PROVIDER:
      return 'Connected wallet';
    case EVM_PROVIDER:
      return 'Pasted address';
    default:
      return provider;
  }
}
