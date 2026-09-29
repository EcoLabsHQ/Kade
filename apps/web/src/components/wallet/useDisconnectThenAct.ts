'use client';

import { useCallback, useRef } from 'react';
import { useConnections, useDisconnect } from 'wagmi';

/**
 * "Disconnect first, then do the thing" — the sequenced wallet entry point.
 *
 * The owner requires that opening the wallet modals (the per-row "Move to
 * vault" dialog and the "Link & verify wallets" modal) never reuses a
 * carried-over connection: the connected wallet is torn down **before** the
 * modal opens, so the modal always starts in its "Not connected" state and the
 * resident reconnects deliberately.
 *
 * This is a sequence, not a race. `disconnectAsync` is awaited for every live
 * connection before `action()` runs, so the modal cannot open while a wallet is
 * still connected.
 *
 * The disconnect is best-effort. A connector that throws on disconnect (or a
 * teardown that otherwise fails) must not dead-end the resident, so the failure
 * is swallowed and `action()` still runs. The failure is returned via the
 * optional `onDisconnectError` callback, never thrown, so it cannot unwind the
 * sequence.
 *
 * The hook is wallet-free until it runs: it reads wagmi state through hooks, so
 * it may only be called where `WalletProvider` mounted a `WagmiProvider` (the
 * caller gates on `configured`, exactly as `FeeStep`'s `DepositControl` does).
 */
export interface DisconnectThenActOptions {
  /**
   * Called when a connection could not be torn down. The action still runs; a
   * caller that wants to surface the failure uses this. Errors never unwind the
   * sequence.
   */
  readonly onDisconnectError?: (cause: unknown) => void;
}

export interface DisconnectThenAct {
  /**
   * Disconnect every live connection, then run `action`. Resolves once `action`
   * has run. Never rejects: a failed disconnect still runs the action.
   */
  readonly run: <T>(action: () => T | Promise<T>) => Promise<T>;
}

export function useDisconnectThenAct({
  onDisconnectError,
}: DisconnectThenActOptions = {}): DisconnectThenAct {
  const connections = useConnections();
  const { disconnectAsync } = useDisconnect();

  // The options object is re-created on every render; a ref keeps the stable
  // `run` reading the latest callback without re-creating itself.
  const onDisconnectErrorRef = useRef(onDisconnectError);
  onDisconnectErrorRef.current = onDisconnectError;

  // `connections`/`disconnectAsync` change identity across renders; refs let
  // `run` stay stable while still seeing the current connections.
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const disconnectRef = useRef(disconnectAsync);
  disconnectRef.current = disconnectAsync;

  const run = useCallback(
    async <T,>(action: () => T | Promise<T>): Promise<T> => {
      // 1. Tear down every live connection, one at a time, and wait for each.
      //    A failure is reported but never stops the rest of the sequence.
      for (const connection of connectionsRef.current) {
        try {
          await disconnectRef.current({ connector: connection.connector });
        } catch (cause) {
          onDisconnectErrorRef.current?.(cause);
        }
      }
      // 2. Only now run the action that opens the modal.
      return await action();
    },
    [],
  );

  return { run };
}
