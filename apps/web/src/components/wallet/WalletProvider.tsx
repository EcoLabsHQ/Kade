'use client';

import type { ReactNode } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi';
import {
  WALLET_NETWORKS,
  appkitMetadata,
  walletProjectId,
  wagmiAdapter,
} from '@/lib/wallet/appkit';

/**
 * The wallet context for the fee payment.
 *
 * `createAppKit` runs once, at module scope, which is required: calling it
 * inside a component would create a second instance per render. It is guarded
 * on the project id so an environment without one simply renders its children
 * with no wallet context, and the fee step reports "not configured" rather than
 * crashing the route.
 *
 * `cookieToInitialState` hydrates the wagmi state from the request cookies, so
 * a reload does not flash a disconnected state before the wallet reconnects.
 */

const queryClient = new QueryClient();

if (wagmiAdapter && walletProjectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks: WALLET_NETWORKS,
    projectId: walletProjectId,
    metadata: appkitMetadata,
    features: { analytics: false },
  });
}

export function WalletProvider({
  cookies,
  children,
}: Readonly<{ cookies: string | null; children: ReactNode }>) {
  if (!wagmiAdapter) return <>{children}</>;

  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies,
  );

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
