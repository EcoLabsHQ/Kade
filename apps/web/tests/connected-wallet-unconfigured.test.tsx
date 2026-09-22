import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The unconfigured proof-of-wealth path, rendered through the *real*
 * `WalletProvider`.
 *
 * This file deliberately does NOT mock `@reown/appkit/react` or `wagmi`. In the
 * test environment `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset, so
 * `wagmiAdapter` is null and `WalletProvider` renders its children with no
 * `WagmiProvider` and no `createAppKit`. Under exactly those conditions every
 * AppKit/wagmi hook throws when called — which is the crash the adversarial
 * review found, because the panel previously called all four unconditionally and
 * the onboarding route has no error boundary.
 *
 * `connected-wallet.test.tsx` mocks those hooks, so it cannot see that crash.
 * This test can: if the hooks move back into the always-rendered component, the
 * real render below throws instead of reporting the not-configured notice.
 */

// The balance server action is the only thing mocked here. It is never reached
// on the unconfigured path, but importing the real module would pull in the
// Supabase server client; mocking it keeps the test on the wallet wiring.
vi.mock('@/app/onboarding/wallet-actions', () => ({
  readAddressBalances: vi.fn(),
}));

import { ConnectedWalletPanel } from '@/components/wallet/ConnectedWalletPanel';
import { WalletProvider } from '@/components/wallet/WalletProvider';

afterEach(cleanup);

describe('ConnectedWalletPanel without a WalletConnect project id', () => {
  it('renders the not-configured notice through the real WalletProvider and does not throw', () => {
    const onChange = vi.fn();

    expect(() =>
      render(
        <WalletProvider cookies={null}>
          <ConnectedWalletPanel configured={false} onChange={onChange} />
        </WalletProvider>,
      ),
    ).not.toThrow();

    expect(
      screen.getByText(/wallet connection is not configured/i),
    ).toBeInTheDocument();

    // The routes are still named for honesty, but they are inert: no modal was
    // created, so the buttons cannot open one.
    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    expect(connectButtons).toHaveLength(2);
    for (const button of connectButtons) {
      expect(button).toBeDisabled();
    }

    expect(onChange).not.toHaveBeenCalled();
  });

  it('never reports a connected wallet while unconfigured', () => {
    const onChange = vi.fn();

    render(
      <WalletProvider cookies={null}>
        <ConnectedWalletPanel configured={false} onChange={onChange} />
      </WalletProvider>,
    );

    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
