'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/components/ui/tokens';

/**
 * Retry an unfinished Safe deployment from the shell.
 *
 * A resident who reloads after a failed deployment starts the onboarding flow at
 * step 2 and never sees step 1 again, so the shell is the one place they can ask
 * for another attempt. The retry re-runs the same server action the onboarding
 * step uses: the address is deterministic and the engine is idempotent, so it
 * cannot create a second passkey or a second Safe.
 *
 * The action is imported lazily so rendering the card never pulls server-only
 * modules into the browser bundle. The status detail is not surfaced here — the
 * card already says whether the Safe exists, and the diagnostic is logged
 * server-side.
 */
export function SafeRetryButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function retry() {
    setBusy(true);
    setFailed(false);
    try {
      const { deployAccount } = await import('@/app/onboarding/deploy-actions');
      const result = await deployAccount();
      if (result.status !== 'deployed' && result.status !== 'already-deployed') {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      // Re-read the server-rendered shell so the card reflects the record.
      router.refresh();
    }
  }

  return (
    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={busy}
        style={{
          border: `1px solid ${tokens.border}`,
          borderRadius: '999px',
          background: '#fff',
          color: tokens.ink,
          fontFamily: 'inherit',
          fontSize: '11px',
          fontWeight: 600,
          padding: '3px 10px',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Retrying…' : 'Retry setup'}
      </button>
      {failed ? (
        <span style={{ fontSize: '11px', color: tokens.muted }}>
          Not yet — try again.
        </span>
      ) : null}
    </div>
  );
}
