import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import { ColosseumResidency } from '@/components/residency/ColosseumResidency';
import { FullScreenReveal } from '@/components/residency/FullScreenReveal';

/**
 * The mocked Colosseum sub-section inside Residency.
 *
 * States A–E are driven by the real derived checks; the 2-minute clock and the
 * certificate are component state. The clock is advanced with fake timers so the
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
  // jsdom does not implement `scrollTo`, but the full-screen reveal's body
  // lock calls it to restore the scroll position on close.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
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

  it('State D → E: becoming a citizen celebrates with the full-screen certificate and clears the highlight', () => {
    render(<ColosseumResidency tier="colosseum" checks={checks(facts())} />);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    // The highlight is on in State D.
    expect(window.localStorage.getItem('kade.colosseum.attention')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    // The inline artifact stays on the page…
    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-certificate-serial')).toHaveTextContent(
      /^KADE-CL-/,
    );
    // …and the milestone plays the full-screen certificate reveal.
    const overlay = screen.getByTestId('colosseum-certificate-overlay');
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText(/colosseum citizenship certificate/i)).toBeInTheDocument();
    expect(
      within(overlay).getByText(/not a real citizenship, status or identity document/i),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByText(/demo artifact only/i),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByTestId('colosseum-certificate-overlay-serial'),
    ).toHaveTextContent(/^KADE-CL-/);
    // The overlay is a labelled, modal dialog.
    expect(
      screen.getByRole('dialog', { name: /colosseum citizenship certificate/i }),
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

  it('shows the certificate immediately from a stored citizenship, without re-animating', () => {
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
    expect(screen.getByTestId('colosseum-certificate-serial')).toHaveTextContent(
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
/* Full-screen reveals: the virtual residency pass, the certificate, reduced motion */
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

  it('opens the full-screen certificate from the inline artifact after a stored citizenship', () => {
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
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /open the citizenship certificate full-screen/i }),
    );
    const overlay = screen.getByTestId('colosseum-certificate-overlay');
    expect(
      within(overlay).getByTestId('colosseum-certificate-overlay-serial'),
    ).toHaveTextContent('KADE-CL-ABCD2345');
    // The issue date comes from the recorded citizenship instant.
    expect(
      within(overlay).getByTestId('colosseum-certificate-overlay-issued'),
    ).toHaveTextContent('02 Jan 2026');
  });
});

/* -------------------------------------------------------------------------- */
/* The residency pass security print                                           */
/* -------------------------------------------------------------------------- */

