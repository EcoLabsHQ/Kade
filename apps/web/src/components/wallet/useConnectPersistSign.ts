'use client';

import { useCallback, useRef, useState } from 'react';
import { useDisconnect, type useConnections, type useSignMessage } from 'wagmi';
import type { OwnershipCallbacks } from '@/lib/wallet/ownership-callbacks';

/**
 * The shared "connect → persist → sign → disconnect" attempt.
 *
 * This is the one place the ownership gesture is sequenced, so the Holdings
 * verify modal and onboarding Step 3 cannot drift apart. It owns no wallet
 * state and no UI: the caller reports the connected address and connector, and
 * this hook persists the address, asks the server for a challenge, signs it,
 * hands the signature back for verification, and always tears the connection
 * down afterwards.
 *
 * The order is load-bearing. Persist runs **before** the signature, so the
 * stored row always exists to carry `verified_at`; a signature that is skipped
 * or fails therefore leaves exactly the unverified row that connecting alone
 * used to produce. Nothing here can lose that row.
 *
 * Signing is opt-in: when the caller supplies no `signMessageAsync` or no
 * ownership callbacks, the hook persists and disconnects without signing — the
 * behaviour a read-only tracker and a Bitcoin/pasted address both rely on.
 *
 * The signature can also be **user-triggered**: with
 * `awaitSignatureConfirmation` the attempt pauses in `awaiting-sign` after the
 * address is persisted and only proceeds when the caller invokes
 * `confirmSignature()` (or settles via `skip()`). The Holdings verify modal
 * leaves the option off and keeps its single-gesture behaviour.
 *
 * Hooks are called unconditionally here. The component that supplies
 * `signMessageAsync` (and therefore calls wagmi's `useSignMessage`) is mounted
 * only when signing is actually available, so a component that never signs
 * never reaches for a signer.
 */

/** One live wagmi connection, as `useConnections` reports it. */
type WalletConnection = ReturnType<typeof useConnections>[number];
/** The wagmi connector a connection belongs to. */
export type WalletConnector = WalletConnection['connector'];
/** wagmi's signer, forwarded from `useSignMessage`. */
export type SignMessageAsync = ReturnType<typeof useSignMessage>['signMessageAsync'];

export type ConnectPersistSignPhase =
  | 'idle'
  | 'connecting'
  | 'persisting'
  /** Persisted; waiting for the resident to trigger or skip the signature. */
  | 'awaiting-sign'
  | 'signing'
  | 'done';

/** What one attempt produced, so the caller can settle its own state. */
export interface ConnectPersistSignResult {
  /** The address was stored (or was already stored). Never false on skip. */
  readonly persisted: boolean;
  /** The server accepted the signature and set `verified_at`. */
  readonly verified: boolean;
  /** The resident chose "Skip for now" while the signature was requested. */
  readonly skipped: boolean;
  /** The failure message, when the attempt failed. */
  readonly error: string | null;
}

export interface ConnectPersistSignTarget {
  readonly address: string;
  readonly connector: WalletConnector;
}

export interface UseConnectPersistSignOptions {
  /** Persist the connected address (`addConnectedWallet`). */
  readonly persist: (address: string) => Promise<unknown>;
  /**
   * wagmi's signer. When omitted (or when `onBegin`/`onComplete` are omitted)
   * the address is persisted and the connection torn down without signing.
   */
  readonly signMessageAsync?: SignMessageAsync;
  readonly onBegin?: OwnershipCallbacks['onBegin'];
  readonly onComplete?: OwnershipCallbacks['onComplete'];
  readonly onLinked?: OwnershipCallbacks['onLinked'];
  /**
   * Whether a persistence failure should also disconnect. The verify modal
   * does; the onboarding panel keeps the connection live so the resident can
   * retry the store, which is today's behaviour.
   */
  readonly disconnectOnPersistFailure?: boolean;
  /**
   * When true, the signature is **not** fired automatically once the address is
   * persisted. The attempt pauses in `awaiting-sign` until the caller invokes
   * `confirmSignature()` (the resident's explicit "Sign to verify") or `skip()`.
   * The address is persisted first either way, so a skip leaves exactly the
   * unverified row. Defaults to false: the Holdings verify modal signs in one
   * gesture and must not regress.
   */
  readonly awaitSignatureConfirmation?: boolean;
}

export interface ConnectPersistSignController {
  readonly phase: ConnectPersistSignPhase;
  /**
   * True only when the last attempt's signature was accepted by the server and
   * `verified_at` was set. It is false for a persist-only attempt (no proof
   * callbacks), a skip, or a failure, and is cleared by `beginConnecting` and
   * `reset`. This is what a caller must key a "signed" mark on, because
   * `phase === 'done'` also covers the persist-only path that signs nothing.
   */
  readonly verified: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  /** The address whose signature is currently being requested, if any. */
  readonly activeAddress: string | null;
  /** Run one full attempt. Resolves once the connection is torn down. */
  readonly run: (target: ConnectPersistSignTarget) => Promise<ConnectPersistSignResult>;
  /** Enter the `connecting` phase while the caller opens AppKit. */
  readonly beginConnecting: () => void;
  /**
   * Leave `awaiting-sign` and request the signature. No-op otherwise, so it is
   * safe to leave wired to a button that is only rendered in that phase.
   */
  readonly confirmSignature: () => void;
  /** Skip the in-flight signature; the persisted row is kept. */
  readonly skip: () => void;
  /** Return to `idle` and clear the error. */
  readonly reset: () => void;
}

