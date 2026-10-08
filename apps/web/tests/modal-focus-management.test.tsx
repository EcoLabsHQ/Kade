import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { Modal } from '@/components/ui/Modal';

/**
 * The shared `Modal`'s focus contract.
 *
 * The dialog was reached by every caller in the app and its focus behaviour was
 * reviewed as a real gap (`demo-feedback-25` finding F3): Tab escaped behind the
 * dialog, and closing it dropped focus on `<body>`. These tests pin the two
 * invariants that fix must hold for every dialog:
 *
 *   1. **Containment.** Forward from the last focusable control wraps to the
 *      first, backward from the first wraps to the last, for a dialog with one
 *      control and a dialog with many; and it must not trap when closed.
 *   2. **Restoration.** On every close path — Escape, the backdrop, the close
 *      button and a caller's own action — focus returns to the element that
 *      opened the dialog, with a documented fallback when that element is gone.
 *
 * A third test pins the deliberate initial target (the dialog card, never a
 * destructive action) and a fourth proves the trap survives a dialog whose
 * content changes while it is open (a button swapped for a spinner).
 *
 * jsdom has no layout and does not move focus on its own, so each test places
 * focus explicitly and fires the same `keydown` the browser would; that is what
 * the trap in `Modal` reads.
 */

/** The focusable control that is first in the `main` landmark, used by the
 * fallback test. */
const MAIN_CONTROL = 'main-control';

/**
 * A minimal caller: a `main` landmark with one control, an opener button, and a
 * `Modal` whose body is rendered by the test.
 */
function Harness({
  renderBody,
  showOpener = true,
  onClose,
}: {
  readonly renderBody?: (close: () => void) => ReactNode;
  readonly showOpener?: boolean;
  readonly onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  function close() {
    setOpen(false);
    onClose?.();
  }
  return (
    <main>
      <button type="button" data-testid={MAIN_CONTROL}>
        Main control
      </button>
      {showOpener ? (
        <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
          Open dialog
        </button>
      ) : null}
      <Modal open={open} onClose={close} title="Test dialog">
        {renderBody ? renderBody(close) : null}
      </Modal>
    </main>
  );
}

/** Focus the opener (as a real click would) and open the dialog. */
function openFromOpener(): HTMLElement {
  const opener = screen.getByTestId('opener');
  opener.focus();
  fireEvent.click(opener);
  return screen.getByRole('dialog');
}

function pressTab(shiftKey = false): void {
  fireEvent.keyDown(document, { key: 'Tab', shiftKey });
}

function closeButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: 'Close' });
}

afterEach(() => {
  cleanup();
});

