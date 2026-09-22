/**
 * Realtime subscription for the resident's review gate.
 *
 * The reviewer's action inserts a `review_events` row; the trigger flips
 * `applications.status`; this subscription hears the row change and asks Next to
 * re-render, so the gate flips live rather than waiting for a manual refresh.
 * Supabase Realtime applies RLS to `postgres_changes`, so a resident only ever
 * receives their own application row.
 *
 * The client is injected and typed structurally so the wiring is testable
 * without a live Realtime connection. `subscribeToApplicationChanges` returns an
 * unsubscribe function.
 */

export interface RealtimeChannelLike {
  on(
    type: 'postgres_changes',
    filter: {
      readonly event: string;
      readonly schema: string;
      readonly table: string;
      readonly filter: string;
    },
    callback: () => void,
  ): RealtimeChannelLike;
  subscribe(): RealtimeChannelLike;
}

export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): void;
}

export function subscribeToApplicationChanges(
  client: RealtimeClientLike,
  userId: string,
  onChange: () => void,
): () => void {
  const channel = client
    .channel(`review-gate:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'applications',
        filter: `profile_id=eq.${userId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
