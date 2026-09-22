'use client';

import type { ReactNode } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, type Config } from 'wagmi';
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
 * The connection is opt-in: a reload starts disconnected and the resident
 * stays disconnected until they click a Connect button. Two mechanisms are
 * deliberately *not* used, because both are worse than they look:
 *
 *  - `createAppKit({ enableReconnect: false })` does not merely skip the
 *    reconnect. AppKit's `initialize()` calls `unSyncExistingConnection()`
 *    when it is false, which *actively disconnects* any existing connection
 *    (`@reown/appkit/dist/esm/src/client/appkit-base-client.js:224-230`,
 *    `:1133-1141`). A resident who had just connected was dropped mid-payment.
 *
 *  - `<WagmiProvider reconnectOnMount={false}>` clears
 *    `config.state.connections` on *every* mount
 *    (`node_modules/wagmi/dist/esm/hydrate.js`), so remounting the provider
 *    during the payment flow would tear down a live connection even though the
 *    wallet is still authorized.
 *
 * Instead, the persisted connection is simply never handed to wagmi. A
 * previous visit's connection is only reattached through the `initialState`
 * fed to `WagmiProvider` (via `cookieToInitialState`); rendering it without
 * `initialState` means that cookie-restored state is never hydrated, so a
 * fresh page load starts disconnected. `reconnectOnMount` is left at wagmi's
 * default so an in-session connection survives a provider remount.
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

export function WalletProvider({ children }: Readonly<{ children: ReactNode }>) {
  if (!wagmiAdapter) return <>{children}</>;

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
