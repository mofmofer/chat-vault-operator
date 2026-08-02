import type { ConversationRecord } from '../shared/types.js';
import { isReflectionSatisfied } from './approval.js';
import {
  evaluateExclusions,
  type CandidateContext,
  type ExclusionReason,
} from './candidates.js';

/**
 * Dry Run answers one question: "if archive execution existed, what exactly
 * would it touch right now?"
 *
 * Phase 1 never executes anything. The plan is a report, and building it has no
 * side effects on stored records.
 */

export type DryRunSkipReason = ExclusionReason | 'not_approved' | 'reflection_incomplete';

export const DRY_RUN_SKIP_LABELS: Record<DryRunSkipReason, string> = {
  currently_open: 'Currently open in the ChatGPT tab',
  started_today: 'Started today',
  in_project: 'Belongs to a Project',
  unidentifiable: 'No unique conversation id / URL',
  not_approved: 'Not approved',
  reflection_incomplete: 'Vault reflection not confirmed',
};

export interface DryRunRow {
  conversation_id: string;
  title: string;
  url: string;
  created_at: string | null;
  project_id: string | null;
  in_project: boolean;
  reflection_status: ConversationRecord['reflection_status'];
  reflection_reference: string | null;
  archive_status: ConversationRecord['archive_status'];
  included: boolean;
  skip_reasons: DryRunSkipReason[];
}

export interface DryRunPlan {
  generated_at: string;
  included: DryRunRow[];
  excluded: DryRunRow[];
  /** Number of conversations a future archive run would act on. */
  planned_count: number;
  total_evaluated: number;
}

function toRow(
  record: ConversationRecord,
  skipReasons: DryRunSkipReason[],
): DryRunRow {
  return {
    conversation_id: record.conversation_id,
    title: record.title,
    url: record.url,
    created_at: record.created_at,
    project_id: record.project_id,
    in_project: record.project_id !== null,
    reflection_status: record.reflection_status,
    reflection_reference: record.reflection_reference,
    archive_status: record.archive_status,
    included: skipReasons.length === 0,
    skip_reasons: skipReasons,
  };
}

/**
 * Evaluates one record. A record is included only when it is approved, its
 * reflection gate still holds, and no default exclusion applies.
 *
 * The exclusion checks are re-run here on purpose. Approval may have happened
 * days ago, and facts can change underneath it — a conversation can be moved
 * into a Project, or be the one currently open on screen.
 */
export function evaluateDryRunRow(
  record: ConversationRecord,
  ctx: CandidateContext,
): DryRunRow {
  const skipReasons: DryRunSkipReason[] = [];

  if (record.archive_status !== 'approved') skipReasons.push('not_approved');
  if (!isReflectionSatisfied(record)) skipReasons.push('reflection_incomplete');
  skipReasons.push(...evaluateExclusions(record, ctx));

  return toRow(record, skipReasons);
}

export function buildDryRunPlan(
  records: ConversationRecord[],
  ctx: CandidateContext,
): DryRunPlan {
  const rows = records.map((record) => evaluateDryRunRow(record, ctx));
  const included = rows.filter((row) => row.included);
  const excluded = rows.filter((row) => !row.included);

  return {
    generated_at: ctx.now.toISOString(),
    included,
    excluded,
    planned_count: included.length,
    total_evaluated: rows.length,
  };
}
