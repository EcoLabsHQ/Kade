import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { RESIDENT_NAV, type NavGroupConfig } from './nav';

export interface AppShellProps {
  readonly children: ReactNode;
  readonly email: string | null;
  readonly safeAddress?: string | null;
  readonly network?: string;
  readonly nav?: readonly NavGroupConfig[];
}

/**
 * The authenticated application frame: 240px sidebar plus the content column.
 * Rendered as a Server Component so the shell never blocks on a chain read
 * (ADR 0002).
 */
export function AppShell({
  children,
  email,
  safeAddress = null,
  network = 'Ethereum Sepolia',
  nav = RESIDENT_NAV,
}: AppShellProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#fff',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <Sidebar
        nav={nav}
        network={network}
        safeAddress={safeAddress}
        email={email}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </main>
    </div>
  );
}
