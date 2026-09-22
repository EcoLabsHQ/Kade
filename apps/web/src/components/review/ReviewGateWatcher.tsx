'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  subscribeToApplicationChanges,
  type RealtimeClientLike,
} from '@/lib/review/realtime';

/**
 * Keeps the resident's review gate live.
 *
 * Subscribes to `applications` row changes for the signed-in resident and asks
 * Next to re-render when one arrives, so the reviewer's action flips the gate
 * without a manual reload. When Supabase is not configured in this environment
 * the subscription cannot be established, so it falls back to a slow poll — the
 * gate still flips, just not instantly.
 */
export interface ReviewGateWatcherProps {
  readonly userId: string;
  /** Polling fallback interval, in milliseconds. */
  readonly pollIntervalMs?: number;
}

export function ReviewGateWatcher({
  userId,
  pollIntervalMs = 20_000,
}: ReviewGateWatcherProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const refresh = () => routerRef.current.refresh();
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    try {
      const client = createSupabaseBrowserClient();
      unsubscribe = subscribeToApplicationChanges(
        client as unknown as RealtimeClientLike,
        userId,
        refresh,
      );
    } catch {
      timer = setInterval(refresh, pollIntervalMs);
    }

    return () => {
      unsubscribe?.();
      if (timer) clearInterval(timer);
    };
  }, [userId, pollIntervalMs]);

  return null;
}
