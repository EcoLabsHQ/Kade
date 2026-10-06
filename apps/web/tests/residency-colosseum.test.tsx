import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(screen.getByTestId('colosseum-qualified')).toHaveTextContent('$4.00');
    expect(screen.getByTestId('colosseum-threshold')).toHaveTextContent(
      '10 USDC',
    );
    expect(screen.queryByTestId('colosseum-state-c')).toBeNull();
  });

  it('State A: shows a fractional qualified figure in full, not truncated at the point', () => {
    // The reported defect: the figure was read with `/^\$([\d,]+)/`, so a
    // two-decimal "$9.84" was truncated to "$9".
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts({ qualified: { status: 'known', usd: 9.838 } }))}
      />,
    );

    expect(screen.getByTestId('colosseum-qualified')).toHaveTextContent('$9.84');
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

  it('State D → E: becoming a citizen celebrates with the full-screen passport and clears the highlight', () => {
    render(<ColosseumResidency tier="colosseum" checks={checks(facts())} />);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    // The highlight is on in State D.
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    // The inline artifact stays on the page…
    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-passport-serial')).toHaveTextContent(
      /^KADE-CL-/,
    );
    // …and the milestone plays the full-screen passport reveal.
    const overlay = screen.getByTestId('colosseum-passport-overlay');
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText(/virtual passport/i)).toBeInTheDocument();
    expect(
      within(overlay).getByText(/not a real travel or identity document/i),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByText(/demo artifact only/i),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByTestId('colosseum-passport-overlay-serial'),
    ).toHaveTextContent(/^KADE-CL-/);
    // The overlay is a labelled, modal dialog.
    expect(
      screen.getByRole('dialog', { name: /virtual citizenship passport/i }),
    ).toHaveAttribute('aria-modal', 'true');
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

/* -------------------------------------------------------------------------- */
/* Full-screen reveals: the virtual residency pass, the passport, reduced motion */
/* -------------------------------------------------------------------------- */

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

