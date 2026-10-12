import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';
import { shortAddress } from '@/lib/wealth/format';
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
  deriveAndRecordAccount: vi.fn(),
  previewPreapprovalFee: vi.fn(),
  savePasskeyCredential: vi.fn(),
  addBitcoinAddress: vi.fn(),
  removeBitcoinAddress: vi.fn(),
  addWalletAddress: vi.fn(),
  addConnectedWallet: vi.fn(),
  removeWalletAddress: vi.fn(),
  // Wallet + fee payment. The hooks are mocked so the flow is exercised
  // against recorded wallet state, with no AppKit modal or provider.
  open: vi.fn(),
  switchNetwork: vi.fn(),
  writeContract: vi.fn(),
  resetWrite: vi.fn(),
  recordPreapprovalFeePayment: vi.fn(),
  account: { isConnected: false, address: undefined as string | undefined },
  network: { chainId: 11155111 as number | string | undefined },
  receipt: { isLoading: false, isSuccess: false },
  // The connected-wallet panel reads balances through this server action.
  readAddressBalances: vi.fn(),
  disconnect: vi.fn(),
  connector: undefined as { id?: string; name?: string } | undefined,
  connections: [] as Array<{
    connector: { uid: string; id?: string; name?: string };
    accounts: string[];
  }>,
  // The ownership signer the Step 3 panel uses when the page supplies the
  // proof callbacks. Only the wallet half is mocked; the server half is the
  // injected callback in each test.
  signMessageAsync: vi.fn(),
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
vi.mock('@/app/onboarding/account-actions', () => ({
  deriveAndRecordAccount: hoisted.deriveAndRecordAccount,
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
  addConnectedWallet: hoisted.addConnectedWallet,
  removeWalletAddress: hoisted.removeWalletAddress,
  readAddressBalances: hoisted.readAddressBalances,
}));
// The wallet hooks come from AppKit and wagmi. They are mocked so the fee step
// renders against a recorded connection state rather than a real modal.
vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
  // AppKit's own modal state; the connected-wallet panel reads it to leave its
  // `connecting` step if the resident dismisses AppKit without connecting.
  useAppKitState: () => ({ open: false }),
  useAppKitAccount: () => hoisted.account,
  useAppKitNetwork: () => ({
    chainId: hoisted.network.chainId,
    switchNetwork: hoisted.switchNetwork,
  }),
}));
vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    data: undefined,
    writeContract: hoisted.writeContract,
    isPending: false,
    error: null,
    reset: hoisted.resetWrite,
  }),
  useWaitForTransactionReceipt: () => hoisted.receipt,
  useAccount: () => ({ connector: hoisted.connector }),
  useConnections: () => hoisted.connections,
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));
// The fee payment write is a server action; it is mocked so the fee step is
// exercised against a recorded server outcome.
vi.mock('@/app/onboarding/payment-actions', () => ({
  recordPreapprovalFeePayment: hoisted.recordPreapprovalFeePayment,
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
/** USDC on Sepolia, from `@kade/shared`. */
const SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
/** The treasury the flow is configured with. */
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A';

afterEach(() => {
  cleanup();
  hoisted.push.mockReset();
  hoisted.refresh.mockReset();
  hoisted.enrolPasskey.mockReset();
  hoisted.deriveAndRecordAccount.mockReset();
  hoisted.previewPreapprovalFee.mockReset();
  hoisted.savePasskeyCredential.mockReset();
  hoisted.addBitcoinAddress.mockReset();
  hoisted.removeBitcoinAddress.mockReset();
  hoisted.addWalletAddress.mockReset();
  hoisted.addConnectedWallet.mockReset();
  hoisted.removeWalletAddress.mockReset();
  hoisted.open.mockReset();
  hoisted.switchNetwork.mockReset();
  hoisted.writeContract.mockReset();
  hoisted.resetWrite.mockReset();
  hoisted.recordPreapprovalFeePayment.mockReset();
  hoisted.account.isConnected = false;
  hoisted.account.address = undefined;
  hoisted.readAddressBalances.mockReset();
  hoisted.disconnect.mockReset();
  hoisted.signMessageAsync.mockReset();
  hoisted.connector = undefined;
  hoisted.connections = [];
  hoisted.network.chainId = 11155111;
  hoisted.receipt.isLoading = false;
  hoisted.receipt.isSuccess = false;
});

function makeStore() {
  const save = vi.fn(async (userId: string, snapshot: OnboardingSnapshot) => ({
    applicationId: `app-${userId}`,
    preapprovalUsdc: preapprovalFeeUsdc('demo', 1 + snapshot.members.length),
  }));
  const store: OnboardingStore = { mode: 'supabase', load: async () => null, save };
  return { store, save };
}

const CONNECTED_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const CONNECTED_RECORD = {
  address: CONNECTED_ADDRESS,
  chains: [
    {
      chainId: 1,
      name: 'Ethereum',
      nativeSymbol: 'ETH',
      nativeAmount: '1.000000000000000000',
      nativeUsd: 2500,
      usdc: { symbol: 'USDC', amount: '10.000000', usd: 10 },
      usd: 2510,
    },
  ],
  usd: 2510,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

/**
 * Start a render with a wallet already connected.
 *
 * Connecting is a real AppKit modal now, so a test cannot click its way through
 * it; the recorded connection state is what the panel reads on mount.
 */
function connectWallet() {
  hoisted.account.isConnected = true;
  hoisted.account.address = CONNECTED_ADDRESS;
  hoisted.connector = { id: 'metaMask', name: 'MetaMask' };
  hoisted.connections = [
    {
      connector: { uid: 'uid-metaMask', id: 'metaMask', name: 'MetaMask' },
      accounts: [CONNECTED_ADDRESS],
    },
  ];
  hoisted.readAddressBalances.mockResolvedValue(CONNECTED_RECORD);
  // A connected wallet is saved with the connected-wallet provider through its
  // own action, so the flow has a record to store.
  hoisted.addConnectedWallet.mockResolvedValue(CONNECTED_RECORD);
}

/** A pasted address, used when a test needs step 3 satisfied but disconnected. */
const PASTED_RECORD = {
  address: '0x00000000000000000000000000000000000000A1',
  chains: [
    {
      chainId: 1,
      name: 'Ethereum',
      nativeSymbol: 'ETH',
      nativeAmount: '0.100000',
      nativeUsd: 250,
      usdc: null,
      usd: 250,
    },
  ],
  usd: 250,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

/**
 * Confirm a pasted wallet address. A pasted address is staged in a dialog and
 * joins the total only after the resident clicks "Add address".
 */
function confirmPastedWalletAddress() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm wallet address' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
}

/** Satisfy step 3 by pasting an address, leaving the wallet disconnected. */
async function passStep3WithPastedAddress() {
  hoisted.addWalletAddress.mockResolvedValue(PASTED_RECORD);
  openEvmPaste();
  fireEvent.change(screen.getByLabelText('Wallet address'), {
    target: { value: PASTED_RECORD.address },
  });
  confirmPastedWalletAddress();
  await screen.findAllByText(/Ethereum · 0\.100000 ETH/);
}

/**
 * Leave step 3. The connected wallet's balances are read asynchronously, so the
 * button becomes enabled only after the read resolves.
 */
async function continueFromWealth() {
  const button = screen.getByRole('button', { name: /^continue$/i });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

function renderFlow(store: OnboardingStore, connected = false) {
  if (connected) connectWallet();
  return render(
    <OnboardingFlow
      userId="user-1"
      mode="demo"
      persistence="supabase"
      initial={null}
      initialFee={demoFee(1)}
      initialPayment={{ status: 'none' }}
      paymentConfigured={false}
      treasuryAddress={null}
      usdcAddress={SEPOLIA_USDC}
      explorerUrl="https://sepolia.etherscan.io"
      walletConfigured={true}
      chainId={11155111}
      chainName="Ethereum Sepolia"
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
      initialPayment={{ status: 'none' }}
      paymentConfigured={false}
      treasuryAddress={null}
      usdcAddress={SEPOLIA_USDC}
      explorerUrl="https://sepolia.etherscan.io"
      walletConfigured={true}
      chainId={11155111}
      chainName="Ethereum Sepolia"
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
  // The empty applicant calendar opens 40 years ago (emptyViewYearsAgo), so
  // step forward to an unambiguously adult year before choosing the day.
  const age = 30;
  const now = new Date();
  const year = now.getFullYear() - age;
  const month = String(now.getMonth() + 1).padStart(2, '0');
  let viewYear = now.getFullYear() - 40;
  while (viewYear < year) {
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    viewYear += 1;
  }
  fireEvent.click(screen.getByRole('button', { name: `${year}-${month}-15` }));
}

/**
 * Pick a household member's date of birth through the styled calendar, the same
 * control the applicant uses. The native date input is gone, so the test drives
 * the picker the way a resident would. The calendar opens at an offset that
 * depends on the selected relation: 16 years ago for a Child, 40 otherwise.
 */
function pickHouseholdDob(index: number, dob: string, relation: string) {
  const [year, month, day] = dob.split('-').map(Number);
  fireEvent.click(
    screen.getByLabelText(`Household member ${index} date of birth`),
  );

  // The picker opens on today's month; move to the target month first.
  const now = new Date();
  let viewMonth = now.getMonth();
  const targetMonth = month! - 1;
  while (viewMonth > targetMonth) {
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    viewMonth -= 1;
  }
  while (viewMonth < targetMonth) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    viewMonth += 1;
  }

  // The calendar opens at the relation-dependent offset; step to the target.
  let viewYear = now.getFullYear() - (relation === 'Child' ? 16 : 40);
  while (viewYear > year!) {
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    viewYear -= 1;
  }
  while (viewYear < year!) {
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    viewYear += 1;
  }

  const mm = String(month!).padStart(2, '0');
  const dd = String(day!).padStart(2, '0');
  fireEvent.click(screen.getByRole('button', { name: `${year}-${mm}-${dd}` }));
}

function addHouseholdMember(
  name: string,
  relation: string,
  dob: string,
  citizenship: string,
  gender = 'Female',
) {
  fireEvent.click(screen.getByRole('button', { name: /add member/i }));
  const index = screen.getAllByLabelText(/household member \d+ name/i).length;
  setField(`Household member ${index} name`, name);
  setField(`Household member ${index} relation`, relation);
  setField(`Household member ${index} gender`, gender);
  pickHouseholdDob(index, dob, relation);
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
  setField('Gender', 'Male');
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

  addHouseholdMember('Lena Feldt', 'Spouse', '1985-07-22', 'NL', 'Female');
  // A minor is a valid household member now: the 18+ floor was removed.
  addHouseholdMember('Emil Feldt', 'Child', '2010-05-03', 'DE', 'Male');
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
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'recorded',
      safeAddress: ACCOUNT_ADDRESS,
      deployed: false,
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
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'recorded',
      safeAddress: ACCOUNT_ADDRESS,
      deployed: false,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(ACCOUNT_ADDRESS);

    // The address comes from Safe's SDK through the server action, so the
    // browser never reproduces the derivation.
    expect(hoisted.deriveAndRecordAccount).toHaveBeenCalled();
  });

  it('keeps the passkey when the account could not be recorded, and says so', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'failed',
      safeAddress: null,
      deployed: false,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
    // A derivation that did not happen is reported, never silently swallowed.
    expect(
      await screen.findByText(/could not be set up yet/i),
    ).toBeInTheDocument();
  });

  it('says the address is being prepared while the derivation is in flight', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    // The derivation is a round trip to the chain, so hold it open and check
    // what the resident sees while it works. Without this the line showed a
    // dash and read as broken rather than busy.
    let release!: (value: unknown) => void;
    hoisted.deriveAndRecordAccount.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();

    expect(await screen.findByText(/preparing/i)).toBeInTheDocument();

    release({ status: 'recorded', safeAddress: ACCOUNT_ADDRESS, deployed: false });
    expect(await screen.findByText(ACCOUNT_ADDRESS)).toBeInTheDocument();
  });

  it('tries the derivation once per credential, not once per outcome', async () => {
    hoisted.enrolPasskey.mockResolvedValue(enrolResponse());
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'failed',
      safeAddress: null,
      deployed: false,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(/could not be set up yet/i);

    // The recording writes the account state itself, so an effect keyed on that
    // state would re-run after each failure and hammer the chain. One credential
    // means one attempt, however it ends.
    expect(hoisted.deriveAndRecordAccount).toHaveBeenCalledTimes(1);
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
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'recorded',
      safeAddress: ACCOUNT_ADDRESS,
      deployed: false,
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
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'recorded',
      safeAddress: ACCOUNT_ADDRESS,
      deployed: false,
    });
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
    await screen.findByText(ACCOUNT_ADDRESS);

    // One credential, one address: the account is recorded only after the
    // credential is persisted, because the server action reads it back from the
    // database rather than trusting anything the browser sends.
    const saveOrder =
      hoisted.savePasskeyCredential.mock.invocationCallOrder[0];
    const deriveOrder =
      hoisted.deriveAndRecordAccount.mock.invocationCallOrder[0];
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
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'recorded',
      safeAddress: ACCOUNT_ADDRESS,
      deployed: false,
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
    hoisted.deriveAndRecordAccount.mockResolvedValue({
      status: 'recorded',
      safeAddress: ACCOUNT_ADDRESS,
      deployed: false,
    });
    hoisted.savePasskeyCredential.mockRejectedValue(new Error('database down'));
    renderFlowFromStart(makeStore().store);

    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByText(/passkey created/i)).toBeInTheDocument();
    expect(screen.queryByText(/your account is ready/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
  });
});

