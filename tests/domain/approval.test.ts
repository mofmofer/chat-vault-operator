import { describe, expect, it } from 'vitest';
import { approve, canApprove, setReflection } from '../../extension/src/domain/approval.js';
import { makeConversationRecord } from '../helpers/factories.js';

const NOW = new Date(2026, 7, 2, 9, 0, 0);

describe('approval gate', () => {
  it('cannot approve when reflection_status is unreviewed', () => {
    const record = makeConversationRecord({
      archive_status: 'candidate',
      reflection_status: 'unreviewed',
    });

    const gate = canApprove(record);
    expect(gate).toEqual({ ok: false, error: 'reflection_incomplete' });

    const result = approve(record, NOW);
    expect(result).toEqual({ ok: false, error: 'reflection_incomplete' });
    // Record itself must be unchanged.
    expect(record.archive_status).toBe('candidate');
    expect(record.approved_at).toBeNull();
  });

  it('cannot approve when reflection_status is reflection_required', () => {
    const record = makeConversationRecord({
      archive_status: 'candidate',
      reflection_status: 'reflection_required',
    });

    const gate = canApprove(record);
    expect(gate).toEqual({ ok: false, error: 'reflection_incomplete' });

    const result = approve(record, NOW);
    expect(result).toEqual({ ok: false, error: 'reflection_incomplete' });
    expect(record.archive_status).toBe('candidate');
    expect(record.approved_at).toBeNull();
  });

  it('approves when reflected + candidate', () => {
    const record = makeConversationRecord({
      archive_status: 'candidate',
      reflection_status: 'reflected',
    });

    const result = approve(record, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archive_status).toBe('approved');
      expect(result.value.approved_at).toBe(NOW.toISOString());
    }
    // Original record must not be mutated in place.
    expect(record.archive_status).toBe('candidate');
    expect(record.approved_at).toBeNull();
  });

  it('approves when not_required + candidate', () => {
    const record = makeConversationRecord({
      archive_status: 'candidate',
      reflection_status: 'not_required',
    });

    const result = approve(record, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archive_status).toBe('approved');
      expect(result.value.approved_at).toBe(NOW.toISOString());
    }
  });

  it('fails with not_a_candidate when the record is not a candidate', () => {
    const record = makeConversationRecord({
      archive_status: 'active',
      reflection_status: 'reflected',
    });

    const gate = canApprove(record);
    expect(gate).toEqual({ ok: false, error: 'not_a_candidate' });

    const result = approve(record, NOW);
    expect(result).toEqual({ ok: false, error: 'not_a_candidate' });
  });

  it('setReflection downgrading an approved record to unreviewed revokes the approval', () => {
    const approved = makeConversationRecord({
      archive_status: 'approved',
      reflection_status: 'reflected',
      approved_at: new Date(2026, 6, 1, 0, 0, 0).toISOString(),
      reflection_completed_at: new Date(2026, 6, 1, 0, 0, 0).toISOString(),
    });

    const updated = setReflection(approved, { reflection_status: 'unreviewed' }, NOW);

    expect(updated.reflection_status).toBe('unreviewed');
    expect(updated.archive_status).toBe('candidate');
    expect(updated.approved_at).toBeNull();
    expect(updated.reflection_completed_at).toBeNull();
    expect(updated.updated_at).toBe(NOW.toISOString());

    // Original record is untouched.
    expect(approved.archive_status).toBe('approved');
    expect(approved.approved_at).not.toBeNull();
  });
});
