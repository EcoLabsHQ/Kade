import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { readSiteUrl } from '@/lib/env';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plus-jakarta',
});

const APP_TITLE = 'Onchain Island Residency Platform powered by Kade';
const APP_NAME = 'Onchain Island';
/**
 * Truthful and short. Residency applications are tracked online; banking,
 * card issuance, payouts and borrowing are mocks or beyond current scope and
 * must not be presented here as live.
 */
const APP_DESCRIPTION =
  'Onchain Island residency, powered by Kade. Apply for residency and track your application online. Banking, cards, payouts and borrowing are not available yet.';

export const metadata: Metadata = {
  // Resolved from NEXT_PUBLIC_SITE_URL (localhost fallback) so OpenGraph and
  // canonical URLs are absolute in every environment without a hard-coded
  // production origin.
  metadataBase: new URL(readSiteUrl()),
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  robots: { index: false },
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
};

/** Browser UI colour from the supplied favicon README (#008CFF). */
export const viewport: Viewport = {
  themeColor: '#008CFF',
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