describe('ColosseumResidency — the virtual residency pass', () => {
  const KEY = 'app-pass';

  it('claims the pass from the resident state, reveals it full-screen, and persists the demo serial', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );

    const overlay = screen.getByTestId('colosseum-residency-pass-overlay');
    expect(
      within(overlay).getByText(/virtual residency pass/i),
    ).toBeInTheDocument();
    expect(within(overlay).getByText('Demo')).toBeInTheDocument();
    expect(
      within(overlay).getByText(/not a real residency, status or document/i),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByTestId('colosseum-residency-pass-holder'),
    ).toHaveTextContent('Kade Resident');
    expect(
      within(overlay).getByTestId('colosseum-residency-pass-serial'),
    ).toHaveTextContent(/^KADE-RES-/);
    expect(
      within(overlay).getByTestId('colosseum-residency-pass-issued'),
    ).not.toHaveTextContent('—');

    // A labelled, modal dialog.
    const dialog = screen.getByRole('dialog', {
      name: /colosseum residency pass/i,
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // The claim is persisted as demo state.
    const stored = JSON.parse(
      window.localStorage.getItem(`kade.colosseum.progress.${KEY}`)!,
    ) as { residencyPassAt: string | null; residencyPassSerial: string | null };
    expect(stored.residencyPassSerial).toMatch(/^KADE-RES-/);
    expect(stored.residencyPassAt).not.toBeNull();
  });

  it('dismisses with Escape, a click outside and the visible close control, and restores the page', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('colosseum-residency-pass-overlay')).toBeNull();
    // The page behind is not left scroll-locked.
    expect(document.body.style.overflow).not.toBe('hidden');

    // Re-open, then click the backdrop.
    fireEvent.click(screen.getByRole('button', { name: /view residency pass/i }));
    const dialog = screen.getByRole('dialog', {
      name: /colosseum residency pass/i,
    });
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByTestId('colosseum-residency-pass-overlay')).toBeNull();

    // Re-open, then use the visible close control.
    fireEvent.click(screen.getByRole('button', { name: /view residency pass/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('colosseum-residency-pass-overlay')).toBeNull();
  });

  it('re-opens the same persisted pass after a reload rather than minting a new one', () => {
    const { unmount } = render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    const serial = within(
      screen.getByTestId('colosseum-residency-pass-overlay'),
    ).getByTestId('colosseum-residency-pass-serial').textContent;
    unmount();

    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    // Already claimed: the action re-opens instead of offering a fresh claim.
    fireEvent.click(screen.getByRole('button', { name: /view residency pass/i }));
    expect(screen.getByTestId('colosseum-residency-pass-serial')).toHaveTextContent(
      serial!,
    );
  });

  it('keeps the claimed residency pass when citizenship is later recorded', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    const claimed = JSON.parse(
      window.localStorage.getItem(`kade.colosseum.progress.${KEY}`)!,
    ) as { residencyPassAt: string | null; residencyPassSerial: string | null };
    fireEvent.keyDown(document, { key: 'Escape' });

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    // Recording citizenship must not drop the already-claimed pass fields.
    const stored = JSON.parse(
      window.localStorage.getItem(`kade.colosseum.progress.${KEY}`)!,
    ) as { residencyPassAt: string | null; residencyPassSerial: string | null };
    expect(stored.residencyPassSerial).toBe(claimed.residencyPassSerial);
    expect(stored.residencyPassAt).toBe(claimed.residencyPassAt);
  });

  it('offers the full-screen passport from the inline artifact after a stored citizenship', () => {
    window.localStorage.setItem(
      `kade.colosseum.progress.${KEY}`,
      JSON.stringify({
        residentSince: '2026-01-01T00:00:00.000Z',
        citizenAt: '2026-01-02T00:00:00.000Z',
        passportSerial: 'KADE-CL-ABCD2345',
        residencyPassAt: null,
        residencyPassSerial: null,
      }),
    );

    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    // A stored citizen does not auto-open the reveal…
    expect(screen.queryByTestId('colosseum-passport-overlay')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /open full-screen passport/i }),
    );
    const overlay = screen.getByTestId('colosseum-passport-overlay');
    expect(
      within(overlay).getByTestId('colosseum-passport-overlay-serial'),
    ).toHaveTextContent('KADE-CL-ABCD2345');
    // The issue date comes from the recorded citizenship instant.
    expect(
      within(overlay).getByTestId('colosseum-passport-overlay-issued'),
    ).toHaveTextContent('02 Jan 2026');
  });
});

describe('ColosseumResidency — reduced motion', () => {
  const KEY = 'app-reduced';

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('skips the pass reveal animation but still renders a readable pass', () => {
    mockMatchMedia(true);
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );

    expect(screen.getByTestId('colosseum-residency-pass-serial')).toHaveTextContent(
      /^KADE-RES-/,
    );
    expect(document.querySelector('.kade-reveal-backdrop')).toBeNull();
    expect(document.querySelector('.kade-reveal-card')).toBeNull();
    expect(document.querySelector('.kade-residency-pass-reveal')).toBeNull();
    expect(document.querySelector('.kade-residency-pass-flip')).toBeNull();
  });

  it('skips the passport reveal animation but still renders a readable passport', () => {
    mockMatchMedia(true);
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    expect(screen.getByTestId('colosseum-passport-overlay-serial')).toHaveTextContent(
      /^KADE-CL-/,
    );
    expect(document.querySelector('.kade-reveal-backdrop')).toBeNull();
    expect(document.querySelector('.kade-passport-flip')).toBeNull();
  });

  it('applies the reveal animation when reduced motion is not requested', () => {
    // No matchMedia stub: the hook reports false, so the classes are applied.
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    expect(document.querySelector('.kade-reveal-backdrop')).not.toBeNull();
    expect(document.querySelector('.kade-residency-pass-reveal')).not.toBeNull();
    expect(document.querySelector('.kade-residency-pass-flip')).not.toBeNull();
  });
});