describe('ColosseumResidency — the residency pass security print', () => {
  const KEY = 'app-security-print';

  it('renders the circular guilloche inside the opaque credential card', () => {
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

    const grid = document.querySelector('.kade-residency-pass-guilloche');
    const card = document.querySelector('.kade-security-credential');
    expect(grid).not.toBeNull();
    expect(card).not.toBeNull();
    // The grid must be a descendant of the opaque credential card: as a sibling
    // security layer it sat *behind* the card's opaque background and was
    // invisible regardless of its opacity.
    expect(card!.contains(grid!)).toBe(true);
    expect(grid!.parentElement?.classList.contains('kade-layer-guilloche')).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The reveal motion is one fused timeline                                     */
/* -------------------------------------------------------------------------- */

describe('ColosseumResidency — the reveal motion is one fused timeline', () => {
  const KEY = 'app-fused-motion';

  it('applies exactly one flip transform to the residency pass reveal', () => {
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

    const flips = document.querySelectorAll(
      '.kade-residency-pass-flip, .kade-passport-flip, .kade-reveal-flip-celebration',
    );
    expect(flips).toHaveLength(1);
    // The credential card itself no longer carries its own rise animation.
    const credential = document.querySelector('.kade-security-credential');
    expect(credential).not.toBeNull();
    expect(credential!.className).not.toMatch(/kade-reveal-card|flip/);
  });

  it('uses the single fused celebration timeline for the live transition', () => {
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

    const flips = document.querySelectorAll(
      '.kade-passport-flip, .kade-reveal-flip-celebration',
    );
    expect(flips).toHaveLength(1);
    expect(document.querySelector('.kade-reveal-flip-celebration')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The inline certificate is the full-screen trigger                           */
/* -------------------------------------------------------------------------- */

describe('ColosseumResidency — the inline certificate control', () => {
  const KEY = 'app-trigger';

  function renderStoredCitizen() {
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
    return render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
  }

  it('makes the artifact a keyboard-reachable control that opens the reveal', () => {
    renderStoredCitizen();

    const trigger = screen.getByRole('button', {
      name: /open the citizenship certificate full-screen/i,
    });
    // A real button, not a bare clickable div: focusable and named.
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).not.toBeDisabled();
    // The artifact is a *sibling* of the overlay button, not a child, so the
    // card's text stays in the accessibility tree and the nesting is valid.
    const artifact = screen.getByTestId('colosseum-certificate');
    expect(artifact.parentElement).toBe(trigger.parentElement);
    expect(
      within(artifact).getByTestId('colosseum-certificate-serial'),
    ).toHaveTextContent('KADE-CL-ABCD2345');

    fireEvent.click(trigger);
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
  });

  it('no longer renders the separate "Open full-screen passport" button', () => {
    renderStoredCitizen();

    expect(
      screen.queryByRole('button', { name: /open full-screen passport/i }),
    ).toBeNull();
    // Exactly one control opens the certificate.
    expect(
      screen.getAllByRole('button', {
        name: /open the citizenship certificate full-screen/i,
      }),
    ).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The citizenship certificate reveal fires on the transition, exactly once    */
/* -------------------------------------------------------------------------- */

describe('ColosseumResidency — the citizenship certificate reveal timing', () => {
  const KEY = 'app-reveal-timing';

  it('opens the full-screen certificate on the live transition to citizen, not before', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );

    // Counting down: no reveal yet.
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    // Eligible but not yet a citizen: still no reveal.
    expect(screen.getByTestId('colosseum-state-d')).toBeInTheDocument();
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    // The milestone opens the reveal at the moment of citizenship.
    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
  });

  it('does not re-open after dismissal, even when the component re-renders', () => {
    const { rerender } = render(
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
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();

    // A later render (e.g. the parent re-fetching the real checks) must not
    // replay the celebration.
    rerender(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();

    // The inline artifact still offers the reveal on demand.
    fireEvent.click(
      screen.getByRole('button', { name: /open the citizenship certificate full-screen/i }),
    );
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
  });

  it('dismissing mid-reveal leaves no stuck state and can be re-opened', () => {
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
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();

    // Dismiss immediately, long before the ~1340ms timeline could settle.
    fireEvent.keyDown(document, { key: 'Escape' });

    // Nothing from the reveal is left mounted, and the page is not left locked.
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();
    expect(document.querySelector('.kade-reveal-backdrop')).toBeNull();
    expect(document.querySelector('.kade-reveal-card')).toBeNull();
    expect(document.querySelector('.kade-passport-sweep')).toBeNull();
    expect(document.querySelector('.kade-foil-light')).toBeNull();
    expect(document.querySelector('.kade-foil-pass')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.documentElement).not.toHaveAttribute('data-overlay-open');

    // The one-shot celebration does not replay, but the inline control re-opens.
    fireEvent.click(
      screen.getByRole('button', { name: /open the citizenship certificate full-screen/i }),
    );
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
  });

  it('does not auto-open for an already-citizen restored state', () => {
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

    // The inline artifact is present, but the reveal does not replay on load.
    expect(screen.getByTestId('colosseum-state-e')).toBeInTheDocument();
    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();
  });
});

describe('ColosseumResidency — the celebratory citizenship tier', () => {
  const KEY = 'app-celebration';

  function renderResident() {
    return render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts())}
        profileKey={KEY}
      />,
    );
  }

  function becomeCitizen() {
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));
  }

  it('applies the celebratory tier to the first, live transition only', () => {
    renderResident();
    becomeCitizen();

    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
    expect(document.querySelector('.kade-celebration')).not.toBeNull();
    expect(document.querySelector('.kade-reveal-card-celebration')).not.toBeNull();
    expect(document.querySelector('.kade-celebration-bloom')).not.toBeNull();
    expect(document.querySelector('.kade-celebration-sweep')).not.toBeNull();
    expect(
      document.querySelectorAll('.kade-celebration-ray').length,
    ).toBeGreaterThanOrEqual(8);
  });

  it('does not use the celebratory tier for a stored-citizen open', () => {
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
    renderResident();

    fireEvent.click(
      screen.getByRole('button', { name: /open the citizenship certificate full-screen/i }),
    );
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
    expect(document.querySelector('.kade-celebration')).toBeNull();
    expect(document.querySelector('.kade-celebration-ray')).toBeNull();
    // The standard tier's foil pass is used instead.
    expect(document.querySelector('.kade-foil-pass')).not.toBeNull();
  });

  it('falls back to the standard tier when re-opened after dismissal', () => {
    renderResident();
    becomeCitizen();
    expect(document.querySelector('.kade-celebration')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      screen.getByRole('button', { name: /open the citizenship certificate full-screen/i }),
    );

    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
    expect(document.querySelector('.kade-celebration')).toBeNull();
    expect(document.querySelector('.kade-celebration-ray')).toBeNull();
    expect(document.querySelector('.kade-foil-pass')).not.toBeNull();
  });

  it('dismissing mid-celebration leaves no stuck element', () => {
    renderResident();
    becomeCitizen();
    expect(document.querySelector('.kade-celebration-ray')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('colosseum-certificate-overlay')).toBeNull();
    expect(document.querySelector('.kade-celebration')).toBeNull();
    expect(document.querySelector('.kade-celebration-ray')).toBeNull();
    expect(document.querySelector('.kade-celebration-bloom')).toBeNull();
    expect(document.querySelector('.kade-celebration-sweep')).toBeNull();
    expect(document.querySelector('.kade-foil-light')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.documentElement).not.toHaveAttribute('data-overlay-open');
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

  it('skips the certificate reveal animation but still renders a readable certificate', () => {
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

    expect(screen.getByTestId('colosseum-certificate-overlay-serial')).toHaveTextContent(
      /^KADE-CL-/,
    );
    expect(document.querySelector('.kade-reveal-backdrop')).toBeNull();
    expect(document.querySelector('.kade-passport-flip')).toBeNull();
    // The reduced-motion path renders no moving sweep or foil element at all.
    expect(document.querySelector('.kade-passport-sweep')).toBeNull();
    expect(document.querySelector('.kade-foil-pass')).toBeNull();
    // It uses the static highlight instead, so the card is never left blank.
    expect(document.querySelector('.kade-foil-light-static')).not.toBeNull();
  });

  it('renders no celebratory overlays under reduced motion', () => {
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

    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
    expect(document.querySelector('.kade-celebration-stage')).toBeNull();
    expect(document.querySelector('.kade-celebration-ray')).toBeNull();
    expect(document.querySelector('.kade-celebration-sweep')).toBeNull();
    expect(document.querySelector('.kade-reveal-card-celebration')).toBeNull();
    // The static celebration fade is used instead.
    expect(
      document.querySelector('.kade-reveal-card-celebration-static'),
    ).not.toBeNull();
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

/* -------------------------------------------------------------------------- */
/* The full-screen reveal's page lock                                          */
/*                                                                             */
/* jsdom cannot measure layout, so the overlay's own scroll port is confirmed  */
/* visually in a browser. What can be asserted here is the body lock: it pins  */
/* the body with the fixed technique, flags the root, and restores the exact   */
/* previous inline styles and scroll position on close.                        */
/* -------------------------------------------------------------------------- */

describe('FullScreenReveal — the page lock', () => {
  function setPriorBodyStyles(): void {
    document.body.style.position = 'relative';
    document.body.style.top = '1px';
    document.body.style.left = '2px';
    document.body.style.right = '3px';
    document.body.style.overflow = 'scroll';
    document.body.style.paddingRight = '4px';
  }

  function priorBodyStyles() {
    return {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
  }

  function renderReveal() {
    return render(
      <FullScreenReveal
        open
        onClose={() => {}}
        title="Test artifact"
        announcement="Test artifact"
      >
        <div data-testid="test-artifact">artifact</div>
      </FullScreenReveal>,
    );
  }

  function pinScrollPosition(scrollY: number): void {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: scrollY,
    });
  }

  afterEach(() => {
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('data-overlay-open');
    Reflect.deleteProperty(window, 'scrollY');
  });

  it('pins the body with the fixed technique and flags the root while open', () => {
    setPriorBodyStyles();
    const scrollTo = vi.mocked(window.scrollTo);
    pinScrollPosition(420);

    renderReveal();

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-420px');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement).toHaveAttribute('data-overlay-open');
    // Opening must not move the page.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('restores the exact previous inline styles and scroll position on close', () => {
    setPriorBodyStyles();
    const previous = priorBodyStyles();
    const scrollTo = vi.mocked(window.scrollTo);
    pinScrollPosition(420);

    const { unmount } = renderReveal();
    expect(document.body.style.position).toBe('fixed');

    unmount();

    expect(priorBodyStyles()).toEqual(previous);
    expect(document.documentElement).not.toHaveAttribute('data-overlay-open');
    expect(scrollTo).toHaveBeenCalledWith({
      top: 420,
      left: 0,
      behavior: 'instant',
    });
  });

  it('survives a second open/close cycle without corrupting the saved styles', () => {
    setPriorBodyStyles();
    const previous = priorBodyStyles();
    pinScrollPosition(420);

    const first = renderReveal();
    first.unmount();
    expect(priorBodyStyles()).toEqual(previous);

    // Re-opening must capture the *restored* styles, not the locked ones.
    const second = renderReveal();
    expect(document.body.style.position).toBe('fixed');
    second.unmount();

    expect(priorBodyStyles()).toEqual(previous);
    expect(document.documentElement).not.toHaveAttribute('data-overlay-open');
  });

  it('reference-counts nested reveals so closing one keeps the page locked', () => {
    setPriorBodyStyles();
    const previous = priorBodyStyles();
    pinScrollPosition(420);

    const outer = renderReveal();
    const inner = renderReveal();

    // Closing the inner reveal must not unlock the page under the outer one.
    inner.unmount();
    expect(document.body.style.position).toBe('fixed');
    expect(document.documentElement).toHaveAttribute('data-overlay-open');

    outer.unmount();
    expect(priorBodyStyles()).toEqual(previous);
    expect(document.documentElement).not.toHaveAttribute('data-overlay-open');
  });
});