/** Thrown internally when the resident skips the signature request. */
const SKIP = Symbol('connect-persist-sign-skip');

/** A promise whose settlement the caller controls, without unhandled rejections. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (cause: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A skip can be requested before anything awaits the promise; swallow the
  // rejection so it is never an unhandled one.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function useConnectPersistSign(
  options: UseConnectPersistSignOptions,
): ConnectPersistSignController {
  const { disconnect } = useDisconnect();
  const [phase, setPhase] = useState<ConnectPersistSignPhase>('idle');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAddress, setActiveAddress] = useState<string | null>(null);

  // The options change identity on every render of the parent; a ref keeps the
  // stable `run` reading the latest closures without re-creating itself.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

  // Set while a signature is being requested, so `skip` can settle the race.
  const skipRef = useRef<(() => void) | null>(null);
  // Set only while paused in `awaiting-sign`, so `confirmSignature` can resume
  // the attempt. Cleared on every other phase.
  const confirmRef = useRef<(() => void) | null>(null);

  const skip = useCallback(() => {
    skipRef.current?.();
  }, []);

  const confirmSignature = useCallback(() => {
    confirmRef.current?.();
  }, []);

  const reset = useCallback(() => {
    skipRef.current = null;
    confirmRef.current = null;
    setPhase('idle');
    setVerified(false);
    setError(null);
    setActiveAddress(null);
  }, []);

  const beginConnecting = useCallback(() => {
    setError(null);
    // A new attempt starts unverified: a previous verification's beat must not
    // survive into the next connect.
    setVerified(false);
    setPhase('connecting');
  }, []);

  const run = useCallback(
    async (target: ConnectPersistSignTarget): Promise<ConnectPersistSignResult> => {
      const { address, connector } = target;
      const {
        persist,
        signMessageAsync,
        onBegin,
        onComplete,
        onLinked,
        disconnectOnPersistFailure = true,
        awaitSignatureConfirmation = false,
      } = optionsRef.current;

      setError(null);
      setActiveAddress(null);
      setVerified(false);

      // 1. Persist first. An address that is not already stored becomes a row
      //    before any signature, so the row can always carry `verified_at`.
      setPhase('persisting');
      try {
        await persist(address);
      } catch (cause) {
        const message = messageOf(
          cause,
          'The address could not be saved as a watch-only row.',
        );
        setError(message);
        setPhase('idle');
        if (disconnectOnPersistFailure) {
          disconnectRef.current({ connector });
        }
        return { persisted: false, verified: false, skipped: false, error: message };
      }

      // 2. Sign only when the caller supplied the whole proof machinery.
      const canSign = Boolean(signMessageAsync && onBegin && onComplete);
      if (!canSign) {
        disconnectRef.current({ connector });
        setPhase('done');
        return { persisted: true, verified: false, skipped: false, error: null };
      }

      // From here every path settles the attempt: the connection is always torn
      // down and the active address cleared in the outer `finally`.
      try {
        // 2a. When requested, the signature is user-triggered: the attempt
        //     pauses after persisting, and the resident sees step 2. Only
        //     `confirmSignature` proceeds; `skip` settles it without signing.
        if (awaitSignatureConfirmation) {
          setPhase('awaiting-sign');
          setActiveAddress(address);
          const decision = deferred<'sign'>();
          confirmRef.current = () => decision.resolve('sign');
          skipRef.current = () => decision.reject(SKIP);
          try {
            await decision.promise;
          } catch (cause) {
            if (cause !== SKIP) throw cause;
            // Skipped before the wallet was asked: the persisted row is kept.
            setPhase('idle');
            return { persisted: true, verified: false, skipped: true, error: null };
          } finally {
            confirmRef.current = null;
            skipRef.current = null;
          }
        }

        // 2b. Ask the server for the challenge and the wallet to sign it.
        setPhase('signing');
        setActiveAddress(address);
        const skipped = deferred<never>();
        skipRef.current = () => skipped.reject(SKIP);
        try {
          const challenge = await onBegin!(address);
          // Race the wallet's signature against "Skip for now". A skip settles
          // this immediately; the wallet's own promise is left handled.
          const signature = await Promise.race([
            signMessageAsync!({
              account: address as `0x${string}`,
              message: challenge.message,
            }),
            skipped.promise,
          ]);
          const result = await onComplete!({
            address,
            message: challenge.message,
            signature,
          });
          if (!result.ok) {
            throw new Error(
              'The signature did not verify; the wallet was not verified.',
            );
          }
          onLinked?.();
          setVerified(true);
          setPhase('done');
          return { persisted: true, verified: true, skipped: false, error: null };
        } catch (cause) {
          if (cause === SKIP) {
            // The row is already persisted: skipping only drops the proof.
            setPhase('idle');
            return { persisted: true, verified: false, skipped: true, error: null };
          }
          const message = messageOf(
            cause,
            'The signature did not verify; the wallet was not verified.',
          );
          setError(message);
          setPhase('idle');
          return { persisted: true, verified: false, skipped: false, error: message };
        } finally {
          skipRef.current = null;
        }
      } finally {
        confirmRef.current = null;
        skipRef.current = null;
        setActiveAddress(null);
        disconnectRef.current({ connector });
      }
    },
    [],
  );

  return {
    phase,
    verified,
    error,
    busy:
      phase === 'connecting' ||
      phase === 'persisting' ||
      phase === 'awaiting-sign' ||
      phase === 'signing',
    activeAddress,
    run,
    beginConnecting,
    confirmSignature,
    skip,
    reset,
  };
}
