import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import type { BitcoinAddressRecord, EvmAddressRecord } from '@/lib/wealth/types';
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
  addBitcoinAddress: vi.fn(),
  removeBitcoinAddress: vi.fn(),
  addWalletAddress: vi.fn(),
  removeWalletAddress: vi.fn(),
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
// The Bitcoin actions are server actions: they read the chain server-side. They
// are mocked so the client is exercised against a recorded server outcome.
vi.mock('@/app/onboarding/wealth-actions', () => ({
  addBitcoinAddress: hoisted.addBitcoinAddress,
  removeBitcoinAddress: hoisted.removeBitcoinAddress,
}));
// The pasted EVM ("wallet address") actions are server actions: they read the
// chain and persist server-side. They are mocked so the client is exercised
// against recorded outcomes, with no database or provider.
vi.mock('@/app/onboarding/wallet-actions', () => ({
  addWalletAddress: hoisted.addWalletAddress,
  removeWalletAddress: hoisted.removeWalletAddress,
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
  hoisted.addBitcoinAddress.mockReset();
  hoisted.removeBitcoinAddress.mockReset();
  hoisted.addWalletAddress.mockReset();
  hoisted.removeWalletAddress.mockReset();
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

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The applicant's date of birth is a calendar trigger, not a native input. */
function pickApplicantDob() {
  fireEvent.click(screen.getByLabelText('Date of birth'));
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  fireEvent.click(screen.getByRole('button', { name: iso }));
}

function addHouseholdMember(
  name: string,
  relation: string,
  dob: string,
  citizenship: string,
) {
  fireEvent.click(screen.getByRole('button', { name: /add member/i }));
  const index = screen.getAllByLabelText(/household member \d+ name/i).length;
  setField(`Household member ${index} name`, name);
  setField(`Household member ${index} relation`, relation);
  setField(`Household member ${index} date of birth`, dob);
  fireEvent.change(screen.getByLabelText(`Household member ${index} citizenship`), {
    target: { value: citizenship },
  });
}

/**
 * Fills Step 2 with the contract's worked example (a household of three, aiming
 * at the 3-year tier) so the flow can advance. Step 2 starts empty, so nothing
 * here may rely on a prefill; the few "clear first" steps also keep it correct
 * on a build that still carried an example.
 */
function fillStep2Wizard() {
  let memberToRemove = screen.queryAllByRole('button', {
    name: /remove household member/i,
  })[0];
  while (memberToRemove) {
    fireEvent.click(memberToRemove);
    memberToRemove = screen.queryAllByRole('button', {
      name: /remove household member/i,
    })[0];
  }

  setField('First name', 'Marcus');
  setField('Last name', 'Feldt');
  pickApplicantDob();

  if (screen.queryByRole('button', { name: /remove germany citizenship/i }) === null) {
    fireEvent.change(screen.getByLabelText('Add citizenship'), {
      target: { value: 'DE' },
    });
  }
  if (screen.queryByRole('button', { name: /remove germany residence/i }) === null) {
    fireEvent.change(screen.getByLabelText('Add residence country'), {
      target: { value: 'DE' },
    });
  }

  fireEvent.click(screen.getByRole('radio', { name: /3-year/ }));

  addHouseholdMember('Lena Feldt', 'Spouse', '1985-07-22', 'NL');
  addHouseholdMember('Emil Feldt', 'Son', '2015-05-03', 'DE');
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

    // Step 2 starts empty now that the example prefill is gone: no demo
    // defaults are present, so the flow must be filled before it can advance.
    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    expect(
      (screen.getByLabelText('First name') as HTMLInputElement).value,
    ).toBe('');
    fillStep2Wizard();
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
    fillStep2Wizard();

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
    fillStep2Wizard();

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
    fillStep2Wizard();

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
    fillStep2Wizard();

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

function renderRestoredFlow(
  store: OnboardingStore,
  initialBitcoinAddresses?: readonly BitcoinAddressRecord[],
  initialEvmAddresses?: readonly EvmAddressRecord[],
) {
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
      initialBitcoinAddresses={initialBitcoinAddresses}
      initialEvmAddresses={initialEvmAddresses}
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
    fillStep2Wizard();

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

/** One confirmed Bitcoin address, as the server action returns it. */
const BITCOIN_RECORD: BitcoinAddressRecord = {
  id: 7,
  address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  btc: '0.01234567',
  usd: 812.34,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

/** Opens the collapsed Bitcoin row's paste flow. */
function openBitcoinPaste() {
  fireEvent.click(screen.getByRole('button', { name: /bitcoin address/i }));
}

/** Opens the collapsed wallet-address row's paste flow. */
function openEvmPaste() {
  fireEvent.click(screen.getByRole('button', { name: /wallet address/i }));
}

describe('the Bitcoin address is read for real, not demoed', () => {
  async function goToWealth(
    store: OnboardingStore,
    bitcoin: readonly BitcoinAddressRecord[] = [],
    evm: readonly EvmAddressRecord[] = [],
  ) {
    renderRestoredFlow(store, bitcoin, evm);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
  }

  it('shows an Add address pill that expands to the paste input', async () => {
    const { store } = makeStore();
    await goToWealth(store);

    // Collapsed: an Add address pill, and no input until it is opened.
    expect(
      screen.getByRole('button', { name: 'Add a Bitcoin address' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Bitcoin address')).toBeNull();

    openBitcoinPaste();
    expect(screen.getByLabelText('Bitcoin address')).toBeInTheDocument();
  });

  it('calls the action on Confirm and shows the returned BTC and USD', async () => {
    const { store } = makeStore();
    await goToWealth(store);
    hoisted.addBitcoinAddress.mockResolvedValue(BITCOIN_RECORD);
    openBitcoinPaste();

    fireEvent.change(screen.getByLabelText('Bitcoin address'), {
      target: { value: BITCOIN_RECORD.address },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Bitcoin address' }),
    );

    await waitFor(() =>
      expect(hoisted.addBitcoinAddress).toHaveBeenCalledWith(
        BITCOIN_RECORD.address,
      ),
    );
    expect(await screen.findByText(BITCOIN_RECORD.address)).toBeInTheDocument();
    expect(screen.getByText('0.01234567 BTC')).toBeInTheDocument();
    expect(screen.getAllByText('$812').length).toBeGreaterThan(0);
    // A confirmed source flips the row's right side to the Read state: the
    // balance was read, nothing was signed.
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('labels the read values as read from the network, not demo', async () => {
    const { store } = makeStore();
    await goToWealth(store);
    hoisted.addBitcoinAddress.mockResolvedValue(BITCOIN_RECORD);
    openBitcoinPaste();

    fireEvent.change(screen.getByLabelText('Bitcoin address'), {
      target: { value: BITCOIN_RECORD.address },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Bitcoin address' }),
    );
    await screen.findByText(BITCOIN_RECORD.address);

    expect(screen.getByText('Read from the network')).toBeInTheDocument();
    expect(
      screen.getAllByText(/not proof of ownership/i).length,
    ).toBeGreaterThan(0);
    // The Bitcoin read is real, so the all-demo chip is gone.
    expect(screen.queryByText('Demo balances')).toBeNull();
    // The demo rows still say they are demo.
    expect(screen.getAllByText('Demo').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the row and shows the error when the read fails', async () => {
    const { store } = makeStore();
    await goToWealth(store);
    hoisted.addBitcoinAddress.mockResolvedValue({
      ...BITCOIN_RECORD,
      btc: null,
      usd: null,
      readError: 'Address not found on the network.',
    });
    openBitcoinPaste();

    fireEvent.change(screen.getByLabelText('Bitcoin address'), {
      target: { value: BITCOIN_RECORD.address },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Bitcoin address' }),
    );

    expect(
      await screen.findByText(/address not found on the network/i),
    ).toBeInTheDocument();
    expect(screen.getByText(BITCOIN_RECORD.address)).toBeInTheDocument();
  });

  it('removes an address through the action', async () => {
    const { store } = makeStore();
    await goToWealth(store, [BITCOIN_RECORD]);
    hoisted.removeBitcoinAddress.mockResolvedValue(undefined);
    openBitcoinPaste();

    fireEvent.click(screen.getByRole('button', { name: /remove address/i }));

    await waitFor(() =>
      expect(hoisted.removeBitcoinAddress).toHaveBeenCalledWith(
        BITCOIN_RECORD.id,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText(BITCOIN_RECORD.address)).toBeNull(),
    );
  });

  it('gates Continue on a wallet or a Bitcoin address', async () => {
    const { store } = makeStore();
    await goToWealth(store);

    // Nothing connected yet: the gate is honest about both ways forward.
    const continueButton = screen.getByRole('button', { name: /^continue$/i });
    expect(continueButton).toBeDisabled();
    expect(continueButton.getAttribute('title')).toMatch(/wallet or a bitcoin/i);
  });

  it('allows Continue once a Bitcoin address is present', async () => {
    const { store } = makeStore();
    await goToWealth(store, [BITCOIN_RECORD]);

    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).toBeEnabled();
  });

  it('caps the number of addresses at five', async () => {
    const { store } = makeStore();
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...BITCOIN_RECORD,
      id: index + 1,
      address: `bc1qaddress${index + 1}0000000000000000000000000000000`,
    }));
    await goToWealth(store, five);
    openBitcoinPaste();

    expect(
      screen.getByRole('button', { name: 'Confirm Bitcoin address' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/maximum of 5 addresses reached/i),
    ).toBeInTheDocument();
  });
});

/** One confirmed pasted EVM address, as the server action returns it. */
const EVM_RECORD: EvmAddressRecord = {
  address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  chains: [
    { chainId: 1, name: 'Ethereum', symbol: 'ETH', amount: '0.512300', usd: 1600 },
    { chainId: 8453, name: 'Base', symbol: 'ETH', amount: '0.250000', usd: 780 },
  ],
  usd: 2380,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

describe('the pasted wallet address is read for real, not demoed', () => {
  async function goToWealth(
    store: OnboardingStore,
    evm: readonly EvmAddressRecord[] = [],
  ) {
    renderRestoredFlow(store, [], evm);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
  }

  it('shows the Wallet address row and adds an address with its chain balances', async () => {
    const { store } = makeStore();
    await goToWealth(store);
    hoisted.addWalletAddress.mockResolvedValue(EVM_RECORD);

    expect(screen.getByText('Wallet address')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add a wallet address' }),
    ).toBeInTheDocument();

    openEvmPaste();
    const confirm = screen.getByRole('button', {
      name: 'Confirm wallet address',
    });
    // Confirm is disabled until there is an address to read.
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Wallet address'), {
      target: { value: EVM_RECORD.address },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(hoisted.addWalletAddress).toHaveBeenCalledWith(EVM_RECORD.address),
    );
    expect(
      await screen.findByText(/Ethereum · 0\.512300 ETH/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Base · 0\.250000 ETH/)).toBeInTheDocument();
    // A confirmed source flips the row's right side to the Read state.
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('does not append a duplicate when the same address is re-added', async () => {
    const { store } = makeStore();
    await goToWealth(store);
    hoisted.addWalletAddress.mockResolvedValue(EVM_RECORD);
    openEvmPaste();

    for (let index = 0; index < 2; index += 1) {
      fireEvent.change(screen.getByLabelText('Wallet address'), {
        target: { value: EVM_RECORD.address },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm wallet address' }),
      );
      await waitFor(() =>
        expect(hoisted.addWalletAddress).toHaveBeenCalledTimes(index + 1),
      );
    }

    expect(
      screen.getAllByRole('button', { name: /remove wallet address/i }),
    ).toHaveLength(1);
  });

  it('labels the read values as read from a public source, not demo', async () => {
    const { store } = makeStore();
    await goToWealth(store, [EVM_RECORD]);

    expect(
      screen.getAllByText(/read from a public source/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/not proof of ownership/i).length,
    ).toBeGreaterThan(0);
    // A real read is present, so the all-demo chip is gone.
    expect(screen.queryByText('Demo balances')).toBeNull();
    // The demo rows still say they are demo.
    expect(screen.getAllByText('Demo').length).toBeGreaterThanOrEqual(2);
  });

  it('removes an address by address through the action', async () => {
    const { store } = makeStore();
    await goToWealth(store, [EVM_RECORD]);
    hoisted.removeWalletAddress.mockResolvedValue(undefined);
    openEvmPaste();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove wallet address ${EVM_RECORD.address}`,
      }),
    );

    await waitFor(() =>
      expect(hoisted.removeWalletAddress).toHaveBeenCalledWith(
        EVM_RECORD.address,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByTitle(EVM_RECORD.address)).toBeNull(),
    );
  });

  it('caps the number of addresses at five', async () => {
    const { store } = makeStore();
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...EVM_RECORD,
      address: `0x${String(index + 1).repeat(40).slice(0, 40)}`,
    }));
    await goToWealth(store, five);
    openEvmPaste();

    expect(
      screen.getByRole('button', { name: 'Confirm wallet address' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/maximum of 5 addresses reached/i),
    ).toBeInTheDocument();
  });

  it('allows Continue once a wallet address is present', async () => {
    const { store } = makeStore();
    await goToWealth(store, [EVM_RECORD]);

    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).toBeEnabled();
  });
});
