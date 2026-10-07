import { describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

/**
 * The Vote screen's real rendering and local ballot behaviour.
 *
 * The screen now renders the proposal's own fields through the Snapshot adapter
 * (`@/lib/vote/adapter`). The mock adapter is used here, so these tests assert
 * the mock's honest content — an empty body, real choices and a zero tally — and
 * prove none of the frozen reference copy is rendered. The real proposal content
 * is proven end to end in `vote-card-real.test.tsx`.
 *
 * Every assertion that pinned the old reference copy is replaced by one that
 * pins the honest rendering of the same field; the local ballot behaviour is
 * preserved.
 *
 * `next/navigation` is mocked as the other tests do, because the resident shell
 * imports it.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen, type VoteScreenProps } from '@/components/vote/VoteScreen';
import { mockSnapshotAdapter } from '@/lib/vote/adapter';
import type { SnapshotVoteResult } from '@/lib/vote/submit';
import { RESIDENT_NAV } from '@/components/shell/nav';

/** The demo wallet the connected state is exercised with. */
const WALLET = '0x1111111111111111111111111111111111111111';

/** A fake cast action that reports a sequencer acceptance. */
function acceptedCast(): {
  castVote: NonNullable<VoteScreenProps['castVote']>;
  calls: Array<{ spaceId: string; proposalId: string; choice: number }>;
} {
  const calls: Array<{ spaceId: string; proposalId: string; choice: number }> = [];
  const castVote: NonNullable<VoteScreenProps['castVote']> = async (input) => {
    calls.push(input);
    return {
      status: 'submitted',
      submitted: true,
      reason: 'The Snapshot sequencer accepted the vote.',
      spaceId: input.spaceId,
      proposalId: input.proposalId,
      voter: WALLET,
      choice: input.choice + 1,
      voteId: '0xaccepted',
      ipfsHash: null,
    } satisfies SnapshotVoteResult;
  };
  return { castVote, calls };
}

/** Render the screen in its loaded, eligible state and wait for it. */
async function renderLoaded(castVote?: VoteScreenProps['castVote']) {
  render(
    <VoteScreen
      wallet={WALLET}
      membership="resident"
      adapter={mockSnapshotAdapter}
      castVote={castVote}
    />,
  );
  // The eligibility block disappears once the power read settles and the viewer
  // is eligible, so its absence is the signal that the screen is loaded.
  await waitFor(() => expect(screen.queryByTestId('vote-eligibility')).toBeNull());
  await screen.findByTestId('vote-choice-2');
}

describe('VoteScreen real proposal rendering', () => {
  it('renders the header and subhead', async () => {
    render(
      <VoteScreen wallet={WALLET} membership="resident" adapter={mockSnapshotAdapter} />,
    );
    expect(screen.getByRole('heading', { name: 'Vote' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Resident consultations are read from Snapshot\. One vote per on-chain credential\./,
      ),
    ).toBeInTheDocument();
    cleanup();
  });

  it('renders the proposal body, its real choices, its type and its real tally', async () => {
    await renderLoaded();
    expect(
      screen.getByRole('heading', { name: 'Programme consultation' }),
    ).toBeInTheDocument();
    expect(screen.getByText('kadeglobal.eth')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    // An empty body is reported as no description, never as invented copy.
    expect(screen.getByTestId('vote-proposal-body')).toHaveTextContent(
      'This proposal has no description.',
    );

    // The real choices, in order.
    expect(screen.getByRole('button', { name: 'For' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Against' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abstain' })).toBeInTheDocument();

    // The real vote type is surfaced.
    expect(screen.getByTestId('vote-type')).toHaveTextContent('basic');

    // Zero votes: no invented distribution and a real turnout of 0.
    expect(screen.getByTestId('vote-tally-note')).toHaveTextContent(
      'No votes have been cast yet.',
    );
    expect(screen.getByTestId('vote-turnout')).toHaveTextContent('Turnout 0 votes');
    cleanup();
  });

  it('renders none of the frozen reference copy', async () => {
    await renderLoaded();
    for (const invented of [
      'Housing supply — co-finance 120 affordable units',
      'SME credit — first-loss capital for local lenders',
      'Split 50 / 50',
    ]) {
      expect(screen.queryByText(invented)).toBeNull();
    }
    expect(screen.queryByText(/Proposed by the Ministry/)).toBeNull();
    expect(screen.queryByText(/Should the Local Innovation Fund/)).toBeNull();
    expect(screen.queryByText(/eligible residents/)).toBeNull();
    expect(screen.queryByText(/strategy/)).toBeNull();
    cleanup();
  });

  it('starts with no choice selected and the cast button disabled', async () => {
    await renderLoaded();
    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent(
      'Select an option',
    );
    expect(
      screen.getByRole('button', { name: 'Cast vote' }),
    ).toBeDisabled();
    cleanup();
  });
});

describe('VoteScreen ballot submission', () => {
  it('enables the cast button when a choice is selected', async () => {
    await renderLoaded();
    const cast = screen.getByRole('button', { name: 'Cast vote' });
    expect(cast).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Against' }));

    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent('Against');
    expect(screen.getByRole('button', { name: 'Cast vote' })).toBeEnabled();
    cleanup();
  });

  it('submits the real cast and leaves the real tally untouched', async () => {
    const { castVote, calls } = acceptedCast();
    await renderLoaded(castVote);
    fireEvent.click(screen.getByRole('button', { name: 'Against' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));

    // The real action is called with the selected proposal and the 0-based
    // choice index; the success state is shown only after it resolves.
    await screen.findByRole('button', { name: 'Vote cast' });
    expect(calls).toEqual([
      { spaceId: 'kadeglobal.eth', proposalId: 'mock-resident-consultation', choice: 1 },
    ]);
    expect(screen.getByRole('button', { name: 'Vote cast' })).toBeDisabled();
    expect(screen.getByTestId('vote-result')).toHaveTextContent('Submitted to Snapshot');
    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent('Against');

    // The real tally is not fabricated: it stays at the source's zero votes.
    expect(screen.getByTestId('vote-tally-note')).toHaveTextContent(
      'No votes have been cast yet.',
    );
    expect(screen.getByTestId('vote-turnout')).toHaveTextContent('Turnout 0 votes');
    cleanup();
  });

  it('locks further selection once the vote is recorded', async () => {
    const { castVote } = acceptedCast();
    await renderLoaded(castVote);
    fireEvent.click(screen.getByRole('button', { name: 'Against' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));
    await screen.findByRole('button', { name: 'Vote cast' });

    // The reference's `if (!s.voted)` guard: picking another choice is a no-op.
    fireEvent.click(screen.getByRole('button', { name: 'For' }));
    expect(screen.getByTestId('vote-ballot-choice')).toHaveTextContent('Against');
    cleanup();
  });

  it('reports a refused cast honestly and does not claim it was recorded', async () => {
    const castVote: NonNullable<VoteScreenProps['castVote']> = async () => ({
      status: 'failed',
      submitted: false,
      reason: 'The Snapshot sequencer rejected the vote (400): invalid signature.',
    });
    await renderLoaded(castVote);
    fireEvent.click(screen.getByRole('button', { name: 'Against' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));

    const result = await screen.findByTestId('vote-result');
    expect(result).toHaveAttribute('data-status', 'failed');
    expect(result).toHaveTextContent('invalid signature');
    expect(result).toHaveTextContent('Your vote was not recorded.');
    // The button is available again, and the ballot is not frozen as cast.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
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
