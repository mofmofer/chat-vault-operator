import { describe, expect, it } from 'vitest';
import {
  evaluateExclusions,
  isDefaultEligibleCandidate,
  type CandidateContext,
} from '../../extension/src/domain/candidates.js';
import { makeConversationRecord } from '../helpers/factories.js';

const NOW = new Date(2026, 7, 2, 9, 0, 0);

function baseCtx(overrides: Partial<CandidateContext> = {}): CandidateContext {
  return { now: NOW, activeConversationId: null, ...overrides };
}

describe('default candidate exclusions', () => {
  it('excludes the currently open conversation', () => {
    const record = makeConversationRecord();
    const ctx = baseCtx({ activeConversationId: record.conversation_id });

    const reasons = evaluateExclusions(record, ctx);
    expect(reasons).toContain('currently_open');
    expect(isDefaultEligibleCandidate(record, ctx)).toBe(false);
  });

  it('excludes a conversation started today', () => {
    const record = makeConversationRecord({
      created_at: new Date(2026, 7, 2, 3, 0, 0).toISOString(),
    });
    const ctx = baseCtx();

    const reasons = evaluateExclusions(record, ctx);
    expect(reasons).toContain('started_today');
    expect(isDefaultEligibleCandidate(record, ctx)).toBe(false);
  });

  it('does not exclude for started_today when created_at is several days ago', () => {
    const record = makeConversationRecord({
      created_at: new Date(2026, 6, 28, 3, 0, 0).toISOString(),
    });
    const ctx = baseCtx();

    const reasons = evaluateExclusions(record, ctx);
    expect(reasons).not.toContain('started_today');
  });

  it('excludes a Project conversation', () => {
    const record = makeConversationRecord({ project_id: 'g-p-0123456789abcdef0123456789abcdef' });
    const ctx = baseCtx();

    const reasons = evaluateExclusions(record, ctx);
    expect(reasons).toContain('in_project');
    expect(isDefaultEligibleCandidate(record, ctx)).toBe(false);
  });

  it('excludes a record whose url does not match its conversation_id', () => {
    const record = makeConversationRecord();
    const mismatched = { ...record, url: 'https://chatgpt.com/c/ffffffff-ffff-4fff-8fff-ffffffffffff' };
    const ctx = baseCtx();

    const reasons = evaluateExclusions(mismatched, ctx);
    expect(reasons).toContain('unidentifiable');
    expect(isDefaultEligibleCandidate(mismatched, ctx)).toBe(false);
  });

  it('a clean record with none of the above is default-eligible', () => {
    const record = makeConversationRecord({
      created_at: new Date(2026, 6, 28, 3, 0, 0).toISOString(),
      project_id: null,
    });
    const ctx = baseCtx();

    expect(evaluateExclusions(record, ctx)).toEqual([]);
    expect(isDefaultEligibleCandidate(record, ctx)).toBe(true);
  });
});
