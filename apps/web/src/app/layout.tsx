import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plus-jakarta',
});

export const metadata: Metadata = {
  title: 'Kade — Resident Platform',
  description:
    'Kade resident platform: Google or email sign-in, with a separate transaction passkey.',
  robots: { index: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body
        style={{
          fontFamily:
            "var(--font-plus-jakarta), 'Plus Jakarta Sans', system-ui, sans-serif",
          color: '#101828',
          fontSize: '15px',
          lineHeight: 1.55,
        }}
      >
        {children}
      </body>
    </html>
  );
}