// Several tests here walk the full step 2 → 4 wizard, driving calendar pickers
// and several async resolvers. Under a fully loaded suite run they exceed the
// 5s default, which made the mechanical gate fail spuriously while every test
// passed in isolation. The timeout is raised for the whole suite rather than
// per test so a new wizard-driving test cannot reintroduce the flake.
describe('pre-registration flow', { timeout: 20000 }, () => {
  // This walks the full step 2 → 4 path, driving two calendar pickers, so it
  // runs longer than the default timeout under a fully loaded test run.
  it(
    'walks from the saved profile through proof of wealth to the fee',
    async () => {
    const { store, save } = makeStore();
    renderFlow(store, true);

    // Step 2 starts empty now that the example prefill is gone: no demo
    // defaults are present, so the flow must be filled before it can advance.
    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    expect(
      (screen.getByLabelText('First name') as HTMLInputElement).value,
    ).toBe('');
    fillStep2Wizard();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // Step 3, gated until a source is present. The wallet is already connected
    // in this render, so its read account is the source.
    expect(
      await screen.findByRole('heading', { name: /show proof of wealth/i }),
    ).toBeInTheDocument();
    // The panel shows the address truncated; the full value stays on the title.
    // It appears twice: the row subtitle and the wallet's detail card.
    expect(
      (await screen.findAllByText(shortAddress(CONNECTED_ADDRESS))).length,
    ).toBeGreaterThan(0);
    const continueButton = screen.getByRole('button', { name: /^continue$/i });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    // Step 4, with the file and the server-controlled fee.
    expect(
      await screen.findByRole('heading', {
        name: /pay the pre-approval fee and go live/i,
      }),
    ).toBeInTheDocument();
    // Household of three, the contract's worked example.
    expect(await screen.findByText('1.75 USDC')).toBeInTheDocument();

    // Payment is not configured in this render, so the step says so rather
    // than offering a control that could only fail.
    expect(screen.getByText(/payment is not configured/i)).toBeInTheDocument();
    },
    15000,
  );

  it('opens the platform when the server restored a paid fee', async () => {
    connectWallet();
    render(
      <OnboardingFlow
        userId="user-1"
        mode="demo"
        persistence="supabase"
        initial={RESTORED_SNAPSHOT}
        initialFee={demoFee(3)}
        initialPayment={{ status: 'paid', txHash: `0x${'ab'.repeat(32)}` }}
        paymentConfigured
        treasuryAddress={TREASURY}
        usdcAddress={SEPOLIA_USDC}
        explorerUrl="https://sepolia.etherscan.io"
      walletConfigured={true}
        chainId={11155111}
        chainName="Ethereum Sepolia"
        network="Ethereum Sepolia"
        accountState={{ kind: 'pending' }}
        currentYear={2026}
        initialCredentialId="cred-existing"
        store={makeStore().store}
      />,
    );
    await reachFeeStep();
    expect(
      await screen.findByRole('button', { name: /enter the platform/i }),
    ).toBeInTheDocument();
  });

  it('offers the wallet connection when the fee is unpaid and configured', async () => {
    hoisted.account.isConnected = false;
    render(
      <OnboardingFlow
        userId="user-1"
        mode="demo"
        persistence="supabase"
        initial={RESTORED_SNAPSHOT}
        initialFee={demoFee(3)}
        initialPayment={{ status: 'none' }}
        paymentConfigured
        treasuryAddress={TREASURY}
        usdcAddress={SEPOLIA_USDC}
        explorerUrl="https://sepolia.etherscan.io"
      walletConfigured={true}
        chainId={11155111}
        chainName="Ethereum Sepolia"
        network="Ethereum Sepolia"
        accountState={{ kind: 'pending' }}
        currentYear={2026}
        initialCredentialId="cred-existing"
        store={makeStore().store}
      />,
    );
    await reachFeeStep({ connected: false });
    // The deposit control now lives in the modal, so open it first.
    fireEvent.click(screen.getByRole('button', { name: /^deposit$/i }));
    expect(
      await screen.findByRole('button', { name: /connect wallet/i }),
    ).toBeInTheDocument();
  });

  it('labels the mocked steps so they are not mistaken for real operations', async () => {
    const { store } = makeStore();
    renderFlow(store, true);
    fillStep2Wizard();

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    // Every figure is a public read now, and the step says so.
    expect(
      screen.getAllByText(/reads your balances on Ethereum, Base/i).length,
    ).toBeGreaterThan(0);

    await continueFromWealth();
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });
    expect(
      screen.getByText(/verified from the transaction receipt/i),
    ).toBeInTheDocument();
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
    renderFlow(store, true);
    fillStep2Wizard();

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
    await continueFromWealth();
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
    renderFlow(store, true);
    fillStep2Wizard();

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });
    await continueFromWealth();
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });

    expect(
      await screen.findByText(/configured pre-approval fee could not be read/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/USDC/)).toBeNull();
    expect(
      screen.getByText(/configured fee could not be read, so payment is unavailable/i),
    ).toBeInTheDocument();
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
  profile: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dob: '1990-01-01',
    gender: 'Female',
  },
  citizenships: ['NL'],
  residences: [{ countryCode: 'NL', fromYear: 2021, toYear: 'present' }],
  tier: 1,
  members: [
    {
      name: 'Grace Lovelace',
      relation: 'Daughter',
      dob: '1992-05-05',
      citizenship: 'DE',
      gender: 'Female',
    },
    {
      name: 'Alan Lovelace',
      relation: 'Son',
      dob: '1990-01-01',
      citizenship: 'DE',
      gender: 'Male',
    },
  ],
};

