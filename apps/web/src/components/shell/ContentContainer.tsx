import type { ReactNode } from 'react';

/** The reference's content column: 1160px max width, 36/40/64 padding. */
export function ContentContainer({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: '1160px',
        width: '100%',
        margin: '0 auto',
        padding: '36px 40px 64px',
        animation: 'fadeUp .2s ease-out',
      }}
    >
      {children}
    </div>
  );
}
