'use client';

import { useRouter } from 'next/navigation';
import {
  WalletLinkPanel,
  type WalletLinkPanelProps,
} from './WalletLinkPanel';

/**
 * Binds the link panel's `onLinked` to a router refresh, so the newly verified
 * wallet appears in the aggregate without a manual reload. Kept as a thin client
 * wrapper because a Server Component cannot pass a plain callback; the server
 * actions themselves are passed straight through.
 */
export function LinkedWalletSection(
  props: Omit<WalletLinkPanelProps, 'onLinked'>,
) {
  const router = useRouter();
  return <WalletLinkPanel {...props} onLinked={() => router.refresh()} />;
}
