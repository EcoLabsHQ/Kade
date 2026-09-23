import { describe, expect, it, vi } from 'vitest';
import {
  subscribeToApplicationChanges,
  type RealtimeChannelLike,
  type RealtimeClientLike,
} from '@/lib/review/realtime';

/**
 * The resident's live gate is a Realtime subscription to their own application
 * row. This pins the wiring — the table, the filter and the unsubscribe — which
 * is what makes the gate flip from the reviewer's action rather than a manual
 * reload.
 */

interface Captured {
  filter: {
    event: string;
    schema: string;
    table: string;
    filter: string;
  };
  callback: () => void;
}

function createFakeClient(): {
  readonly client: RealtimeClientLike;
  readonly captured: Captured[];
  readonly removed: RealtimeChannelLike[];
  readonly channels: string[];
} {
  const captured: Captured[] = [];
  const removed: RealtimeChannelLike[] = [];
  const channels: string[] = [];
  const channel: RealtimeChannelLike = {
    on(_type, filter, callback) {
      captured.push({ filter, callback });
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return {
    client: {
      channel(name) {
        channels.push(name);
        return channel;
      },
      removeChannel(candidate) {
        removed.push(candidate);
      },
    },
    captured,
    removed,
    channels,
  };
}

describe('subscribeToApplicationChanges', () => {
  it('subscribes to updates for the resident\u2019s own application', () => {
    const { client, captured, channels } = createFakeClient();
    subscribeToApplicationChanges(client, 'user-1', () => {});

    expect(channels).toEqual(['review-gate:user-1']);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.filter).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'applications',
      filter: 'profile_id=eq.user-1',
    });
  });

  it('calls back on a change and removes the channel on unsubscribe', () => {
    const { client, captured, removed } = createFakeClient();
    const onChange = vi.fn();
    const unsubscribe = subscribeToApplicationChanges(client, 'user-1', onChange);

    captured[0]?.callback();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(removed).toHaveLength(1);
  });
});