describe('Modal focus containment', () => {
  it('wraps Tab from the last focusable control to the first', () => {
    render(
      <Harness
        renderBody={() => (
          <>
            <button type="button" data-testid="first">
              First
            </button>
            <button type="button" data-testid="last">
              Last
            </button>
          </>
        )}
      />,
    );
    const dialog = openFromOpener();
    const close = closeButton(dialog);

    screen.getByTestId('last').focus();
    pressTab();

    expect(close).toHaveFocus();
  });

  it('wraps Shift+Tab from the first focusable control to the last', () => {
    render(
      <Harness
        renderBody={() => (
          <>
            <button type="button" data-testid="first">
              First
            </button>
            <button type="button" data-testid="last">
              Last
            </button>
          </>
        )}
      />,
    );
    const dialog = openFromOpener();
    const close = closeButton(dialog);

    close.focus();
    pressTab(true);

    expect(screen.getByTestId('last')).toHaveFocus();
  });

  it('enters the dialog from the card, forward and backward', () => {
    render(
      <Harness
        renderBody={() => (
          <button type="button" data-testid="last">
            Last
          </button>
        )}
      />,
    );
    const dialog = openFromOpener();
    const close = closeButton(dialog);

    // The card is the initial target; Tab enters at the first control.
    expect(dialog).toHaveFocus();
    pressTab();
    expect(close).toHaveFocus();

    // Return to the card, then Shift+Tab enters at the last control.
    dialog.focus();
    pressTab(true);
    expect(screen.getByTestId('last')).toHaveFocus();
  });

  it('holds focus when the dialog has a single focusable control', () => {
    render(<Harness renderBody={() => <p>Nothing to operate here.</p>} />);
    const dialog = openFromOpener();
    const close = closeButton(dialog);

    // `close` is the only focusable control: both directions stay on it.
    close.focus();
    pressTab();
    expect(close).toHaveFocus();

    pressTab(true);
    expect(close).toHaveFocus();
  });

  it('does not trap Tab once the dialog is closed', () => {
    render(<Harness renderBody={() => <button type="button">Inner</button>} />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    // With no dialog open, the same key event must not be intercepted.
    const background = screen.getByTestId(MAIN_CONTROL);
    background.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(background).toHaveFocus();
  });
});

describe('Modal focus restoration', () => {
  it('returns focus to the opener on Escape', () => {
    render(<Harness renderBody={() => <button type="button">Inner</button>} />);
    const opener = screen.getByTestId('opener');
    openFromOpener();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('returns focus to the opener on a backdrop click', () => {
    render(<Harness renderBody={() => <button type="button">Inner</button>} />);
    const opener = screen.getByTestId('opener');
    const dialog = openFromOpener();

    fireEvent.click(dialog.parentElement as HTMLElement);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('returns focus to the opener on the close button', () => {
    render(<Harness renderBody={() => <button type="button">Inner</button>} />);
    const opener = screen.getByTestId('opener');
    const dialog = openFromOpener();

    fireEvent.click(closeButton(dialog));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("returns focus to the opener on a caller's own action", () => {
    render(
      <Harness
        renderBody={(close) => (
          <button type="button" data-testid="confirm" onClick={close}>
            Confirm
          </button>
        )}
      />,
    );
    const opener = screen.getByTestId('opener');
    openFromOpener();

    fireEvent.click(screen.getByTestId('confirm'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('falls back to the main landmark when the opener is gone', () => {
    function RemoveOpenerHarness() {
      const [open, setOpen] = useState(false);
      const [openerMounted, setOpenerMounted] = useState(true);
      return (
        <main>
          <button type="button" data-testid={MAIN_CONTROL}>
            Main control
          </button>
          {openerMounted ? (
            <button
              type="button"
              data-testid="opener"
              onClick={() => setOpen(true)}
            >
              Open dialog
            </button>
          ) : null}
          <Modal open={open} onClose={() => setOpen(false)} title="Fallback dialog">
            <button
              type="button"
              data-testid="remove-opener"
              onClick={() => setOpenerMounted(false)}
            >
              Remove opener
            </button>
          </Modal>
        </main>
      );
    }

    render(<RemoveOpenerHarness />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    // The view changes under the dialog: the trigger is unmounted while open.
    fireEvent.click(screen.getByTestId('remove-opener'));
    expect(screen.queryByTestId('opener')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    // Not `<body>`: the documented fallback is the main landmark's first
    // focusable control.
    expect(screen.getByTestId(MAIN_CONTROL)).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('falls back to the main landmark when there was no focused opener', () => {
    render(<Harness renderBody={() => <button type="button">Inner</button>} />);

    // Opened without focusing a trigger first (a programmatic open, or a
    // trigger that closes in the same commit — the `PositionMenu` shape):
    // `document.activeElement` is `<body>`, which is not a real opener.
    fireEvent.click(screen.getByTestId('opener'));
    expect(screen.getByRole('dialog')).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId(MAIN_CONTROL)).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});

describe('Modal initial focus and dynamic content', () => {
  it('focuses the dialog card, never a destructive action', () => {
    render(
      <Harness
        renderBody={(close) => (
          <button type="button" data-testid="destructive" onClick={close}>
            Delete everything
          </button>
        )}
      />,
    );
    const dialog = openFromOpener();

    expect(within(dialog).getByTestId('destructive')).not.toHaveFocus();
    expect(dialog).toHaveFocus();
    // The dialog still carries its name and modality.
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
  });

  it('keeps containment when a control is swapped for a spinner while open', () => {
    function DynamicHarness() {
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      return (
        <main>
          <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Dynamic dialog">
            <button
              type="button"
              data-testid="work"
              onClick={() => setBusy(true)}
            >
              Start work
            </button>
            {busy ? (
              <span role="status" data-testid="spinner">
                Working…
              </span>
            ) : (
              <button type="button" data-testid="confirm">
                Confirm
              </button>
            )}
          </Modal>
        </main>
      );
    }

    render(<DynamicHarness />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    // The focused control is removed; focus falls out of the dialog.
    screen.getByTestId('confirm').focus();
    fireEvent.click(screen.getByTestId('work'));
    expect(screen.queryByTestId('confirm')).toBeNull();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();

    // Tab re-enters the dialog instead of escaping, and does not throw.
    const dialog = screen.getByRole('dialog');
    expect(() => pressTab()).not.toThrow();
    expect(closeButton(dialog)).toHaveFocus();

    // Containment still holds with the new set of controls.
    const work = screen.getByTestId('work');
    work.focus();
    pressTab();
    expect(closeButton(dialog)).toHaveFocus();

    pressTab(true);
    expect(work).toHaveFocus();
  });
});