function renderRestoredFlow(
  store: OnboardingStore,
  initialBitcoinAddresses?: readonly BitcoinAddressRecord[],
  initialEvmAddresses?: readonly EvmAddressRecord[],
  connected = false,
  ownership?: {
    onBegin: (address: string) => Promise<{ message: string }>;
    onComplete: (input: {
      address: string;
      message: string;
      signature: string;
    }) => Promise<{ ok: boolean }>;
  },
) {
  if (connected) connectWallet();
  return render(
    <OnboardingFlow
      userId="user-1"
      mode="demo"
      persistence="supabase"
      initial={RESTORED_SNAPSHOT}
      initialFee={demoFee(3)}
      initialPayment={{ status: 'none' }}
      paymentConfigured={false}
      treasuryAddress={null}
      usdcAddress={SEPOLIA_USDC}
      explorerUrl="https://sepolia.etherscan.io"
      walletConfigured={true}
      chainId={11155111}
      chainName="Ethereum Sepolia"
      network="Ethereum Sepolia"
      accountState={{ kind: 'pending' }}
      currentYear={2026}
      initialCredentialId="cred-existing"
      store={store}
      initialBitcoinAddresses={initialBitcoinAddresses}
      initialEvmAddresses={initialEvmAddresses}
      onBegin={ownership?.onBegin}
      onComplete={ownership?.onComplete}
    />,
  );
}

