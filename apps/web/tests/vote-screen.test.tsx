import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Vote screen — a presentational divergence declared in
 * `docs/week-3-frozen-delivery-contract.md` (VOTE-1).
 *
 * These tests pin the reference layout and the local-only ballot behaviour: the
 * header, the proposal and its three seeded choices with their percentages,
 * selection enabling the cast button, and casting updating the ballot label,
 * the turnout and the recomputed tallies while locking further selection.
 *
 * `next/navigation` is mocked as the other tests do, because the resident shell
 * imports it.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen } from '@/components/vote/VoteScreen';
import { RESIDENT_NAV } from '@/components/shell/nav';

const HOUSING = 'Housing supply — co-finance 120 affordable units';
const SME = 'SME credit — first-loss capital for local lenders';
const SPLIT = 'Split 50 / 50';

describe('VoteScreen reference layout', () => {
  it('renders the header and subhead', () => {
    render(<VoteScreen />);
    expect(screen.getByRole('heading', { name: 'Vote' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Resident consultations run on Snapshot\. One KYC-attested resident, one vote, no gas\./,
      ),
    ).toBeInTheDocument();
    cleanup();
  });

  it('renders the consultation and its three seeded choices with percentages', () => {
    render(<VoteScreen />);
    expect(
      screen.getByRole('heading', { name: 'Programme consultation' }),
    ).toBeInTheDocument();
    expect(screen.getByText('onchainisland.eth')).toBeInTheDocument();
    expect(screen.getByText('Open · closes 30 Sep')).toBeInTheDocument();
    expect(
      screen.getByText(/Should the Local Innovation Fund allocation for 2027/),
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: new RegExp(HOUSING) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(SME) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(SPLIT) })).toBeInTheDocument();

    // The reference's seeded tallies: 56 / 38 / 12 of 106.
    expect(screen.getByText('53%')).toBeInTheDocument();
    expect(screen.getByText('36%')).toBeInTheDocument();
    expect(screen.getByText('11%')).toBeInTheDocument();

    // The demo turnout, not a real vote count.
    const turnout = screen.getByTestId('vote-turnout');
    expect(within(turnout).getByText('106')).toBeInTheDocument();
    expect(turnout).toHaveTextContent('of 148 eligible residents');
    cleanup();
  });

  it('starts with no choice selected and the cast button disabled', () => {
    render(<VoteScreen />);
    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent(
      'Select an option',
    );
    expect(
      screen.getByRole('button', { name: 'Sign & cast vote' }),
    ).toBeDisabled();
    cleanup();
  });
});

describe('VoteScreen local ballot behaviour', () => {
  it('enables the cast button when a choice is selected', () => {
    render(<VoteScreen />);
    const cast = screen.getByRole('button', { name: 'Sign & cast vote' });
    expect(cast).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(SME) }));

    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent(SME);
    expect(screen.getByRole('button', { name: 'Sign & cast vote' })).toBeEnabled();
    cleanup();
  });

  it('casting updates the ballot label, the turnout and the tallies', () => {
    render(<VoteScreen />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SME) }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign & cast vote' }));

    // The ballot freezes on the chosen label and the button records locally.
    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent(SME);
    expect(
      screen.getByRole('button', { name: 'Vote recorded on Snapshot ✓' }),
    ).toBeDisabled();

    // Turnout 106 → 107; the tallies recompute against the new total, so the
    // housing share rounds down from 53% to 52%.
    const turnout = screen.getByTestId('vote-turnout');
    expect(within(turnout).getByText('107')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.queryByText('53%')).toBeNull();
    expect(screen.getByText('36%')).toBeInTheDocument();
    expect(screen.getByText('11%')).toBeInTheDocument();
    cleanup();
  });

  it('locks further selection once the vote is recorded', () => {
    render(<VoteScreen />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SME) }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign & cast vote' }));

    // The reference's `if (!s.voted)` guard: picking another choice is a no-op.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(HOUSING) }));
    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent(SME);
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.queryByText('53%')).toBeNull();
    cleanup();
  });
});

describe('Vote navigation', () => {
  it('renders the Vote item as a plain link, not a locked control', () => {
    const vote = RESIDENT_NAV.flatMap((group) => group.items).find(
      (item) => item.href === '/vote',
    );
    expect(vote).toBeDefined();
    expect(vote?.locked).toBeUndefined();
    expect(vote?.lockReason).toBeUndefined();
  });
});
