import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

/**
 * Multi-connection behaviour of the link/verify panel.
 *
 * wagmi keeps every live connection, so a resident can have two wallets
 * connected at once. The panel must offer each distinct address its own action
 * and sign the address the resident chose — never an implicit `connections[0]`.
 * Each row keeps its own state, so a failure on one leaves the others usable.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{ accounts: string[] }>,
  signMessageAsync: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));

import { WalletLinkPanel } from '@/components/holdings/WalletLinkPanel';

const ADDRESS_A = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_B = '0x1234567890AbCdEf1234567890aBcDeF12345678';

/** The `<li>` row for an address, found by the full address in its title. */
function rowFor(address: string): HTMLElement {
  const row = screen.getByTitle(address).closest('li');
  if (!row) throw new Error(`No row rendered for ${address}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
  hoisted.signMessageAsync.mockResolvedValue('0xsignature');
});

describe('WalletLinkPanel with multiple live connections', () => {
  it('links the address the resident chose, not the first connection', async () => {
    hoisted.connections = [{ accounts: [ADDRESS_A] }, { accounts: [ADDRESS_B] }];
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async () => ({ ok: true }));
    const onLinked = vi.fn();

    render(
      <WalletLinkPanel
        configured
        onBegin={onBegin}
        onComplete={onComplete}
        onLinked={onLinked}
      />,
    );

    // One action per distinct address.
    expect(
      screen.getAllByRole('button', { name: 'Sign to link' }),
    ).toHaveLength(2);

    fireEvent.click(
      within(rowFor(ADDRESS_B)).getByRole('button', { name: 'Sign to link' }),
    );

    await waitFor(() => expect(onBegin).toHaveBeenCalledWith(ADDRESS_B));
    expect(onBegin).not.toHaveBeenCalledWith(ADDRESS_A);
    await waitFor(() =>
      expect(hoisted.signMessageAsync).toHaveBeenCalledWith({
        account: ADDRESS_B,
        message: `challenge:${ADDRESS_B}`,
      }),
    );
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        address: ADDRESS_B,
        message: `challenge:${ADDRESS_B}`,
        signature: '0xsignature',
      }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);

    // Only the chosen address shows its own confirmation.
    expect(
      within(rowFor(ADDRESS_B)).getByText(/Linked · verified signature/),
    ).toBeInTheDocument();
    expect(
      within(rowFor(ADDRESS_A)).queryByText(/Linked · verified signature/),
    ).toBeNull();
  });

  it('deduplicates connected addresses case-insensitively', () => {
    hoisted.connections = [
      { accounts: [ADDRESS_A] },
      { accounts: [ADDRESS_A.toLowerCase()] },
    ];

    render(
      <WalletLinkPanel
        configured
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole('button', { name: 'Sign to link' }),
    ).toHaveLength(1);
  });

  it('surfaces one address’s failure and leaves the other usable', async () => {
    hoisted.connections = [{ accounts: [ADDRESS_A] }, { accounts: [ADDRESS_B] }];
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async ({ address }: { address: string }) => {
      if (address === ADDRESS_B) throw new Error('Signature rejected for B.');
      return { ok: true };
    });
    const onLinked = vi.fn();

    render(
      <WalletLinkPanel
        configured
        onBegin={onBegin}
        onComplete={onComplete}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(
      within(rowFor(ADDRESS_B)).getByRole('button', { name: 'Sign to link' }),
    );

    expect(await within(rowFor(ADDRESS_B)).findByRole('alert')).toHaveTextContent(
      'Signature rejected for B.',
    );
    expect(onLinked).not.toHaveBeenCalled();

    // The untouched row still links successfully.
    const buttonA = within(rowFor(ADDRESS_A)).getByRole('button', {
      name: 'Sign to link',
    });
    expect(buttonA).toBeEnabled();
    fireEvent.click(buttonA);

    await waitFor(() =>
      expect(
        within(rowFor(ADDRESS_A)).getByText(/Linked · verified signature/),
      ).toBeInTheDocument(),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      address: ADDRESS_A,
      message: `challenge:${ADDRESS_A}`,
      signature: '0xsignature',
    });
  });
});
