import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isColosseumAttention,
  setColosseumAttention,
  subscribeColosseumAttention,
} from '@/components/shell/colosseum-attention';

/**
 * The browser-local bridge that lets the client Residency screen tell the shell
 * nav that citizenship is claimable. These tests pin the honest mechanics: it
 * mirrors to `localStorage`, notifies same-tab subscribers, adopts a sibling
 * tab's change, and clears to "not claimable" without inventing a citizenship.
 */

const KEY = 'kade.colosseum.attention';

beforeEach(() => {
  window.localStorage.clear();
  setColosseumAttention(false);
});

afterEach(() => {
  setColosseumAttention(false);
  window.localStorage.clear();
});

describe('colosseum-attention bridge', () => {
  it('mirrors the claimable flag to localStorage and back', () => {
    expect(isColosseumAttention()).toBe(false);

    setColosseumAttention(true);
    expect(isColosseumAttention()).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('1');

    setColosseumAttention(false);
    expect(isColosseumAttention()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('notifies subscribers on a same-tab change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeColosseumAttention(listener);

    setColosseumAttention(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setColosseumAttention(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("adopts a sibling tab's storage change (best-effort cross-tab consistency)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeColosseumAttention(listener);

    window.localStorage.setItem(KEY, '1');
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: '1' }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(isColosseumAttention()).toBe(true);

    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeColosseumAttention(listener);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'kade.something.else', newValue: '1' }),
    );

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
