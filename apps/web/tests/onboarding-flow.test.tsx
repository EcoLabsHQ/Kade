import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import type {
  OnboardingSnapshot,
  OnboardingStore,
} from '@/lib/onboarding/persistence';

const hoisted = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  enrolPasskey: vi.fn(),
  deriveAccount: vi.fn(),
  previewPreapprovalFee: vi.fn(),
  savePasskeyCredential: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.push, refresh: hoisted.refresh }),
}));
vi.mock('@/lib/passkey/enrolment', () => ({
  enrolPasskey: hoisted.enrolPasskey,
}));
// Persistence is a server action. It is mocked so enrolment is exercised
// against a recorded server outcome rather than a real database.
vi.mock('@/app/account/passkey-actions', () => ({
  savePasskeyCredential: hoisted.savePasskeyCredential,
}));
// Only the chain round trip is mocked. The public-key parser is the real
// implementation, so the coordinates handed to the action are real.
vi.mock('@/app/onboarding/signer-actions', () => ({
  deriveAccount: hoisted.deriveAccount,
}));
// The fee preview is a server action. It is mocked here so the test exercises
// the client against a server answer, not the database client.
vi.mock('@/app/onboarding/actions', () => ({
  previewPreapprovalFee: hoisted.previewPreapprovalFee,
  saveOnboardingStep2: vi.fn(),
}));

/** The seeded demo row: base 1, 0.25 per member, two decimal places. */
const DEMO_SCHEDULE = {
  mode: 'demo',
  baseUsdc: 1,
  perMemberUsdc: 0.25,
  roundingScale: 2,
} as const;

function demoFee(householdSize: number) {
  return preapprovalBreakdownFromSchedule(DEMO_SCHEDULE, householdSize);
}

beforeEach(() => {
  hoisted.previewPreapprovalFee.mockImplementation(
    async (householdSize: number) => demoFee(householdSize),
  );
  hoisted.savePasskeyCredential.mockImplementation(
    async (input: {
      credentialId: string;
      publicKey: string;
      transports: readonly string[];
      userVerification: boolean;
    }) => ({
      credential: {
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        signerAddress: SIGNER_ADDRESS,
        transports: input.transports,
        userVerification: input.userVerification,
        createdAt: '2026-09-18T00:00:00Z',
        lastUsedAt: null,
      },
      signer: { status: 'persisted', address: SIGNER_ADDRESS },
    }),
  );
});

/**
 * A real P-256 credential public key (SubjectPublicKeyInfo, base64url), so the
 * parser is exercised rather than stubbed.
 */
const CREDENTIAL_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhKtMrf9_4pL52N0vu32ITXObg_aKHBEmUhtHBc8emoPeHcxCgv3XReybe6LiIVB-gpgt05_d49LeIZCWRbXVWA';
/** What the signer factory returns for that key. */
const SIGNER_ADDRESS = '0xE39f50B9f260e835246AC2A40a1EFd87dF5f21B6';
/** The Safe that signer owns for `user-1`, under the frozen deployment inputs. */
const ACCOUNT_ADDRESS = '0xEcB18f6529713349d1864715A40B0124e798e523';

