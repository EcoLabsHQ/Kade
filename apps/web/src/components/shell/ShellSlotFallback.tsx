import type { CSSProperties } from 'react';

/**
 * A neutral placeholder for a shell slot whose data is still streaming in.
 *
 * The shell renders its frame immediately after the session check; the Safe
 * card, the review notice and the Admin affordance resolve behind `<Suspense>`
 * and fill in later. This is what those boundaries show while they wait.
 *
 * It is deliberately **empty and decorative**: a grey block with no text, no
 * address, no balance, no status and no name. It must never render the value
 * props `AppShell` derives when it has no data — that would flash "no account
 * yet" or the `0x…` placeholder for a resident whose account does exist, and a
 * disabled Admin switch for a reviewer.
 *
 * It mirrors the shell skeleton already used by `app/loading.tsx`
 * (`Bar`-shaped, `#E7EBF0`) so the column does not jump when the real slot
 * arrives.
 */
export function ShellSlotFallback({
  height,
  radius = 6,
  testId,
  style,
}: {
  readonly height: number;
  readonly radius?: number;
  readonly testId: string;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      data-testid={testId}
      style={{
        width: '100%',
        height,
        borderRadius: radius,
        background: '#E7EBF0',
        ...style,
      }}
    />
  );
}
