'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/supabase/server';
import { recordFeePayment } from '@/lib/payments/server';
import type { RecordFeeResult } from '@/lib/payments/preapproval-fee';

/**
 * The pre-approval fee write, executed on the server.
 *
 * The wallet signs and sends the USDC transfer in the browser; the transaction
 * hash and the connected address cross this boundary. The server independently
 * reads the Sepolia receipt (`recordFeePayment`) and records the hash only when
 * the receipt proves a payment made by that same address, so a client cannot
 * assert a payment that did not happen, nor claim another wallet's transfer.
 * The treasury, the RPC endpoint and the amount are all server-side.
 */
export async function recordPreapprovalFeePayment(
  txHash: string,
  payer: string,
): Promise<RecordFeeResult> {
  const session = await getSessionUser();
  if (!session) return { status: 'unauthenticated' };

  const result = await recordFeePayment(session.userId, txHash, payer);
  if (result.status === 'paid') {
    revalidatePath('/onboarding');
  }
  return result;
}