afterEach(() => {
  cleanup();
  hoisted.push.mockReset();
  hoisted.refresh.mockReset();
  hoisted.enrolPasskey.mockReset();
  hoisted.deriveAccount.mockReset();
  hoisted.previewPreapprovalFee.mockReset();
  hoisted.savePasskeyCredential.mockReset();
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
      initialFee={demoFee(1)}
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
      initialFee={demoFee(1)}
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
    hoisted.deriveAccount.mockResolvedValue({
      signerAddress: SIGNER_ADDRESS,
      safeAddress: ACCOUNT_ADDRESS,
    });
    const { store } = makeStore();
    renderFlowFromStart(store);

    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();
    expect(await screen.findByText(ACCOUNT_ADDRESS)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
  });

  it('asks the chain for the account, using the passkey coordinates', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAccount.mockResolvedValue({
      signerAddress: SIGNER_ADDRESS,
      safeAddress: ACCOUNT_ADDRESS,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(ACCOUNT_ADDRESS);

    // The (x, y) actually parsed out of the credential's public key, plus the
    // resident the salt nonce is derived from.
    expect(hoisted.deriveAccount).toHaveBeenCalledWith(
      '60007956084768639721304183014925048035643211105580041179157164810671935625859',
      '100466100699769958682154873776127380612531326340629437721014042449018296325464',
      'user-1',
    );
  });

  it('survives the chain being unreachable, since the passkey still exists', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAccount.mockRejectedValue(new Error('rpc down'));
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

  it('persists the created credential through the action, with its own fields', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAccount.mockResolvedValue({
      signerAddress: SIGNER_ADDRESS,
      safeAddress: ACCOUNT_ADDRESS,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(/passkey created/i);

    // The browser names no signer: it sends only what the credential carries.
    expect(hoisted.savePasskeyCredential).toHaveBeenCalledTimes(1);
    expect(hoisted.savePasskeyCredential).toHaveBeenCalledWith({
      credentialId: 'cred-new',
      publicKey: CREDENTIAL_PUBLIC_KEY,
      transports: ['internal'],
      userVerification: true,
    });
  });

  it('derives the account address from the credential that was persisted', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAccount.mockResolvedValue({
      signerAddress: SIGNER_ADDRESS,
      safeAddress: ACCOUNT_ADDRESS,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(ACCOUNT_ADDRESS);

    // One credential, one derived signal: the address is derived only after the
    // credential is persisted, from the persisted credential's public key.
    const saveOrder =
      hoisted.savePasskeyCredential.mock.invocationCallOrder[0];
    const deriveOrder = hoisted.deriveAccount.mock.invocationCallOrder[0];
    expect(saveOrder as number).toBeLessThan(deriveOrder as number);
  });

  it('does not persist a credential that failed user verification', async () => {
    hoisted.enrolPasskey.mockResolvedValue({
      ...enrolResponse(),
      userVerification: false,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(hoisted.savePasskeyCredential).not.toHaveBeenCalled();
    // A rejected ceremony is not a created passkey either.
    expect(screen.queryByText(/passkey created/i)).toBeNull();
  });

  it('does not persist when the authenticator ceremony itself fails', async () => {
    hoisted.enrolPasskey.mockRejectedValue(new Error('the user cancelled'));
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled/i);
    expect(hoisted.savePasskeyCredential).not.toHaveBeenCalled();
  });

  it('recognises a resident with a stored credential instead of enrolling again', () => {
    // `renderFlow` supplies `initialCredentialId`, as the page does when the
    // resident already has a persisted credential.
    renderFlow(makeStore().store);

    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create passkey/i }),
    ).toBeNull();
    expect(hoisted.enrolPasskey).not.toHaveBeenCalled();
    expect(hoisted.savePasskeyCredential).not.toHaveBeenCalled();
  });

  it('never claims the credential is stored when the action did not persist it', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAccount.mockResolvedValue({
      signerAddress: SIGNER_ADDRESS,
      safeAddress: ACCOUNT_ADDRESS,
    });
    hoisted.savePasskeyCredential.mockResolvedValue({
      credential: {
        ...enrolResponse(),
        signerAddress: null,
      },
      signer: {
        status: 'not-persisted',
        reason: 'SUPABASE_SERVICE_ROLE_KEY is not configured in this environment.',
      },
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(/passkey created/i);

    // Ordinary-path tone: no claim that the account is stored, and no raw
    // configuration jargon leaked to the resident.
    expect(screen.queryByText(/your account is ready/i)).toBeNull();
    expect(
      screen.getByText(/link it to your account shortly/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/SUPABASE_SERVICE_ROLE_KEY/i)).toBeNull();

    // The flow does not break: the passkey is real, so the resident continues.
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
  });

  it('does not block the resident when persistence itself fails', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAccount.mockResolvedValue({
      signerAddress: SIGNER_ADDRESS,
      safeAddress: ACCOUNT_ADDRESS,
    });
    hoisted.savePasskeyCredential.mockRejectedValue(new Error('database down'));
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();
    expect(screen.queryByText(/your account is ready/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
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
    expect(await screen.findByText('1.75 USDC')).toBeInTheDocument();

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
    expect(await screen.findByText(/1\.75 USDC/)).toBeInTheDocument();
  });

  it('shows the fee the server resolved, not the shared formula or the store value', async () => {
    // The schedule itself changed (per member 0.5, not 0.25): the server's
    // answer is 2.50 for a household of three. The store claims 999, which the
    // screen must ignore because the store is not the fee's source.
    hoisted.previewPreapprovalFee.mockImplementation(
      async (householdSize: number) =>
        preapprovalBreakdownFromSchedule(
          { mode: 'demo', baseUsdc: 1, perMemberUsdc: 0.5, roundingScale: 2 },
          householdSize,
        ),
    );
    const store: OnboardingStore = {
      mode: 'supabase',
      load: async () => null,
      save: async () => ({ applicationId: 'app-user-1', preapprovalUsdc: 999 }),
    };
    renderFlow(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
    fireEvent.click(screen.getAllByRole('button', { name: /^connect$/i })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });

    expect(await screen.findByText('2.50 USDC')).toBeInTheDocument();
    expect(screen.queryByText('1.75 USDC')).toBeNull();
    expect(screen.queryByText('999 USDC')).toBeNull();
  });

  it('asks the server to resolve the fee for the current household size', async () => {
    const { store } = makeStore();
    renderFlow(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    // Applicant only at first; then the saved household of three.
    expect(hoisted.previewPreapprovalFee).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(hoisted.previewPreapprovalFee).toHaveBeenCalledWith(3),
    );
  });

  it('shows no amount and blocks payment when the fee cannot be resolved', async () => {
    hoisted.previewPreapprovalFee.mockResolvedValue(null);
    const { store } = makeStore();
    renderFlow(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
    fireEvent.click(screen.getAllByRole('button', { name: /^connect$/i })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });

    expect(
      await screen.findByText(/configured pre-approval fee could not be read/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/USDC/)).toBeNull();
    expect(screen.getByRole('button', { name: /pay now/i })).toBeDisabled();
  });
});

/**
 * The distinction the owner asked for: what the flow shows is the resident's,
 * and what it shows is demo state is labelled as such. The vocabulary check
 * covers every rendered surface, sidebar and footer included.
 */
const INTERNAL_VOCABULARY: readonly RegExp[] = [
  /fee_schedule/i,
  /preapproval_usdc/i,
  /save_onboarding_step2/i,
  /SUPABASE/i,
  /SERVICE_ROLE/i,
  /postgrest/i,
  /\bRLS\b/,
  /KADE_FEE_MODE/,
  /SECURITY INVOKER/i,
  /passkey_credentials/i,
  /household_members/i,
  /profile_residences/i,
  /profile_citizenships/i,
  /\bgate\b/i,
];

function expectNoInternalVocabulary() {
  const text = document.body.textContent ?? '';
  for (const pattern of INTERNAL_VOCABULARY) {
    expect(text).not.toMatch(pattern);
  }
}

/** A restored resident: household of three, aiming at the 5-year tier. */
const RESTORED_SNAPSHOT: OnboardingSnapshot = {
  profile: { firstName: 'Ada', lastName: 'Lovelace', dob: '1990-01-01' },
  citizenships: ['NL'],
  residences: [{ countryCode: 'NL', fromYear: 2021, toYear: 'present' }],
  tier: 1,
  members: [
    {
      name: 'Grace Lovelace',
      relation: 'Daughter',
      dob: '2015-05-05',
      citizenship: 'DE',
    },
    {
      name: 'Alan Lovelace',
      relation: 'Son',
      dob: '2017-01-01',
      citizenship: 'DE',
    },
  ],
};

function renderRestoredFlow(store: OnboardingStore) {
  return render(
    <OnboardingFlow
      userId="user-1"
      mode="demo"
      persistence="supabase"
      initial={RESTORED_SNAPSHOT}
      initialFee={demoFee(3)}
      network="Ethereum Sepolia"
      accountState={{ kind: 'pending' }}
      currentYear={2026}
      initialCredentialId="cred-existing"
      store={store}
    />,
  );
}

async function reachFeeStep() {
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByRole('heading', { name: /show proof of wealth/i });
  fireEvent.click(screen.getAllByRole('button', { name: /^connect$/i })[0]!);
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByRole('heading', {
    name: /pay the pre-approval fee and go live/i,
  });
}

describe('what is the resident\u2019s and what is demo', () => {
  it('drives the fee from the restored household, not the applicant alone', async () => {
    const { store } = makeStore();
    renderRestoredFlow(store);

    // The restored household of three is what the server is asked about.
    await waitFor(() =>
      expect(hoisted.previewPreapprovalFee).toHaveBeenCalledWith(3),
    );
    expect(hoisted.previewPreapprovalFee).not.toHaveBeenCalledWith(1);

    await reachFeeStep();

    expect(
      await screen.findByText(/household · 3 members at 0\.25 USDC each/i),
    ).toBeInTheDocument();
    expect(await screen.findByText('1.75 USDC')).toBeInTheDocument();
  });

  it('shows the resident\u2019s own tier target, not a reference default', async () => {
    const { store } = makeStore();
    renderRestoredFlow(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    // Tier 1 (5-year) is the resident's stored choice; $425,000 is its minimum.
    expect(screen.getByText(/target · 5-year/i)).toBeInTheDocument();
    expect(screen.getByText('$425,000')).toBeInTheDocument();
    expect(screen.queryByText(/target · 3-year/i)).toBeNull();
  });

  it('labels the mocked values and leaves the real ones unlabelled', async () => {
    const { store } = makeStore();
    renderFlow(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
    fireEvent.click(screen.getAllByRole('button', { name: /^connect$/i })[0]!);

    // The mocked balance figure carries a demo label next to it, and the step
    // still says so outright. The real tier target has no such label.
    expect(screen.getByText('Demo balances')).toBeInTheDocument();
    expect(screen.getByText(/balances shown are demo data/i)).toBeInTheDocument();
    expect(screen.getByText(/target · 3-year/i)).toBeInTheDocument();
    expectNoInternalVocabulary();

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });

    // The payment is labelled demo; the fee line states it is the configured
    // amount for this household, and the proof-of-wealth row is marked Demo.
    expect(screen.getByText('Demo payment')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText(/does not send a transaction/i)).toBeInTheDocument();
    expect(
      screen.getByText(/configured pre-approval fee for your household/i),
    ).toBeInTheDocument();
    expectNoInternalVocabulary();
  });
});
