import { describe, expect, it } from 'vitest';
import {
  isProjectLandingUrl,
  parseConversationUrl,
} from '../../extension/src/domain/conversation-url.js';
import type { ConversationRecord } from '../../extension/src/shared/types.js';
import { makeConversationRecord } from '../helpers/factories.js';

const UUID_A = '12345678-1234-4234-8234-123456789abc';
const UUID_B = 'abcdef01-abcd-4bcd-8bcd-abcdefabcdef';
const PROJECT_HEX = '0123456789abcdef0123456789abcdef';

describe('parseConversationUrl - identity extraction', () => {
  it('extracts the id from a full chatgpt.com conversation URL', () => {
    const result = parseConversationUrl(`https://chatgpt.com/c/${UUID_A}`);
    expect(result).not.toBeNull();
    expect(result?.conversation_id).toBe(UUID_A.toLowerCase());
    expect(result?.project_id).toBeNull();
    expect(result?.url).toBe(`https://chatgpt.com/c/${UUID_A}`);
  });

  it('extracts the id from a root-relative /c/<uuid> link', () => {
    const result = parseConversationUrl(`/c/${UUID_A}`);
    expect(result).not.toBeNull();
    expect(result?.conversation_id).toBe(UUID_A.toLowerCase());
  });

  it('extracts the id from a legacy /chat/<uuid> link', () => {
    const result = parseConversationUrl(`/chat/${UUID_A}`);
    expect(result).not.toBeNull();
    expect(result?.conversation_id).toBe(UUID_A.toLowerCase());
  });

  it('extracts id and project_id from a project-scoped link, stripping the slug', () => {
    const href = `https://chatgpt.com/g/g-p-${PROJECT_HEX}-my-project-slug/c/${UUID_B}`;
    const result = parseConversationUrl(href);
    expect(result).not.toBeNull();
    expect(result?.conversation_id).toBe(UUID_B.toLowerCase());
    expect(result?.project_id).toBe(`g-p-${PROJECT_HEX}`.toLowerCase());
  });

  it('lowercases the project id', () => {
    const href = `https://chatgpt.com/g/G-P-${PROJECT_HEX.toUpperCase()}-slug/c/${UUID_B}`;
    const result = parseConversationUrl(href);
    expect(result?.project_id).toBe(`g-p-${PROJECT_HEX}`.toLowerCase());
  });
});

describe('parseConversationUrl - non-conversation and hostile URLs return null', () => {
  it('returns null for a project landing page (/g/<gizmo>/project)', () => {
    const href = `https://chatgpt.com/g/g-p-${PROJECT_HEX}/project`;
    expect(parseConversationUrl(href)).toBeNull();
    // Confirm this really is the landing-page shape, per the dedicated helper.
    expect(isProjectLandingUrl(href)).toBe(true);
  });

  it('returns null for a link on a different origin', () => {
    expect(parseConversationUrl(`https://evil.com/c/${UUID_A}`)).toBeNull();
  });

  it('returns null for http (not https)', () => {
    expect(parseConversationUrl(`http://chatgpt.com/c/${UUID_A}`)).toBeNull();
  });

  it('returns null when the id segment is not a UUID', () => {
    expect(parseConversationUrl('/c/not-a-uuid')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseConversationUrl('')).toBeNull();
  });

  it('returns null when there are extra path segments after the id', () => {
    expect(parseConversationUrl(`/c/${UUID_A}/extra`)).toBeNull();
  });
});

describe('identity vs title', () => {
  it('keeps two conversations with an identical title distinct by id', () => {
    const a: ConversationRecord = makeConversationRecord({
      conversation_id: UUID_A.toLowerCase(),
      url: `https://chatgpt.com/c/${UUID_A.toLowerCase()}`,
      title: 'Duplicate Title',
    });
    const b: ConversationRecord = makeConversationRecord({
      conversation_id: UUID_B.toLowerCase(),
      url: `https://chatgpt.com/c/${UUID_B.toLowerCase()}`,
      title: 'Duplicate Title',
    });

    const map: Record<string, ConversationRecord> = {};
    map[a.conversation_id] = a;
    map[b.conversation_id] = b;

    expect(Object.keys(map)).toHaveLength(2);
    expect(map[a.conversation_id]?.title).toBe('Duplicate Title');
    expect(map[b.conversation_id]?.title).toBe('Duplicate Title');
    expect(map[a.conversation_id]?.conversation_id).not.toBe(map[b.conversation_id]?.conversation_id);

    const list = [a, b];
    expect(list).toHaveLength(2);
    expect(new Set(list.map((r) => r.conversation_id)).size).toBe(2);
  });
});
