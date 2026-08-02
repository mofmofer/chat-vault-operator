import type { ArchiveStatus, ConversationRecord, ReflectionStatus } from '../shared/types.js';
import { err, ok, type Result } from '../shared/result.js';

/**
 * Reflection states that permit approval.
 *
 * `reflected`     — the operator confirmed the content is captured in the Vault.
 * `not_required`  — the operator confirmed nothing needs capturing.
 *
 * `unreviewed` and `reflection_required` mean the decision has not been made
 * yet, so approving would risk archiving something not yet written down.
 */
export const APPROVABLE_REFLECTION_STATUSES: readonly ReflectionStatus[] = [
  'reflected',
  'not_required',
];

export type ApprovalRejection =
  | 'reflection_incomplete'
  | 'not_a_candidate'
  | 'already_approved'
  | 'immutable_archive_status';

/**
 * Statuses that phase 1 must never write. They belong to the (unimplemented)
 * archive execution phase, and only real observation of ChatGPT may set them.
 */
export const PHASE_2_ARCHIVE_STATUSES: readonly ArchiveStatus[] = [
  'archive_requested',
  'archive_observed',
  'reconciliation_required',
];

export function isReflectionSatisfied(record: ConversationRecord): boolean {
  return APPROVABLE_REFLECTION_STATUSES.includes(record.reflection_status);
}

/**
 * Gate for candidate -> approved.
 *
 * This is the single most important safety rule in phase 1: nothing reaches
 * `approved` without the operator having recorded that the conversation is
 * either reflected into the Vault or explicitly not worth reflecting.
 */
export function canApprove(record: ConversationRecord): Result<true, ApprovalRejection> {
  if (PHASE_2_ARCHIVE_STATUSES.includes(record.archive_status)) {
    return err('immutable_archive_status');
  }
  if (record.archive_status === 'approved') return err('already_approved');
  if (record.archive_status !== 'candidate') return err('not_a_candidate');
  if (!isReflectionSatisfied(record)) return err('reflection_incomplete');
  return ok(true);
}

export function approve(
  record: ConversationRecord,
  now: Date,
): Result<ConversationRecord, ApprovalRejection> {
  const gate = canApprove(record);
  if (!gate.ok) return gate;
  return ok({ ...record, archive_status: 'approved', approved_at: now.toISOString() });
}

/** Approval is reversible; revoking drops the record back to `candidate`. */
export function revokeApproval(
  record: ConversationRecord,
): Result<ConversationRecord, ApprovalRejection> {
  if (record.archive_status !== 'approved') return err('not_a_candidate');
  return ok({ ...record, archive_status: 'candidate', approved_at: null });
}

export function markCandidate(
  record: ConversationRecord,
): Result<ConversationRecord, ApprovalRejection> {
  if (PHASE_2_ARCHIVE_STATUSES.includes(record.archive_status)) {
    return err('immutable_archive_status');
  }
  if (record.archive_status === 'approved') return err('already_approved');
  return ok({ ...record, archive_status: 'candidate' });
}

export function unmarkCandidate(
  record: ConversationRecord,
): Result<ConversationRecord, ApprovalRejection> {
  if (PHASE_2_ARCHIVE_STATUSES.includes(record.archive_status)) {
    return err('immutable_archive_status');
  }
  if (record.archive_status === 'approved') return err('already_approved');
  return ok({ ...record, archive_status: 'active' });
}

/**
 * Applies a reflection-status change. Downgrading the reflection status of an
 * already-approved record would leave an approval that no longer satisfies the
 * gate, so approval is revoked in the same step.
 */
export function setReflection(
  record: ConversationRecord,
  next: {
    reflection_status: ReflectionStatus;
    reflection_reference?: string | null;
    reflection_summary?: string | null;
  },
  now: Date,
): ConversationRecord {
  const satisfied = APPROVABLE_REFLECTION_STATUSES.includes(next.reflection_status);
  // Omitting a field keeps the current value; passing an explicit null clears it.
  const updated: ConversationRecord = {
    ...record,
    reflection_status: next.reflection_status,
    reflection_reference:
      next.reflection_reference !== undefined
        ? next.reflection_reference
        : record.reflection_reference,
    reflection_summary:
      next.reflection_summary !== undefined ? next.reflection_summary : record.reflection_summary,
    reflection_completed_at: satisfied ? (record.reflection_completed_at ?? now.toISOString()) : null,
    updated_at: now.toISOString(),
  };

  if (!satisfied && updated.archive_status === 'approved') {
    updated.archive_status = 'candidate';
    updated.approved_at = null;
  }

  return updated;
}
