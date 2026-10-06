import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Vote screen's reference layout and local ballot behaviour.
 *
 * The screen now loads its proposal and voting power through the Snapshot
 * adapter (`@/lib/vote/adapter`), so these tests pass a connected wallet and the
 * mock adapter, then wait for the eligible state before interacting. Every
 * assertion from the previous presentational-mock test is preserved; the change
 * is that eligibility is now real code over a mocked source.
 *
 * `next/navigation` is mocked as the other tests do, because the resident shell
 * imports it.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen } from '@/components/vote/VoteScreen';
import { mockSnapshotAdapter } from '@/lib/vote/adapter';
import { RESIDENT_NAV } from '@/components/shell/nav';

const HOUSING = 'Housing supply — co-finance 120 affordable units';
const SME = 'SME credit — first-loss capital for local lenders';
const SPLIT = 'Split 50 / 50';

/** The demo wallet the connected state is exercised with. */
const WALLET = '0x1111111111111111111111111111111111111111';

/** Render the screen in its loaded, eligible state and wait for it. */
async function renderLoaded() {
  render(
    <VoteScreen wallet={WALLET} membership="resident" adapter={mockSnapshotAdapter} />,
  );
  await screen.findByText('53%');
}

describe('VoteScreen reference layout', () => {
  it('renders the header and subhead', async () => {
    render(
      <VoteScreen wallet={WALLET} membership="resident" adapter={mockSnapshotAdapter} />,
    );
    expect(screen.getByRole('heading', { name: 'Vote' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Resident consultations run on Snapshot\. One KYC-attested resident, one vote, no gas\./,
      ),
    ).toBeInTheDocument();
    cleanup();
  });

  it('renders the consultation and its three seeded choices with percentages', async () => {
    await renderLoaded();
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
    expect(turnout).toHaveTextContent('106 votes of 148 eligible residents');
    cleanup();
  });

  it('starts with no choice selected and the cast button disabled', async () => {
    await renderLoaded();
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
  it('enables the cast button when a choice is selected', async () => {
    await renderLoaded();
    const cast = screen.getByRole('button', { name: 'Sign & cast vote' });
    expect(cast).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(SME) }));

    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent(SME);
    expect(screen.getByRole('button', { name: 'Sign & cast vote' })).toBeEnabled();
    cleanup();
  });

  it('casting updates the ballot label, the turnout and the tallies', async () => {
    await renderLoaded();
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

  it('locks further selection once the vote is recorded', async () => {
    await renderLoaded();
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
