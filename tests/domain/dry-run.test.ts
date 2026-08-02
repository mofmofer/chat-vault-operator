import { describe, expect, it } from 'vitest';
import { buildDryRunPlan } from '../../extension/src/domain/dry-run.js';
import type { CandidateContext } from '../../extension/src/domain/candidates.js';
import type { ConversationRecord } from '../../extension/src/shared/types.js';
import { makeConversationRecord } from '../helpers/factories.js';

const NOW = new Date(2026, 7, 2, 9, 0, 0);
const OLD = new Date(2026, 6, 28, 3, 0, 0).toISOString();

function baseCtx(overrides: Partial<CandidateContext> = {}): CandidateContext {
  return { now: NOW, activeConversationId: null, ...overrides };
}

describe('buildDryRunPlan', () => {
  it('includes an approved + reflected + clean record and counts it in planned_count', () => {
    const record = makeConversationRecord({
      archive_status: 'approved',
      reflection_status: 'reflected',
      created_at: OLD,
      project_id: null,
    });

    const plan = buildDryRunPlan([record], baseCtx());

    expect(plan.total_evaluated).toBe(1);
    expect(plan.planned_count).toBe(1);
    expect(plan.included).toHaveLength(1);
    expect(plan.excluded).toHaveLength(0);
    expect(plan.included[0]?.conversation_id).toBe(record.conversation_id);
    expect(plan.included[0]?.included).toBe(true);
    expect(plan.included[0]?.skip_reasons).toEqual([]);
  });

  it('excludes a candidate that is not yet approved, with reason not_approved', () => {
    const record = makeConversationRecord({
      archive_status: 'candidate',
      reflection_status: 'reflected',
      created_at: OLD,
      project_id: null,
    });

    const plan = buildDryRunPlan([record], baseCtx());

    expect(plan.planned_count).toBe(0);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0]?.skip_reasons).toContain('not_approved');
  });

  it('excludes an approved record that has since been moved into a Project', () => {
    const record = makeConversationRecord({
      archive_status: 'approved',
      reflection_status: 'reflected',
      created_at: OLD,
      project_id: 'g-p-0123456789abcdef0123456789abcdef',
    });

    const plan = buildDryRunPlan([record], baseCtx());

    expect(plan.planned_count).toBe(0);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0]?.skip_reasons).toContain('in_project');
    expect(plan.excluded[0]?.skip_reasons).not.toContain('not_approved');
    expect(plan.excluded[0]?.skip_reasons).not.toContain('reflection_incomplete');
  });

  it('does not mutate the input records', () => {
    const records: ConversationRecord[] = [
      makeConversationRecord({ archive_status: 'approved', reflection_status: 'reflected', created_at: OLD }),
      makeConversationRecord({ archive_status: 'candidate', reflection_status: 'unreviewed' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(records)) as ConversationRecord[];

    buildDryRunPlan(records, baseCtx());

    expect(records).toEqual(snapshot);
  });
});
