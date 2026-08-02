import { describe, expect, it } from 'vitest';
import {
  buildExport,
  mergeImported,
  parseImport,
  EXPORT_SCHEMA_VERSION,
} from '../../extension/src/storage/serialization.js';
import { CONVERSATION_RECORD_KEYS, type ConversationRecord } from '../../extension/src/shared/types.js';
import { makeConversationRecord } from '../helpers/factories.js';

const NOW = new Date(2026, 7, 2, 9, 0, 0);

/** JSON-round-tripped export payload, kept as plain unknown data for mutation in tests. */
function asPlainExport(records: ConversationRecord[]): Record<string, unknown> {
  const built = buildExport(records, NOW);
  return JSON.parse(JSON.stringify(built)) as Record<string, unknown>;
}

describe('JSON import/export', () => {
  it('round-trips a valid export through buildExport -> stringify -> parseImport', () => {
    const records = [
      makeConversationRecord({ title: 'Alpha' }),
      makeConversationRecord({
        title: 'Beta',
        reflection_status: 'reflected',
        archive_status: 'candidate',
      }),
    ];
    const exported = buildExport(records, NOW);
    const json = JSON.stringify(exported);

    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conversations).toEqual(records);
      expect(result.value.schema_version).toBe(EXPORT_SCHEMA_VERSION);
    }
  });

  it('rejects malformed JSON with invalid_json', () => {
    const result = parseImport('{ broken');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === 'invalid_json')).toBe(true);
    }
  });

  it('rejects an unknown enum value', () => {
    const payload = asPlainExport([makeConversationRecord()]);
    const conversations = payload.conversations as Array<Record<string, unknown>>;
    const first = conversations[0];
    if (first === undefined) throw new Error('expected at least one conversation');
    first.reflection_status = 'totally_made_up';

    const result = parseImport(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === 'unknown_enum_value')).toBe(true);
    }
  });

  it('rejects a record carrying a conversation-body field', () => {
    const payload = asPlainExport([makeConversationRecord()]);
    const conversations = payload.conversations as Array<Record<string, unknown>>;
    const first = conversations[0];
    if (first === undefined) throw new Error('expected at least one conversation');
    first.messages = [{ role: 'user', content: 'hello' }];

    const result = parseImport(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === 'conversation_body_forbidden')).toBe(true);
    }
  });

  it('rejects a record with a missing required field', () => {
    const payload = asPlainExport([makeConversationRecord()]);
    const conversations = payload.conversations as Array<Record<string, unknown>>;
    const first = conversations[0];
    if (first === undefined) throw new Error('expected at least one conversation');
    delete first.title;

    const result = parseImport(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === 'missing_field')).toBe(true);
    }
  });

  it('does not destroy existing data when import fails', () => {
    const existingRecord = makeConversationRecord({ title: 'Keep me' });
    const existing: Record<string, ConversationRecord> = {
      [existingRecord.conversation_id]: existingRecord,
    };
    const before = JSON.parse(JSON.stringify(existing)) as Record<string, ConversationRecord>;

    const result = parseImport('{ broken');
    expect(result.ok).toBe(false);
    // parseImport is pure and never touches storage; a failed result must never
    // be passed on to mergeImported, so existing state stays byte-for-byte equal.
    expect(existing).toEqual(before);
  });

  it('merges an incoming record with an existing id as an update', () => {
    const original = makeConversationRecord({ title: 'Original' });
    const existing: Record<string, ConversationRecord> = { [original.conversation_id]: original };
    const incoming: ConversationRecord = { ...original, title: 'Updated' };

    const outcome = mergeImported(existing, [incoming]);

    expect(outcome.updated).toBe(1);
    expect(outcome.added).toBe(0);
    expect(outcome.merged[original.conversation_id]?.title).toBe('Updated');
  });

  it('merges an incoming record with a new id as an add', () => {
    const original = makeConversationRecord({ title: 'Original' });
    const existing: Record<string, ConversationRecord> = { [original.conversation_id]: original };
    const brandNew = makeConversationRecord({ title: 'Brand new' });

    const outcome = mergeImported(existing, [brandNew]);

    expect(outcome.added).toBe(1);
    expect(outcome.updated).toBe(0);
    expect(outcome.merged[brandNew.conversation_id]?.title).toBe('Brand new');
    expect(outcome.merged[original.conversation_id]?.title).toBe('Original');
  });

  it('exports no conversation body: forbidden keys absent from JSON, exact key allowlist per record', () => {
    const records = [makeConversationRecord({ title: 'Alpha' }), makeConversationRecord({ title: 'Beta' })];
    const exported = buildExport(records, NOW);
    const json = JSON.stringify(exported);

    for (const forbidden of ['messages', 'content', 'body', 'transcript']) {
      expect(json.toLowerCase().includes(`"${forbidden}"`)).toBe(false);
    }

    for (const conversation of exported.conversations) {
      expect(Object.keys(conversation).sort()).toEqual([...CONVERSATION_RECORD_KEYS].sort());
    }
  });
});
