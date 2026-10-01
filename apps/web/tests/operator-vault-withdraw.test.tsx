import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { Address, Hex } from 'viem';

/**
 * The operator withdrawal: route gate, server validation and client wiring.
 *
 * The tool is off by default (`KADE_OPERATOR_WITHDRAW=1` enables it) and
 * unlinked. These tests pin the three things that make it safe and honest:
 *
 *   1. the route is a 404 when the flag is off;
 *   2. the server refuses a bad destination, an over-balance amount and an
 *      unsupported chain with a specific reason, before anything is built; and
 *   3. the client drives the same two-phase passkey flow as Invest and reports
 *      success only for a confirmed receipt.
 *
 * Every collaborator is mocked, so nothing touches the network, the database or
 * a bundler. The client test exercises the **real** actions against the mocked
 * Safe-4337 seam, so the wiring under test is the production wiring.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  parseP256PublicKey: vi.fn(),
  toPasskeySigner: vi.fn(),
  loadShellSafe: vi.fn(),
  deriveAccountFromPasskey: vi.fn(),
  readSafeTokenBalance: vi.fn(),
  loadOperatorWithdrawBalances: vi.fn(),
  buildResidentSafeBatchFromEnv: vi.fn(),
  submitResidentSafeOperationFromEnv: vi.fn(),
  promptPasskeyAssertionParts: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: hoisted.notFound,
  redirect: hoisted.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));
vi.mock('@/lib/safe/passkey-signer', () => ({
  toPasskeySigner: hoisted.toPasskeySigner,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: vi.fn().mockResolvedValue({
    show: false,
    reference: null,
    isReviewer: false,
  }),
}));
vi.mock('@/lib/safe/derive-account', () => ({
  deriveAccountFromPasskey: hoisted.deriveAccountFromPasskey,
}));
vi.mock('@/app/vault/withdraw/balances', () => ({
  readSafeTokenBalance: hoisted.readSafeTokenBalance,
  loadOperatorWithdrawBalances: hoisted.loadOperatorWithdrawBalances,
}));
vi.mock('@/lib/safe/execute-safe-4337-env', () => ({
  buildResidentSafeBatchFromEnv: hoisted.buildResidentSafeBatchFromEnv,
  submitResidentSafeOperationFromEnv: hoisted.submitResidentSafeOperationFromEnv,
}));
vi.mock('@/lib/passkey/assertion', () => ({
  promptPasskeyAssertionParts: hoisted.promptPasskeyAssertionParts,
}));

import {
  beginOperatorWithdraw,
  completeOperatorWithdraw,
} from '@/app/vault/withdraw/actions';
import { WithdrawScreen } from '@/app/vault/withdraw/WithdrawScreen';
import OperatorWithdrawPage from '@/app/vault/withdraw/page';
import type { OperatorWithdrawBalance } from '@/app/vault/withdraw/types';
import { isOperatorWithdrawEnabled } from '@/app/vault/withdraw/gate';

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address;
const OTHER_SAFE = '0x9999999999999999999999999999999999999999' as Address;
const DESTINATION = '0x1111222233334444555566667777888899990000' as Address;
const ZERO = '0x0000000000000000000000000000000000000000';
const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const TOKEN = 'tok-w1';

const SIGNER = {
  rawId: 'abcdef',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444',
} as const;

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

const BALANCES: OperatorWithdrawBalance[] = [
  {
    chainId: 1,
    chainName: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000000000000000',
    nativeReason: null,
    usdcAmount: '10.000000',
    usdcReason: null,
  },
  {
    chainId: 8453,
    chainName: 'Base',
    nativeSymbol: 'ETH',
    nativeAmount: null,
    nativeReason: 'the Base RPC endpoint (BASE_RPC_URL) is not set',
    usdcAmount: null,
    usdcReason: 'the Base RPC endpoint (BASE_RPC_URL) is not set',
  },
  {
    chainId: 42161,
    chainName: 'Arbitrum One',
    nativeSymbol: 'ETH',
    nativeAmount: '0.000000000000000000',
    nativeReason: null,
    usdcAmount: '0.000000',
    usdcReason: null,
  },
];

function seedContext(): void {
  hoisted.getSessionUser.mockResolvedValue({
    domain: 'application-session',
    provider: 'email',
    userId: 'user-1',
    email: 'resident@example.com',
  });
  hoisted.loadPasskeyCredential.mockResolvedValue({
    credentialId: 'Y3JlZA',
    publicKey: 'pk-1',
    signerAddress: null,
    transports: ['internal'],
    userVerification: true,
    createdAt: '2026-01-02T03:04:05.000Z',
    lastUsedAt: null,
  });
  hoisted.parseP256PublicKey.mockReturnValue({ x: 1n, y: 2n });
  hoisted.toPasskeySigner.mockReturnValue(SIGNER);
  hoisted.loadShellSafe.mockResolvedValue({
    address: SAFE,
    deployed: false,
    explorerUrl: null,
    status: 'predicted',
  });
  hoisted.deriveAccountFromPasskey.mockResolvedValue({
    safeAddress: SAFE,
    deployed: false,
    chainId: 1,
  });
  hoisted.readSafeTokenBalance.mockResolvedValue({
    status: 'read',
    balance: 10_000_000n,
  });
  hoisted.buildResidentSafeBatchFromEnv.mockResolvedValue({
    status: 'built',
    sent: false,
    token: TOKEN,
    hash: SAFE_OP_HASH,
  });
  hoisted.submitResidentSafeOperationFromEnv.mockResolvedValue({
    status: 'sent',
    sent: true,
    userOperationHash: USER_OP_HASH,
    transactionHash: '0xfeed' as Hex,
  });
  hoisted.promptPasskeyAssertionParts.mockResolvedValue(ASSERTION);
}

const originalFlag = process.env.KADE_OPERATOR_WITHDRAW;

beforeEach(() => {
  vi.clearAllMocks();
  seedContext();
  process.env.KADE_OPERATOR_WITHDRAW = '1';
});

afterEach(() => {
  cleanup();
  if (originalFlag === undefined) delete process.env.KADE_OPERATOR_WITHDRAW;
  else process.env.KADE_OPERATOR_WITHDRAW = originalFlag;
});

describe('operator withdrawal route gate', () => {
  it('is a 404 when the flag is off', async () => {
    delete process.env.KADE_OPERATOR_WITHDRAW;
    await expect(OperatorWithdrawPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(hoisted.notFound).toHaveBeenCalledTimes(1);
    // The gate runs before anything else: no session read, no balance read.
    expect(hoisted.getSessionUser).not.toHaveBeenCalled();
    expect(hoisted.loadOperatorWithdrawBalances).not.toHaveBeenCalled();
  });

  it('is reachable when the flag is exactly "1"', async () => {
    await OperatorWithdrawPage();
    expect(hoisted.notFound).not.toHaveBeenCalled();
    expect(hoisted.getSessionUser).toHaveBeenCalled();
    expect(hoisted.loadOperatorWithdrawBalances).toHaveBeenCalledWith(SAFE);
  });

  it('treats any value other than "1" as disabled', () => {
    expect(isOperatorWithdrawEnabled({ KADE_OPERATOR_WITHDRAW: '1' })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      expect(
        isOperatorWithdrawEnabled({ KADE_OPERATOR_WITHDRAW: value }),
      ).toBe(false);
    }
  });
});

describe('beginOperatorWithdraw validation', () => {
  it('refuses a bad destination with a specific reason', async () => {
    const result = await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 1,
      token: 'usdc',
      destination: 'not-an-address',
      amount: '1000000',
    });
    expect(result.status).toBe('gated');
    if (result.status !== 'gated') throw new Error('expected gated');
    expect(result.gate).toBe('invalid-destination');
    expect(result.reason).toMatch(/not a valid address/i);
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('refuses the zero address and the Safe itself as destination', async () => {
    for (const destination of [ZERO, SAFE]) {
      const result = await beginOperatorWithdraw({
        safeAddress: SAFE,
        chainId: 1,
        token: 'usdc',
        destination,
        amount: '1000000',
      });
      expect(result.status).toBe('gated');
      if (result.status !== 'gated') throw new Error('expected gated');
      expect(result.gate).toBe('invalid-destination');
      expect(result.reason).toMatch(/zero address|Safe itself/i);
    }
  });

  it('refuses an amount above the Safe balance with the held and needed figures', async () => {
    hoisted.readSafeTokenBalance.mockResolvedValue({
      status: 'read',
      balance: 1_000_000n,
    });
    const result = await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 1,
      token: 'usdc',
      destination: DESTINATION,
      amount: '2000000',
    });
    expect(result.status).toBe('gated');
    if (result.status !== 'gated') throw new Error('expected gated');
    expect(result.gate).toBe('insufficient-balance');
    expect(result.reason).toMatch(/holds 1(\.0+)? USDC/i);
    expect(result.reason).toMatch(/asks for 2(\.0+)?/i);
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('refuses a chain that is not a configured vault chain', async () => {
    const result = await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 999,
      token: 'usdc',
      destination: DESTINATION,
      amount: '1000000',
    });
    expect(result.status).toBe('gated');
    if (result.status !== 'gated') throw new Error('expected gated');
    expect(result.gate).toBe('chain-not-supported');
    expect(result.reason).toMatch(/999/);
    expect(result.reason).toMatch(/Ethereum mainnet, Base or Arbitrum One/i);
  });

  it('refuses a non-positive or non-integer amount', async () => {
    for (const amount of ['0', '-1', '1.5', 'abc', '']) {
      const result = await beginOperatorWithdraw({
        safeAddress: SAFE,
        chainId: 1,
        token: 'usdc',
        destination: DESTINATION,
        amount,
      });
      expect(result.status).toBe('gated');
      if (result.status !== 'gated') throw new Error('expected gated');
      expect(result.gate).toBe('invalid-amount');
    }
  });

  it('refuses a Safe that is not the recorded one', async () => {
    const result = await beginOperatorWithdraw({
      safeAddress: OTHER_SAFE,
      chainId: 1,
      token: 'usdc',
      destination: DESTINATION,
      amount: '1000000',
    });
    expect(result.status).toBe('gated');
    if (result.status !== 'gated') throw new Error('expected gated');
    expect(result.gate).toBe('safe-mismatch');
  });

  it('refuses when the balance cannot be read, rather than passing', async () => {
    hoisted.readSafeTokenBalance.mockResolvedValue({
      status: 'failed',
      reason: 'the Base RPC endpoint (BASE_RPC_URL) is not set',
    });
    const result = await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 8453,
      token: 'usdc',
      destination: DESTINATION,
      amount: '1000000',
    });
    expect(result.status).toBe('gated');
    if (result.status !== 'gated') throw new Error('expected gated');
    expect(result.gate).toBe('balance-unreadable');
    expect(result.reason).toMatch(/BASE_RPC_URL/);
  });

  it('refuses everything when the flag is off', async () => {
    delete process.env.KADE_OPERATOR_WITHDRAW;
    const result = await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 1,
      token: 'usdc',
      destination: DESTINATION,
      amount: '1000000',
    });
    expect(result.status).toBe('gated');
    if (result.status !== 'gated') throw new Error('expected gated');
    expect(result.gate).toBe('disabled');
    expect(hoisted.getSessionUser).not.toHaveBeenCalled();
  });

  it('builds ONE USDC transfer call and signs nothing', async () => {
    const result = await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 1,
      token: 'usdc',
      destination: DESTINATION,
      amount: '1500000',
    });

    expect(result).toEqual({
      status: 'ready',
      token: TOKEN,
      hash: SAFE_OP_HASH,
      credentialId: SIGNER.rawId,
      chainId: 1,
    });

    const buildInput = hoisted.buildResidentSafeBatchFromEnv.mock.calls[0]?.[0];
    expect(buildInput).toMatchObject({
      signer: SIGNER,
      safeAddress: null,
      chainId: 1,
    });
    expect(buildInput.calls).toHaveLength(1);
    // ERC-20 `transfer(address,uint256)` selector.
    expect(buildInput.calls[0].value).toBe(0n);
    expect(buildInput.calls[0].data).toMatch(/^0xa9059cbb/);
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });

  it('builds a plain value transfer for the native coin', async () => {
    hoisted.readSafeTokenBalance.mockResolvedValue({
      status: 'read',
      balance: 2_000_000_000_000_000_000n,
    });
    await beginOperatorWithdraw({
      safeAddress: SAFE,
      chainId: 1,
      token: 'native',
      destination: DESTINATION,
      amount: '1500000000000000000',
    });
    const buildInput = hoisted.buildResidentSafeBatchFromEnv.mock.calls[0]?.[0];
    expect(buildInput.calls).toEqual([
      { to: DESTINATION, value: 1_500_000_000_000_000_000n, data: '0x' },
    ]);
  });
});

describe('completeOperatorWithdraw', () => {
  it('returns the engine outcome verbatim, success only for a confirmed receipt', async () => {
    const result = await completeOperatorWithdraw({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });
    expect(result).toEqual({
      status: 'sent',
      sent: true,
      userOperationHash: USER_OP_HASH,
      transactionHash: '0xfeed',
    });
    expect(hoisted.submitResidentSafeOperationFromEnv).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      signer: SIGNER,
      safeAddress: null,
      chainId: 1,
    });
  });

  it('names the stage of a refusal', async () => {
    hoisted.submitResidentSafeOperationFromEnv.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });
    const result = await completeOperatorWithdraw({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('expected failed');
    expect(result.stage).toBe('sign');
    expect(result.sent).toBe(false);
  });

  it('refuses a submit when the flag is off', async () => {
    delete process.env.KADE_OPERATOR_WITHDRAW;
    const result = await completeOperatorWithdraw({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('expected failed');
    expect(result.stage).toBe('resolve');
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });
});

describe('WithdrawScreen wiring', () => {
  function runButton() {
    return screen.getByRole('button', { name: /build the withdrawal/i });
  }

  it('runs build → passkey → submit and reports a confirmed receipt', async () => {
    render(<WithdrawScreen safeAddress={SAFE} balances={BALANCES} />);

    fireEvent.change(screen.getByLabelText('Destination address'), {
      target: { value: DESTINATION },
    });
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '1.5' },
    });
    fireEvent.click(runButton());

    await waitFor(() =>
      expect(hoisted.submitResidentSafeOperationFromEnv).toHaveBeenCalledTimes(1),
    );

    // The real actions resolved the stored credential, built the transfer and
    // submitted the retained operation in order.
    expect(hoisted.buildResidentSafeBatchFromEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: SIGNER,
        chainId: 1,
        calls: [
          expect.objectContaining({
            to: expect.any(String),
            value: 0n,
            data: expect.stringMatching(/^0xa9059cbb/),
          }),
        ],
      }),
    );
    expect(hoisted.promptPasskeyAssertionParts).toHaveBeenCalledWith({
      credentialId: SIGNER.rawId,
      challenge: SAFE_OP_HASH,
      rpId: window.location.hostname,
    });
    expect(hoisted.submitResidentSafeOperationFromEnv).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      signer: SIGNER,
      safeAddress: null,
      chainId: 1,
    });

    const buildOrder =
      hoisted.buildResidentSafeBatchFromEnv.mock.invocationCallOrder[0] ?? 0;
    const passkeyOrder =
      hoisted.promptPasskeyAssertionParts.mock.invocationCallOrder[0] ?? 0;
    const submitOrder =
      hoisted.submitResidentSafeOperationFromEnv.mock.invocationCallOrder[0] ?? 0;
    expect(buildOrder).toBeLessThan(passkeyOrder);
    expect(passkeyOrder).toBeLessThan(submitOrder);

    const finish = await screen.findByTestId('operator-withdraw-complete');
    expect(within(finish).getByText(/receipt confirmed/i)).toBeInTheDocument();
    expect(within(finish).getByText('0xfeed')).toBeInTheDocument();
  });

  it('shows a gated refusal with the server reason and does not prompt the passkey', async () => {
    hoisted.buildResidentSafeBatchFromEnv.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'init',
      reason: 'Safe4337Pack could not be initialised: bundler unreachable',
    });
    render(<WithdrawScreen safeAddress={SAFE} balances={BALANCES} />);
    fireEvent.change(screen.getByLabelText('Destination address'), {
      target: { value: DESTINATION },
    });
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '1' },
    });
    fireEvent.click(runButton());

    expect(
      await screen.findByText(/Safe4337Pack could not be initialised/i),
    ).toBeInTheDocument();
    expect(hoisted.promptPasskeyAssertionParts).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('operator-withdraw-complete'),
    ).toBeNull();
  });

  it('fills the whole balance when All is used', async () => {
    render(<WithdrawScreen safeAddress={SAFE} balances={BALANCES} />);
    fireEvent.click(screen.getByRole('button', { name: /use the full balance/i }));
    expect(screen.getByLabelText('Amount')).toHaveValue('10.000000');
  });
});
