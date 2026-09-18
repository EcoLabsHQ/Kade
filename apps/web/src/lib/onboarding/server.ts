import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createSupabaseOnboardingStore,
  type OnboardingSnapshot,
} from './persistence';

/**
 * Server-side restore for Step 2 (D5: "persists, validates, reloads").
 *
 * Kept in its own module so the browser bundle never pulls in the cookie-bound
 * server client. Callers must treat a throw as "nothing to restore" rather than
 * as an empty draft, so a broken read is not mistaken for "no saved data".
 */
export async function loadOnboardingSnapshot(
  userId: string,
): Promise<OnboardingSnapshot | null> {
  const client = await createSupabaseServerClient();
  const store = createSupabaseOnboardingStore(() => client);
  return store.load(userId);
}
