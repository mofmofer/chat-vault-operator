import { describe, expect, it } from 'vitest';
import {
  extractScanResult,
  type ExtractContext,
  type RawSidebarLink,
} from '../../extension/src/domain/sidebar-extract.js';
import { startOfLocalDayIso } from '../../extension/src/domain/conversation.js';

const NOW = new Date(2026, 7, 2, 9, 0, 0);
const UUID_A = '12345678-1234-4234-8234-123456789abc';
const UUID_B = 'abcdef01-abcd-4bcd-8bcd-abcdefabcdef';
const UUID_C = '11111111-2222-4222-8222-333333333333';

function ctx(overrides: Partial<ExtractContext> = {}): ExtractContext {
  return { now: NOW, currentUrl: null, ...overrides };
}

describe('extractScanResult', () => {
  it('turns raw links into observations, drops duplicates by id, and collects unidentified links', () => {
    const links: RawSidebarLink[] = [
      { href: `https://chatgpt.com/c/${UUID_A}`, title: 'First', bucket: null },
      // Duplicate: same conversation, appears again (e.g. pinned + in date group).
      { href: `https://chatgpt.com/c/${UUID_A}`, title: 'First (again)', bucket: 'Today' },
      { href: `https://chatgpt.com/c/${UUID_B}`, title: 'Second', bucket: null },
      // Unparseable: not a chatgpt.com conversation link.
      { href: 'https://chatgpt.com/settings', title: 'Settings', bucket: null },
    ];

    const result = extractScanResult(links, ctx());

    expect(result.conversations).toHaveLength(2);
    const ids = result.conversations.map((c) => c.conversation_id);
    expect(ids).toEqual([UUID_A.toLowerCase(), UUID_B.toLowerCase()]);
    // First occurrence wins.
    expect(result.conversations[0]?.title).toBe('First');

    expect(result.unidentified).toHaveLength(1);
    expect(result.unidentified[0]).toEqual({
      href: 'https://chatgpt.com/settings',
      title: 'Settings',
      reason: 'no_conversation_id',
    });
  });

  it('assigns created_at from a Today bucket, and null from a Previous 7 days bucket', () => {
    const links: RawSidebarLink[] = [
      { href: `https://chatgpt.com/c/${UUID_A}`, title: 'Today item', bucket: 'Today' },
      { href: `https://chatgpt.com/c/${UUID_B}`, title: 'Older item', bucket: 'Previous 7 days' },
    ];

    const result = extractScanResult(links, ctx());

    const todayItem = result.conversations.find((c) => c.conversation_id === UUID_A.toLowerCase());
    const olderItem = result.conversations.find((c) => c.conversation_id === UUID_B.toLowerCase());

    expect(todayItem?.created_at).toBe(startOfLocalDayIso(NOW));
    expect(olderItem?.created_at).toBeNull();
  });

  it('derives active_conversation_id from currentUrl', () => {
    const links: RawSidebarLink[] = [
      { href: `https://chatgpt.com/c/${UUID_A}`, title: 'First', bucket: null },
    ];

    const withCurrent = extractScanResult(links, ctx({ currentUrl: `https://chatgpt.com/c/${UUID_C}` }));
    expect(withCurrent.active_conversation_id).toBe(UUID_C.toLowerCase());

    const withoutCurrent = extractScanResult(links, ctx({ currentUrl: null }));
    expect(withoutCurrent.active_conversation_id).toBeNull();

    const withUnparseableCurrent = extractScanResult(links, ctx({ currentUrl: 'https://chatgpt.com/settings' }));
    expect(withUnparseableCurrent.active_conversation_id).toBeNull();
  });
});
