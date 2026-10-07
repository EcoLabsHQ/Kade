import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The Vote screen's eligibility states.
 *
 * The screen's eligibility logic is real code (`@/lib/vote/eligibility`) run
 * over a Snapshot adapter. These tests drive each state the spec requires —
 * disconnected wallet, loading, read error, closed proposal and the citizen-only
 * refusal — and pin the exact citizen-only text. On a read error, eligibility is
 * NOT assumed.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen } from '@/components/vote/VoteScreen';
import {
  CITIZEN_SPACE_ID,
  RESIDENT_SPACE_ID,
} from '@/lib/vote/spaces';
import type { SnapshotAdapter } from '@/lib/vote/adapter';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';

const WALLET = '0x1111111111111111111111111111111111111111';

const OPEN_RESIDENT: VoteProposal = {
  spaceId: RESIDENT_SPACE_ID,
  proposalId: 'p-resident',
  title: 'Programme consultation',
  category: 'resident',
  state: 'open',
  snapshotBlock: 100,
  type: 'basic',
  choices: [{ id: 'a', label: 'Approve' }],
  provenance: 'mock',
};

const OPEN_CITIZEN: VoteProposal = {
  ...OPEN_RESIDENT,
  spaceId: CITIZEN_SPACE_ID,
  proposalId: 'p-citizen',
  title: 'Citizen assembly consultation',
  category: 'citizen',
};

/** An adapter that returns a fixed proposal and power read. */
function adapterFor(
  proposal: VoteProposal,
  power: VotingPowerRead,
): SnapshotAdapter {
  return {
    mocked: true,
    async getSpace(spaceId) {
      return { id: spaceId, name: spaceId, category: proposal.category, created: false };
    },
    async listProposals() {
      return [proposal];
    },
    async readVotingPower() {
      return power;
    },
  };
}

/** An adapter whose proposal load never resolves (the loading state). */
const neverResolves: SnapshotAdapter = {
  mocked: true,
  async getSpace() {
    return { id: RESIDENT_SPACE_ID, name: 'x', category: 'resident', created: false };
  },
  listProposals() {
    return new Promise(() => {});
  },
  async readVotingPower() {
    return { status: 'unknown', reason: 'not reached' };
  },
};

/** An adapter whose power read rejects (the read-error state). */
const powerReadThrows: SnapshotAdapter = {
  ...adapterFor(OPEN_RESIDENT, { status: 'known', power: 1n, blockNumber: 100, provenance: 'mock' }),
  async readVotingPower() {
    throw new Error('RPC unavailable');
  },
};

describe('VoteScreen eligibility states', () => {
  it('disconnected wallet: refuses and says so, with the vote button disabled', () => {
    render(
      <VoteScreen wallet={null} membership="resident" adapter={adapterFor(OPEN_RESIDENT, {
        status: 'known',
        power: 1n,
        blockNumber: 100,
        provenance: 'mock',
      })} />,
    );

    const eligibility = screen.getByTestId('vote-eligibility');
    expect(eligibility).toHaveAttribute('data-reason', 'wallet-disconnected');
    expect(eligibility).toHaveTextContent(/connect your wallet/i);
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });

  it('loading: shows the checking state and keeps the vote button disabled', () => {
    render(<VoteScreen wallet={WALLET} membership="resident" adapter={neverResolves} />);

    const eligibility = screen.getByTestId('vote-eligibility');
    expect(eligibility).toHaveAttribute('data-reason', 'loading');
    expect(eligibility).toHaveTextContent(/checking your eligibility/i);
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });

  it('read error: eligibility is NOT assumed, and the vote button is disabled', async () => {
    render(<VoteScreen wallet={WALLET} membership="resident" adapter={powerReadThrows} />);

    const eligibility = await screen.findByTestId('vote-eligibility');
    expect(eligibility).toHaveAttribute('data-reason', 'error');
    expect(eligibility).toHaveTextContent(/eligibility is not assumed/i);
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });

  it('closed proposal: refuses and disables the vote button', async () => {
    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor({ ...OPEN_RESIDENT, state: 'closed' }, {
          status: 'known',
          power: 1n,
          blockNumber: 100,
          provenance: 'mock',
        })}
      />,
    );

    const eligibility = await screen.findByTestId('vote-eligibility');
    expect(eligibility).toHaveAttribute('data-reason', 'closed');
    expect(eligibility).toHaveTextContent(/closed/i);
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });

  it('resident on a Citizen proposal: greys it with the exact text and disables voting', async () => {
    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor(OPEN_CITIZEN, {
          status: 'known',
          power: 1n,
          blockNumber: 100,
          provenance: 'mock',
        })}
      />,
    );

    const eligibility = await screen.findByTestId('vote-eligibility');
    expect(eligibility).toHaveAttribute('data-reason', 'citizen-only');
    expect(eligibility).toHaveTextContent('Colosseum Citizens only');
    // The choices are disabled, and the vote button is disabled.
    expect(screen.getByTestId('vote-choice-0')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });

  it('citizen on a Citizen proposal with power is eligible', async () => {
    render(
      <VoteScreen
        wallet={WALLET}
        membership="citizen"
        adapter={adapterFor(OPEN_CITIZEN, {
          status: 'known',
          power: 3n,
          blockNumber: 100,
          provenance: 'mock',
        })}
      />,
    );

    // Eligible: the button is enabled once a choice is picked, and no refusal
    // message is rendered.
    await screen.findByTestId('vote-choice-0');
    expect(screen.queryByTestId('vote-eligibility')).toBeNull();
    expect(screen.getByTestId('vote-choice-0')).toBeEnabled();
    cleanup();
  });

  it('zero power: refuses even for the right category', async () => {
    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor(OPEN_RESIDENT, {
          status: 'known',
          power: 0n,
          blockNumber: 100,
          provenance: 'mock',
        })}
      />,
    );

    const eligibility = await screen.findByTestId('vote-eligibility');
    expect(eligibility).toHaveAttribute('data-reason', 'no-power');
    expect(screen.getByRole('button', { name: 'Record this choice' })).toBeDisabled();
    cleanup();
  });
});
