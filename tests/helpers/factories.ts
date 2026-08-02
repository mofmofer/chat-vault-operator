import type { ConversationRecord, ObservedConversation } from '../../extension/src/shared/types.js';

let recordCounter = 0;

/** Deterministic, UUID_RE-shaped id so factory output is always parseable. */
export function makeUuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/**
 * Builds a self-consistent ConversationRecord (url matches conversation_id) with
 * every field defaulted, so tests only need to specify what they care about.
 */
export function makeConversationRecord(
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  recordCounter += 1;
  const conversation_id = overrides.conversation_id ?? makeUuid(recordCounter);
  const base: ConversationRecord = {
    conversation_id,
    url: `https://chatgpt.com/c/${conversation_id}`,
    title: `Conversation ${recordCounter}`,
    created_at: null,
    updated_at: null,
    project_id: null,
    reflection_status: 'unreviewed',
    reflection_reference: null,
    reflection_summary: null,
    reflection_completed_at: null,
    archive_status: 'active',
    approved_at: null,
    archived_at: null,
    last_observed_at: null,
    operation_attempts: 0,
    error_code: null,
    error_message: null,
  };
  return { ...base, ...overrides };
}

export function makeObservedConversation(
  overrides: Partial<ObservedConversation> = {},
): ObservedConversation {
  recordCounter += 1;
  const conversation_id = overrides.conversation_id ?? makeUuid(recordCounter);
  const base: ObservedConversation = {
    conversation_id,
    url: `https://chatgpt.com/c/${conversation_id}`,
    title: `Conversation ${recordCounter}`,
    project_id: null,
    date_bucket: null,
    created_at: null,
    observed_at: new Date(2026, 7, 2, 9, 0, 0).toISOString(),
  };
  return { ...base, ...overrides };
}
