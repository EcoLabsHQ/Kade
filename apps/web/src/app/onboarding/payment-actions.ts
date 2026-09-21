'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/supabase/server';
import { recordFeePayment } from '@/lib/payments/server';
import type { RecordFeeResult } from '@/lib/payments/preapproval-fee';

/**
 * The pre-approval fee write, executed on the server.
 *
 * The wallet signs and sends the USDC transfer in the browser; only the
 * transaction hash crosses this boundary. The server independently reads the
 * Sepolia receipt (`recordFeePayment`) and records the hash only when the
 * receipt proves the payment, so a client cannot assert a payment that did not
 * happen. The treasury, the RPC endpoint and the amount are all server-side.
 */
export async function recordPreapprovalFeePayment(
  txHash: string,
): Promise<RecordFeeResult> {
  const session = await getSessionUser();
  if (!session) return { status: 'unauthenticated' };

  const result = await recordFeePayment(session.userId, txHash);
  if (result.status === 'paid') {
    revalidatePath('/onboarding');
  }
  return result;
}
