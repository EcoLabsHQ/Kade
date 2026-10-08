import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import { ColosseumResidency } from '@/components/residency/ColosseumResidency';
import {
  EMPTY_COLOSSEUM_PROGRESS,
  type ColosseumProgress,
} from '@/components/residency/colosseum-progress';
import { isColosseumAttention } from '@/components/shell/colosseum-attention';

/**
 * The claim notice (human requirement d).
 *
 * When the mocked 2-minute compliance window finishes, the nav shows a red dot
 * instead of going blue, and the residency view raises a small button that says
 * citizenship can now be claimed. Confirming it must run the *existing* citizen
 * reveal exactly once — not a second reveal, and not twice for a resident who
 * saw the prompt and then confirmed.
 */

vi.mock('@/components/residency/reveal-sound', async (importActual) => {
  const actual =
    await importActual<typeof import('@/components/residency/reveal-sound')>();
  return {
    ...actual,
    playCitizenshipCue: vi.fn(actual.playCitizenshipCue),
    playResidencyCue: vi.fn(actual.playResidencyCue),
  };
});

import {
  playCitizenshipCue,
  playResidencyCue,
} from '@/components/residency/reveal-sound';

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: 'colosseum',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'n',
    },
    qualified: { status: 'known', usd: 10 },
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
    ...overrides,
  };
}

function checks(f: ResidencyFacts) {
  return deriveResidencyView(f, true).checks;
}

function progress(overrides: Partial<ColosseumProgress> = {}): ColosseumProgress {
  return { ...EMPTY_COLOSSEUM_PROGRESS, ...overrides };
}

/** Claim the residency pass and dismiss its reveal, leaving the window running. */
function claimResidencyAndDismiss(): void {
  fireEvent.click(
    screen.getByRole('button', { name: /claim colosseum residency/i }),
  );
  fireEvent.keyDown(document, { key: 'Escape' });
}

/** Elapse the 2-minute compliance window. */
function elapseWindow(): void {
  act(() => {
    vi.advanceTimersByTime(120_000);
  });
}

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.mocked(playCitizenshipCue).mockClear();
  vi.mocked(playResidencyCue).mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('ColosseumResidency — the claimable notice', () => {
  const KEY = 'app-claim-notice';

  it('raises the notice only once the window has elapsed, and flags the nav', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    claimResidencyAndDismiss();

    // Still counting down: no notice and no nav flag.
    expect(screen.queryByTestId('colosseum-claimable-notice')).toBeNull();
    expect(isColosseumAttention()).toBe(false);

    elapseWindow();

    // The window finished: the residency view and the nav both say so.
    const notice = screen.getByTestId('colosseum-claimable-notice');
    expect(notice).toHaveTextContent(/citizenship can now be claimed/i);
    expect(isColosseumAttention()).toBe(true);
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBe('1');
  });

  it('is a keyboard-reachable button that opens an announced dialog', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    claimResidencyAndDismiss();
    elapseWindow();

    const trigger = screen.getByTestId('colosseum-claimable-notice');
    // A real button with a dialog relationship, not a hover-only tooltip.
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', {
      name: /colosseum citizenship is ready to claim/i,
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent(/2-minute compliance window has elapsed/i);
    expect(
      within(dialog).getByRole('button', { name: /become a citizen/i }),
    ).toBeInTheDocument();
  });

  it('confirming runs the existing citizenship reveal exactly once', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    claimResidencyAndDismiss();
    elapseWindow();

    const cue = vi.mocked(playCitizenshipCue);
    expect(cue).not.toHaveBeenCalled();

    // The resident sees the prompt, then confirms it.
    fireEvent.click(screen.getByTestId('colosseum-claimable-notice'));
    const dialog = screen.getByRole('dialog', {
      name: /colosseum citizenship is ready to claim/i,
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /become a citizen/i }),
    );

    // The existing, one-shot celebratory reveal — not a second one.
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(document.querySelectorAll('.kade-reveal-card-celebration')).toHaveLength(1);
    expect(document.querySelectorAll('.kade-celebration-bloom')).toHaveLength(1);
    expect(cue).toHaveBeenCalledTimes(1);
    // The prompt is gone with the resident state it belonged to.
    expect(screen.queryByTestId('colosseum-claimable-notice')).toBeNull();
  });

  it('does not replay the reveal when the prompt is re-opened and dismissed', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    claimResidencyAndDismiss();
    elapseWindow();

    // Open the prompt and back out without confirming.
    fireEvent.click(screen.getByTestId('colosseum-claimable-notice'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', {
        name: /colosseum citizenship is ready to claim/i,
      }),
    ).toBeNull();
    // Nothing was claimed: no reveal, no cue.
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();
    expect(vi.mocked(playCitizenshipCue)).not.toHaveBeenCalled();

    // Confirming now runs it once.
    fireEvent.click(screen.getByTestId('colosseum-claimable-notice'));
    fireEvent.click(
      within(
        screen.getByRole('dialog', {
          name: /colosseum citizenship is ready to claim/i,
        }),
      ).getByRole('button', { name: /become a citizen/i }),
    );
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
    expect(vi.mocked(playCitizenshipCue)).toHaveBeenCalledTimes(1);
  });

  it('clears the nav flag when the resident becomes a citizen (no stale true)', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    claimResidencyAndDismiss();
    elapseWindow();
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBe('1');

    fireEvent.click(screen.getByTestId('colosseum-claimable-notice'));
    fireEvent.click(
      within(
        screen.getByRole('dialog', {
          name: /colosseum citizenship is ready to claim/i,
        }),
      ).getByRole('button', { name: /become a citizen/i }),
    );

    expect(isColosseumAttention()).toBe(false);
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBeNull();
  });

  it('never raises the notice or the nav flag for a stored citizen', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
        initialProgress={progress({
          residentSince: '2026-01-01T00:00:00.000Z',
          citizenAt: '2026-01-01T00:02:00.000Z',
          passportSerial: 'KADE-CL-ABCD2345',
          residencyPassAt: '2026-01-01T00:01:00.000Z',
          residencyPassSerial: 'KADE-RES-ABCD2345',
        })}
      />,
    );

    expect(screen.queryByTestId('colosseum-claimable-notice')).toBeNull();
    expect(isColosseumAttention()).toBe(false);
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBeNull();
  });

  it('never raises the notice for a resident whose window is still running', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
        initialProgress={progress({
          residentSince: new Date(Date.now() - 60_000).toISOString(),
          residencyPassAt: '2026-01-01T00:00:00.000Z',
          residencyPassSerial: 'KADE-RES-ABCD2345',
        })}
      />,
    );

    expect(screen.getByTestId('colosseum-state-resident')).toBeInTheDocument();
    expect(screen.queryByTestId('colosseum-claimable-notice')).toBeNull();
    expect(isColosseumAttention()).toBe(false);
  });

  it('keeps the notice and its dot legible under reduced motion without the pulse', () => {
    mockMatchMedia(true);
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    claimResidencyAndDismiss();
    elapseWindow();

    const notice = screen.getByTestId('colosseum-claimable-notice');
    expect(notice).toBeInTheDocument();

    const dot = screen.getByTestId('colosseum-claimable-dot');
    // The static dot colour survives; only the pulse is dropped.
    expect(dot).not.toHaveClass('kade-claimable-dot-pulse');
    expect(dot.style.background).toBe('rgb(180, 35, 24)');

    // The affordance still works without animation.
    fireEvent.click(notice);
    expect(
      screen.getByRole('dialog', {
        name: /colosseum citizenship is ready to claim/i,
      }),
    ).toBeInTheDocument();
  });
});
