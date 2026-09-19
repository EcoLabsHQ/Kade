// Onchain gate approval loader.
//
// Registration of EAS schemas is irreversible and is gated by the Onchain gate
// (docs/week-1-frozen-delivery-contract.md section 7, checkpoint 3; approved
// 18 September 2026). Every script that could be mistaken for a registration
// step refuses to run unless an approval record exists and names an approver
// and a timestamp.
//
// The guard itself lives in @kade/shared (assertRegistrationApproved) and is
// reused here so there is a single definition of "approved".
import { readFileSync } from 'node:fs';
import { assertRegistrationApproved } from '@kade/shared';

export const DEFAULT_APPROVAL_PATH = new URL('../eas/approval.json', import.meta.url);

/**
 * Reads the approval record without asserting it, returning `null` when it is
 * absent or not valid JSON. Generators that merely describe the gate state use
 * this; anything that could be mistaken for a registration step uses
 * `loadApprovalRecord` and fails closed.
 */
export function readApprovalRecordOrNull(
  approvalPath = process.env.KADE_EAS_APPROVAL_FILE ?? DEFAULT_APPROVAL_PATH,
) {
  let raw;
  try {
    raw = readFileSync(approvalPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function loadApprovalRecord(approvalPath = process.env.KADE_EAS_APPROVAL_FILE ?? DEFAULT_APPROVAL_PATH) {
  let raw;
  try {
    raw = readFileSync(approvalPath, 'utf8');
  } catch {
    throw new Error(
      `EAS approval record not found at ${String(approvalPath)}. ` +
        'The Onchain gate must be approved before any EAS script runs.',
    );
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error(`EAS approval record at ${String(approvalPath)} is not valid JSON.`);
  }

  assertRegistrationApproved(record);
  return record;
}
