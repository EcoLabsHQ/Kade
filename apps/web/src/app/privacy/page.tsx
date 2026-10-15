import type { Metadata } from 'next';
import { PrivacyScreen } from '@/components/legal/PrivacyScreen';

/**
 * Public privacy policy.
 *
 * Static and session-free (no data reads, no redirects), so it is reachable by
 * an unauthenticated visitor; `/privacy` is listed in `PUBLIC_PATHS`
 * (`@/lib/routing`). It stays `noindex` via the root layout, like every route.
 */
export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How EcoLabs B.V. collects, uses and shares personal data for the Onchain Island residency platform powered by Kade.',
};

export default function PrivacyPage() {
  return <PrivacyScreen />;
}
