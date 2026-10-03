import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import { ColosseumResidency } from '@/components/residency/ColosseumResidency';

/**
 * The mocked Colosseum sub-section inside Residency.
 *
 * States A–E are driven by the real derived checks; the 2-minute clock and the
 * passport are component state. The clock is advanced with fake timers so the
 * "Become a Citizen" gate and the nav highlight can be exercised without a real
 * two-minute wait.
 */

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

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
});

describe('ColosseumResidency — states', () => {
  it('State A: below 10 USDC shows the threshold and the real qualified figure', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts({ qualified: { status: 'known', usd: 4 } }))}
      />,
    );

    expect(screen.getByTestId('colosseum-state-a')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-qualified')).toHaveTextContent('$4');
    expect(screen.getByTestId('colosseum-threshold')).toHaveTextContent(
      '10 USDC',
    );
    expect(screen.queryByTestId('colosseum-state-c')).toBeNull();
  });

  it('State A: an unread vault never shows a fabricated figure', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(
          facts({ qualified: { status: 'unknown', reason: 'RPC failed.' } }),
        )}
      />,
    );

    expect(screen.getByTestId('colosseum-qualified')).toHaveTextContent(
      'Not available yet',
    );
    expect(screen.getByTestId('colosseum-qualified')).not.toHaveTextContent(/\$/);
  });

  it('State B: funds met but other checks pending shows the steps pop-up pointer', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts({ identity: null }))}
      />,
    );

    expect(screen.getByTestId('colosseum-state-b')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /complete your residency steps/i }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('State C: all four checks green shows the congrats and the exact sentence', () => {
    render(<ColosseumResidency tier="colosseum" checks={checks(facts())} />);

    expect(screen.getByTestId('colosseum-state-c')).toBeInTheDocument();
    expect(screen.getByText(/you’re a colosseum resident/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /remain a compliant resident for 2 minutes to be eligible to become a colosseum citizen\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-countdown')).toHaveTextContent('2:00');
  });

  it('keeps "Become a Citizen" locked until the 2 minutes elapse', () => {
    render(<ColosseumResidency tier="colosseum" checks={checks(facts())} />);

    // Still counting down: no available citizen action yet.
    expect(screen.queryByTestId('colosseum-state-d')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /become a citizen/i }),
    ).toBeNull();

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(screen.getByTestId('colosseum-state-d')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /become a citizen/i }),
    ).toBeEnabled();
  });

  it('State D → E: becoming a citizen shows the virtual passport and clears the highlight', () => {
    render(<ColosseumResidency tier="colosseum" checks={checks(facts())} />);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    // The highlight is on in State D.
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(screen.getByText(/virtual passport/i)).toBeInTheDocument();
    // The artifact is still declared demo, and carries a serial/MRZ footer.
    expect(
      screen.getByText(/not a real travel or identity document/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the demo layer|demo artifact only/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-passport-serial')).toHaveTextContent(
      /^KADE-CL-/,
    );
    // Becoming a citizen clears the nav highlight.
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBeNull();
  });

  it('does not highlight or count down before the checks are green', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts({ review: 'pending' }))}
      />,
    );

    expect(window.localStorage.getItem('kade.colosseum.attention')).toBeNull();
    expect(screen.queryByTestId('colosseum-countdown')).toBeNull();
  });

  it('State A on a production tier points at the Colosseum tier instead of claiming 10 USDC reaches it', () => {
    render(
      <ColosseumResidency
        tier="5-year"
        checks={checks(
          facts({ tier: '5-year', qualified: { status: 'known', usd: 4 } }),
        )}
      />,
    );

    const stateA = screen.getByTestId('colosseum-state-a');
    // The real qualified figure is still shown, but the copy must not tell a
    // production-tier resident that 10 USDC unlocks their funds check.
    expect(stateA).toHaveTextContent(/choose the colosseum resident tier/i);
    expect(stateA).not.toHaveTextContent(/fund your qualified vault to reach the 10 usdc/i);
  });
});

describe('ColosseumResidency — persisted demo progress', () => {
  const KEY = 'app-42';

  it('resumes the countdown from the stored residentSince instead of restarting it', () => {
    // A window that started one minute ago: 1:00 should remain, not 2:00.
    window.localStorage.setItem(
      'kade.colosseum.progress.app-42',
      JSON.stringify({
        residentSince: new Date(Date.now() - 60_000).toISOString(),
        citizenAt: null,
        passportSerial: null,
      }),
    );

    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    expect(screen.getByTestId('colosseum-state-c')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-countdown')).toHaveTextContent('1:00');
  });

  it('shows the passport immediately from a stored citizenship, without re-animating', () => {
    window.localStorage.setItem(
      'kade.colosseum.progress.app-42',
      JSON.stringify({
        residentSince: '2026-01-01T00:00:00.000Z',
        citizenAt: '2026-01-01T00:02:00.000Z',
        passportSerial: 'KADE-CL-ABCD2345',
      }),
    );

    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-passport-serial')).toHaveTextContent(
      'KADE-CL-ABCD2345',
    );
    // A stored citizen load is not re-animated.
    expect(
      document.querySelector('.kade-passport-flip'),
    ).toBeNull();
    // And no countdown state is shown.
    expect(screen.queryByTestId('colosseum-countdown')).toBeNull();
  });

  it('writes citizenAt and a demo serial on becoming a citizen, and clears the clock on decay', () => {
    const { unmount } = render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByTestId('colosseum-state-d')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    const stored = JSON.parse(
      window.localStorage.getItem('kade.colosseum.progress.app-42')!,
    ) as { citizenAt: string | null; passportSerial: string | null };
    expect(stored.citizenAt).not.toBeNull();
    expect(stored.passportSerial).toMatch(/^KADE-CL-/);
    unmount();

    // Decay: checks stop being green before citizenship clears the live clock.
    window.localStorage.removeItem('kade.colosseum.progress.app-42');
    const { rerender } = render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    // Start the window, then drop a check.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(window.localStorage.getItem('kade.colosseum.progress.app-42')).not.toBeNull();
    rerender(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts({ review: 'pending' }))}
        profileKey={KEY}
      />,
    );
    const afterDecay = JSON.parse(
      window.localStorage.getItem('kade.colosseum.progress.app-42') ?? 'null',
    ) as { residentSince: string | null } | null;
    expect(afterDecay?.residentSince ?? null).toBeNull();
  });

  it('scopes the demo progress per profile', () => {
    window.localStorage.setItem(
      'kade.colosseum.progress.other-app',
      JSON.stringify({
        residentSince: null,
        citizenAt: null,
        passportSerial: null,
      }),
    );

    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    // A different profile's (empty) record must not hide this profile's clock.
    expect(screen.getByTestId('colosseum-state-c')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-countdown')).toHaveTextContent('2:00');
  });
});
