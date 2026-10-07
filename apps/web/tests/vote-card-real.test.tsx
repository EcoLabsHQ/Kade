import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

/**
 * The Vote card's real proposal content, end to end.
 *
 * These tests build the **real** Snapshot adapter over an injected hub `fetch`
 * and an injected chain reader, so the whole pipeline runs — hub payload →
 * adapter → screen — without ever dialing the network. They prove that the real
 * `body`, `choices`, `scores`, `scores_total`, `votes` and `type` are rendered,
 * that an empty body does not render invented text, that zero votes do not
 * render an invented distribution, and that a real, unsupported vote type is
 * surfaced and refused honestly.
 *
 * `next/navigation` is mocked because the resident shell imports it.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen } from '@/components/vote/VoteScreen';
import {
  createRealSnapshotAdapter,
  type SnapshotAdapter,
  type VoteChainReader,
} from '@/lib/vote/adapter';
import { createSnapshotHubClient } from '@/lib/vote/hub';
import { RESIDENT_CREDENTIAL, RESIDENT_SPACE_ID } from '@/lib/vote/spaces';

const WALLET = '0x1111111111111111111111111111111111111111';

/** A hub payload with one resident proposal, as the real hub shapes it. */
function hubFetch(proposal: Record<string, unknown>): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { proposals: [proposal] } }),
  })) as unknown as typeof fetch;
}

/** A chain reader that grants one unit of the Resident credential. */
const chain: VoteChainReader = {
  async readBalanceOf({ collection }) {
    return collection === RESIDENT_CREDENTIAL.address ? 1n : 0n;
  },
};

function adapterFor(proposal: Record<string, unknown>): SnapshotAdapter {
  return createRealSnapshotAdapter({
    hub: createSnapshotHubClient({ fetch: hubFetch(proposal) }),
    chain,
  });
}

/** The fields every proposal carries, with the content overridable per test. */
const BASE_PROPOSAL = {
  id: '0xresident',
  title: 'Resident: Add February 2nd to official holiday',
  state: 'active',
  start: 1791382034,
  end: 1791814034,
  snapshot: 512586595,
  space: { id: RESIDENT_SPACE_ID, name: 'Curaçao Residents' },
};

async function renderProposal(proposal: Record<string, unknown>) {
  render(
    <VoteScreen
      wallet={WALLET}
      membership="resident"
      adapter={adapterFor(proposal)}
      spaceIds={[RESIDENT_SPACE_ID]}
    />,
  );
  await screen.findByTestId('vote-proposal-body');
  // Wait for the power read to settle so eligibility is not mid-flight.
  await waitFor(() => expect(screen.queryByTestId('vote-eligibility')).toBeNull());
}

describe('Vote card — real proposal content', () => {
  it('renders the real body, choices, percentages and vote count', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: 'Add February 2nd to official holiday',
      type: 'basic',
      choices: ['For', 'Against', 'Abstain'],
      scores: [10, 5, 5],
      scores_total: 20,
      votes: 3,
      quorum: 0,
    });

    expect(screen.getByTestId('vote-proposal-body')).toHaveTextContent(
      'Add February 2nd to official holiday',
    );
    expect(screen.getByRole('button', { name: /^For/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Against/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Abstain/ })).toBeInTheDocument();

    // Percentages are computed from the real scores / scores_total.
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getAllByText('25%')).toHaveLength(2);

    // The turnout is the real vote count, not an eligible-resident denominator.
    expect(screen.getByTestId('vote-turnout')).toHaveTextContent('Turnout 3 votes');
    expect(screen.getByTestId('vote-tally-note')).toHaveTextContent(
      'Totals read from Snapshot.',
    );
    cleanup();
  });

  it('surfaces the real vote type', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: 'Add February 2nd to official holiday',
      type: 'basic',
      choices: ['For', 'Against', 'Abstain'],
      scores: [0, 0, 0],
      scores_total: 0,
      votes: 0,
      quorum: 0,
    });

    expect(screen.getByTestId('vote-type')).toHaveTextContent('basic');
    expect(screen.queryByTestId('vote-type-unsupported')).toBeNull();
    cleanup();
  });

  it('reports an empty body as no description instead of inventing text', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: '',
      type: 'basic',
      choices: ['For', 'Against', 'Abstain'],
      scores: [0, 0, 0],
      scores_total: 0,
      votes: 0,
      quorum: 0,
    });

    expect(screen.getByTestId('vote-proposal-body')).toHaveTextContent(
      'This proposal has no description.',
    );
    // None of the frozen reference copy leaks in.
    expect(screen.queryByText(/Proposed by the Ministry/)).toBeNull();
    expect(screen.queryByText(/Should the Local Innovation Fund/)).toBeNull();
    expect(screen.queryByText(/Housing supply/)).toBeNull();
    cleanup();
  });

  it('does not invent a distribution when there are no votes', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: 'Add February 2nd to official holiday',
      type: 'basic',
      choices: ['For', 'Against', 'Abstain'],
      scores: [0, 0, 0],
      scores_total: 0,
      votes: 0,
      quorum: 0,
    });

    expect(screen.getByTestId('vote-tally-note')).toHaveTextContent(
      'No votes have been cast yet.',
    );
    // No percentage is rendered for a zero total.
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByTestId('vote-turnout')).toHaveTextContent('Turnout 0 votes');
    cleanup();
  });

  it('surfaces and refuses a real, unsupported vote type', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: 'Distribute the treasury across weighted options',
      type: 'weighted',
      choices: ['Option A', 'Option B'],
      scores: [0, 0],
      scores_total: 0,
      votes: 0,
      quorum: 0,
    });

    expect(screen.getByTestId('vote-type')).toHaveTextContent('weighted');
    expect(screen.getByTestId('vote-type-unsupported')).toHaveTextContent(
      'does not support yet',
    );
    // The ballot is refused rather than pretending to be a single choice.
    expect(screen.getByTestId('vote-choice-0')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });

  it('degrades honestly when the hub omits the tally fields', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: 'A proposal with no reported tally',
      type: 'basic',
      choices: ['For', 'Against'],
    });

    expect(screen.getByTestId('vote-tally-note')).toHaveTextContent(
      'The tally could not be read from Snapshot.',
    );
    expect(screen.getByTestId('vote-turnout')).toHaveTextContent(
      'Turnout could not be read from Snapshot.',
    );
    cleanup();
  });

  it('shows the real voting power read on the ballot', async () => {
    await renderProposal({
      ...BASE_PROPOSAL,
      body: 'Add February 2nd to official holiday',
      type: 'basic',
      choices: ['For', 'Against'],
      scores: [1, 0],
      scores_total: 1,
      votes: 1,
      quorum: 0,
    });

    const power = screen.getByTestId('vote-power');
    expect(within(power).getByText('1')).toBeInTheDocument();
    // The invented strategy string is gone.
    expect(screen.queryByText(/erc721/)).toBeNull();
    cleanup();
  });
});
