import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import type {
  OnboardingSnapshot,
  OnboardingStore,
} from '@/lib/onboarding/persistence';

const hoisted = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  enrolPasskey: vi.fn(),
  deriveSignerAddress: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.push, refresh: hoisted.refresh }),
}));
vi.mock('@/lib/passkey/enrolment', () => ({
  enrolPasskey: hoisted.enrolPasskey,
}));
// Only the chain call is mocked. The public-key parser and the Safe derivation
// under test are the real implementations.
vi.mock('@/app/onboarding/signer-actions', () => ({
  deriveSignerAddress: hoisted.deriveSignerAddress,
}));

/**
 * A real P-256 credential public key (SubjectPublicKeyInfo, base64url), so the
 * parser is exercised rather than stubbed.
 */
const CREDENTIAL_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhKtMrf9_4pL52N0vu32ITXObg_aKHBEmUhtHBc8emoPeHcxCgv3XReybe6LiIVB-gpgt05_d49LeIZCWRbXVWA';
/** What the signer factory returns for that key. */
const SIGNER_ADDRESS = '0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9';
/** The Safe that signer owns for `user-1`, under the frozen deployment inputs. */
const ACCOUNT_ADDRESS = '0x72c779286Aa40095C30364fd902A84fC036Ba83f';

afterEach(() => {
  cleanup();
  hoisted.push.mockReset();
  hoisted.refresh.mockReset();
  hoisted.enrolPasskey.mockReset();
  hoisted.deriveSignerAddress.mockReset();
});

function makeStore() {
  const save = vi.fn(async (userId: string, snapshot: OnboardingSnapshot) => ({
    applicationId: `app-${userId}`,
    preapprovalUsdc: preapprovalFeeUsdc('demo', 1 + snapshot.members.length),
  }));
  const store: OnboardingStore = { mode: 'supabase', load: async () => null, save };
  return { store, save };
}

function renderFlow(store: OnboardingStore) {
  return render(
    <OnboardingFlow
      userId="user-1"
      mode="demo"
      persistence="supabase"
      initial={null}
      network="Ethereum Sepolia"
      accountState={{ kind: 'pending' }}
      currentYear={2026}
      // A resident who already has a passkey starts at step 2.
      initialCredentialId="cred-existing"
      store={store}
    />,
  );
}

function renderFlowFromStart(store: OnboardingStore) {
  return render(
    <OnboardingFlow
      userId="user-1"
      mode="demo"
      persistence="supabase"
      initial={null}
      network="Ethereum Sepolia"
      accountState={{ kind: 'pending' }}
      currentYear={2026}
      store={store}
    />,
  );
}

describe('step 1, the transaction passkey', () => {
  function enrolResponse() {
    return {
      credentialId: 'cred-new',
      publicKey: CREDENTIAL_PUBLIC_KEY,
      signerAddress: '0x0000000000000000000000000000000000000000',
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-09-18T00:00:00Z',
      lastUsedAt: null,
      signerAddressStatus: 'unresolved',
    };
  }

  it('gates Continue until the passkey exists, then derives the account', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveSignerAddress.mockResolvedValue(SIGNER_ADDRESS);
    const { store } = makeStore();
    renderFlowFromStart(store);

    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();
    expect(await screen.findByText(ACCOUNT_ADDRESS)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
  });

  it('asks the factory for the signer, using the passkey coordinates', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveSignerAddress.mockResolvedValue(SIGNER_ADDRESS);
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(ACCOUNT_ADDRESS);

    // The (x, y) actually parsed out of the credential's public key.
    expect(hoisted.deriveSignerAddress).toHaveBeenCalledWith(
      '60007956084768639721304183014925048035643211105580041179157164810671935625859',
      '100466100699769958682154873776127380612531326340629437721014042449018296325464',
    );
  });

  it('survives the chain being unreachable, since the passkey still exists', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveSignerAddress.mockRejectedValue(new Error('rpc down'));
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
  });

  it('shows no address, and no internal gate language, before enrolment', () => {
    const { store } = makeStore();
    renderFlowFromStart(store);

    // Nothing address-shaped exists yet, and nothing is invented to fill the gap.
    expect(screen.queryByText(/0x[0-9a-fA-F]{6}/)).toBeNull();
    // Creating a passkey is the ordinary path, so the step carries no internal
    // gate vocabulary and no caveat about what it withholds.
    expect(
      screen.queryByText(/account gate|pending approval|not shown yet|project-supplied/i),
    ).toBeNull();
  });
});

describe('pre-registration flow', () => {
  it('walks from the saved profile through proof of wealth to the fee', async () => {
    const { store, save } = makeStore();
    renderFlow(store);

    // Step 2, populated with the demo defaults.
    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // Step 3, gated until a wallet is connected.
    expect(
      await screen.findByRole('heading', { name: /show proof of wealth/i }),
    ).toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: /^continue$/i });
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: /^connect$/i })[0]!);
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    // Step 4, with the file and the server-controlled fee.
    expect(
      await screen.findByRole('heading', {
        name: /pay the pre-approval fee and go live/i,
      }),
    ).toBeInTheDocument();
    // Household of three, the contract's worked example.
    expect(screen.getByText('1.75 USDC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));
    expect(
      screen.getByRole('button', { name: /enter the platform/i }),
    ).toBeInTheDocument();
  });

  it('labels the mocked steps so they are not mistaken for real operations', async () => {
    const { store } = makeStore();
    renderFlow(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    fireEvent.click(screen.getAllByRole('button', { name: /^connect$/i })[0]!);
    // The step says outright that the balances are demo data.
    expect(screen.getByText(/balances shown are demo data/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });
    expect(screen.getByText(/does not send a transaction/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.75 USDC/)).toBeInTheDocument();
  });
});
