import type { ConversationRecord } from '../shared/types.js';
import { isSameLocalDay } from './conversation.js';
import { parseConversationUrl } from './conversation-url.js';

/**
 * Reasons a conversation is held back from archive candidacy.
 *
 * These are defaults, not hard locks: the operator may still mark an excluded
 * conversation as a candidate deliberately. What they cannot do is get there by
 * accident through a bulk action.
 */
export const EXCLUSION_REASONS = [
  'currently_open',
  'started_today',
  'in_project',
  'unidentifiable',
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  currently_open: 'Currently open in the ChatGPT tab',
  started_today: 'Started today',
  in_project: 'Belongs to a Project',
  unidentifiable: 'No unique conversation id / URL',
};

export interface CandidateContext {
  /** Injected rather than read from the clock so the rules stay testable. */
  now: Date;
  /** conversation_id currently displayed in the ChatGPT tab, if known. */
  activeConversationId: string | null;
}

/**
 * A record is unidentifiable when its id or URL cannot be trusted to point at
 * exactly one conversation. Titles are irrelevant here by design.
 */
export function isUnidentifiable(record: ConversationRecord): boolean {
  if (typeof record.conversation_id !== 'string' || record.conversation_id.trim() === '') {
    return true;
  }
  const parsed = parseConversationUrl(record.url);
  if (parsed === null) return true;
  return parsed.conversation_id !== record.conversation_id;
}

/**
 * "Started today" is deliberately conservative. The sidebar only exposes a
 * coarse bucket, so a conversation whose best-known date is today's date is
 * treated as today's work and left alone.
 */
export function isStartedToday(record: ConversationRecord, now: Date): boolean {
  if (record.created_at === null) return false;
  const created = new Date(record.created_at);
  if (Number.isNaN(created.getTime())) return false;
  return isSameLocalDay(created, now);
}

/** Returns every default-exclusion reason that applies, in a stable order. */
export function evaluateExclusions(
  record: ConversationRecord,
  ctx: CandidateContext,
): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];

  if (
    ctx.activeConversationId !== null &&
    ctx.activeConversationId === record.conversation_id
  ) {
    reasons.push('currently_open');
  }
  if (isStartedToday(record, ctx.now)) reasons.push('started_today');
  if (record.project_id !== null) reasons.push('in_project');
  if (isUnidentifiable(record)) reasons.push('unidentifiable');

  return reasons;
}

/** True when a conversation may be added to candidates by a bulk default action. */
export function isDefaultEligibleCandidate(
  record: ConversationRecord,
  ctx: CandidateContext,
): boolean {
  return evaluateExclusions(record, ctx).length === 0;
}