async function reachFeeStep({ connected = true }: { connected?: boolean } = {}) {
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByRole('heading', { name: /show proof of wealth/i });
  // Step 3 needs a source: a connected wallet, or a pasted address when the test
  // needs the wallet to stay disconnected.
  if (connected) {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled(),
    );
  } else {
    await passStep3WithPastedAddress();
  }
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByRole('heading', {
    name: /pay the pre-approval fee and go live/i,
  });
}

describe('what is the resident\u2019s and what is demo', () => {
  it('drives the fee from the restored household, not the applicant alone', async () => {
    const { store } = makeStore();
    renderRestoredFlow(store, undefined, undefined, true);

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

  it('labels the wallet as a public read and never as demo', async () => {
    const { store } = makeStore();
    renderFlow(store, true);
    fillStep2Wizard();

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    // The connected wallet's balances are a public read, and the step says so.
    // Nothing on this screen is labelled demo any more, and the real tier target
    // carries no label at all.
    expect(
      (await screen.findAllByText(/reads your balances on Ethereum, Base/i))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryByText('Demo balances')).toBeNull();
    expect(screen.getByText(/target · 3-year/i)).toBeInTheDocument();
    expectNoInternalVocabulary();

    await continueFromWealth();
    await screen.findByRole('heading', {
      name: /pay the pre-approval fee and go live/i,
    });

    // The payment rail is labelled testnet; the fee line states it is the
    // configured amount for this household, and nothing claims demo state.
    expect(screen.getByText('Testnet payment')).toBeInTheDocument();
    expect(
      screen.getByText(/verified from the transaction receipt/i),
    ).toBeInTheDocument();
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
  fireEvent.click(
    screen.getByRole('button', { name: /^add (a )?wallet address$/i }),
  );
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
    // Nothing is demo any more: the read is real and the demo rows are gone.
    expect(screen.queryByText('Demo balances')).toBeNull();
    expect(screen.queryByText('Demo')).toBeNull();
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
    {
      chainId: 1,
      name: 'Ethereum',
      nativeSymbol: 'ETH',
      nativeAmount: '0.512300',
      nativeUsd: 1416.5,
      usdc: { symbol: 'USDC', amount: '183.500000', usd: 183.5 },
      usd: 1600,
    },
    {
      chainId: 8453,
      name: 'Base',
      nativeSymbol: 'ETH',
      nativeAmount: '0.250000',
      nativeUsd: 690.9,
      usdc: { symbol: 'USDC', amount: '89.100000', usd: 89.1 },
      usd: 780,
    },
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
    // Confirm stages the address; nothing is saved until the dialog is answered.
    fireEvent.click(confirm);
    expect(hoisted.addWalletAddress).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Add this address?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }));

    await waitFor(() =>
      expect(hoisted.addWalletAddress).toHaveBeenCalledWith(EVM_RECORD.address),
    );
    // The asset breakdown appears once per chain, in the Proof of wealth
    // summary card that is now the single list of saved wallets.
    expect(
      (await screen.findAllByText(/Ethereum · 0\.512300 ETH/)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Base · 0\.250000 ETH/).length).toBeGreaterThanOrEqual(1);
    // USDC is read too, on both chains, not just the native coin.
    expect(
      screen.getAllByText(/Ethereum · .* · 183\.500000 USDC/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/Base · .* · 89\.100000 USDC/).length,
    ).toBeGreaterThanOrEqual(1);
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
      confirmPastedWalletAddress();
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
    // Nothing is demo any more: the read is real and the demo rows are gone.
    expect(screen.queryByText('Demo balances')).toBeNull();
    expect(screen.queryByText('Demo')).toBeNull();
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

describe('a wallet is counted once however it arrives', () => {
  it('counts an address that is both connected and pasted exactly once', async () => {
    const { store } = makeStore();
    // `EVM_RECORD.address` is the same address `connectWallet` connects. The
    // connected read is saved through the connected-wallet action, so it
    // replaces the pasted duplicate rather than adding to it.
    renderRestoredFlow(store, undefined, [EVM_RECORD], true);
    // The restored snapshot already fills step 2, so it advances directly.
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    // The connected read is saved ($2,510); the pasted duplicate ($2,380) is
    // replaced, not summed on top of it. The save and the teardown of the live
    // connection are two asynchronous steps, so wait for the settled summary:
    // the saved value present, and the source count no longer joined with a
    // still-live connection. Either step alone can be observed transiently.
    await waitFor(() => {
      expect(screen.getAllByText('$2,510').length).toBeGreaterThan(0);
      expect(screen.getByText('1 wallet address')).toBeInTheDocument();
    });
    expect(screen.queryByText('$4,890')).toBeNull();
    expect(screen.queryByText('1 connected wallet')).toBeNull();
  });

  it('persists a connected wallet through addConnectedWallet, not the pasted action', async () => {
    const { store } = makeStore();
    renderRestoredFlow(store, undefined, undefined, true);
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    await waitFor(() =>
      expect(hoisted.addConnectedWallet).toHaveBeenCalledWith(
        CONNECTED_ADDRESS,
      ),
    );
    // The connected address never takes the pasted path: that would write the
    // wrong provider and keep it out of the unverified Holdings section.
    expect(hoisted.addWalletAddress).not.toHaveBeenCalled();
  });
});

describe('Step 3 signs a connected wallet when the page supplies the proof callbacks', () => {
  it('saves and signs the connected wallet, and never gates Continue on it', async () => {
    const { store } = makeStore();
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async () => ({ ok: true }));
    hoisted.signMessageAsync.mockResolvedValue('0xsignature');
    renderRestoredFlow(store, undefined, undefined, true, {
      onBegin,
      onComplete,
    });

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    // The wallet is saved first, then the resident triggers the signature.
    await waitFor(() =>
      expect(hoisted.addConnectedWallet).toHaveBeenCalledWith(CONNECTED_ADDRESS),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sign to verify' }),
    );
    await waitFor(() => expect(onBegin).toHaveBeenCalledWith(CONNECTED_ADDRESS));
    expect(hoisted.signMessageAsync).toHaveBeenCalledWith({
      account: CONNECTED_ADDRESS,
      message: `challenge:${CONNECTED_ADDRESS}`,
    });
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        address: CONNECTED_ADDRESS,
        message: `challenge:${CONNECTED_ADDRESS}`,
        signature: '0xsignature',
      }),
    );

    // A signature is never required to proceed: the saved row still satisfies
    // Step 3 and Continue stays available.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled(),
    );
  });

  it('never signs a pasted Bitcoin address', async () => {
    const { store } = makeStore();
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    hoisted.addBitcoinAddress.mockResolvedValue(BITCOIN_RECORD);
    renderRestoredFlow(store, undefined, undefined, false, {
      onBegin,
      onComplete: vi.fn(async () => ({ ok: true })),
    });

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /show proof of wealth/i });

    openBitcoinPaste();
    fireEvent.change(screen.getByLabelText('Bitcoin address'), {
      target: { value: BITCOIN_RECORD.address },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Bitcoin address' }),
    );
    await screen.findByText(BITCOIN_RECORD.address);

    expect(hoisted.addBitcoinAddress).toHaveBeenCalledWith(
      BITCOIN_RECORD.address,
    );
    // A pasted Bitcoin address has nothing an EVM connection can sign, so the
    // ownership path is never reached.
    expect(onBegin).not.toHaveBeenCalled();
    expect(hoisted.signMessageAsync).not.toHaveBeenCalled();
  });
});

