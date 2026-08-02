import type { ConversationRecord, ObservedConversation } from '../shared/types.js';

/** Builds a fresh record from a sidebar observation. All local state starts empty. */
export function createRecordFromObservation(observed: ObservedConversation): ConversationRecord {
  return {
    conversation_id: observed.conversation_id,
    url: observed.url,
    title: observed.title,
    created_at: observed.created_at,
    updated_at: null,
    project_id: observed.project_id,
    reflection_status: 'unreviewed',
    reflection_reference: null,
    reflection_summary: null,
    reflection_completed_at: null,
    archive_status: 'active',
    approved_at: null,
    archived_at: null,
    last_observed_at: observed.observed_at,
    operation_attempts: 0,
    error_code: null,
    error_message: null,
  };
}

/**
 * Folds a new observation into an existing record.
 *
 * Observations may only refresh what the DOM actually tells us (title, url,
 * project membership, observation time). Operator-authored state — reflection
 * fields, archive status, approvals — is never touched by a scan.
 *
 * `created_at` is only filled in, never overwritten: the first observation is
 * the closest one to the truth, and later sidebar buckets get vaguer as the
 * conversation ages.
 */
export function applyObservation(
  existing: ConversationRecord,
  observed: ObservedConversation,
): ConversationRecord {
  return {
    ...existing,
    url: observed.url,
    title: observed.title,
    project_id: observed.project_id,
    created_at: existing.created_at ?? observed.created_at,
    last_observed_at: observed.observed_at,
  };
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Start of the local day, as an ISO-8601 string. */
export function startOfLocalDayIso(at: Date): string {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
  return d.toISOString();
}
