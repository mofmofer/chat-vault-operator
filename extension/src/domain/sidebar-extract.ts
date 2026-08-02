import type { ObservedConversation, ScanResult, UnidentifiedLink } from '../shared/types.js';
import { parseConversationUrl } from './conversation-url.js';
import { startOfLocalDayIso } from './conversation.js';

/**
 * Pure translation from "what the sidebar showed" to domain observations.
 *
 * The DOM layer hands over plain data; every identity and date decision happens
 * here so it can be tested without a browser. This is the seam that keeps
 * ChatGPT's markup churn out of the domain rules.
 */

export interface RawSidebarLink {
  /** `href` attribute exactly as it appeared in the DOM. */
  href: string;
  /** Visible link label. Used for display only, never for identity. */
  title: string;
  /** Nearest preceding date heading ("Today", "Previous 7 days", ...). */
  bucket: string | null;
}

/**
 * Only the two exact buckets map to a real date. Vaguer buckets ("Previous 7
 * days") deliberately produce null rather than a guessed timestamp — a wrong
 * date here would feed the "started today" safety rule.
 *
 * Note that ChatGPT groups by recent activity, not creation. Treating "Today"
 * as today's date is the conservative reading: it can only cause a conversation
 * to be held back from candidacy, never pushed into it.
 */
export function createdAtFromBucket(bucket: string | null, now: Date): string | null {
  if (bucket === null) return null;
  const normalized = bucket.trim().toLowerCase();

  if (normalized.startsWith('today')) return startOfLocalDayIso(now);
  if (normalized.startsWith('yesterday')) {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return startOfLocalDayIso(yesterday);
  }
  return null;
}

export interface ExtractContext {
  now: Date;
  /** `location.href` of the scanned tab, used to find the open conversation. */
  currentUrl: string | null;
}

export function extractScanResult(links: RawSidebarLink[], ctx: ExtractContext): ScanResult {
  const conversations: ObservedConversation[] = [];
  const unidentified: UnidentifiedLink[] = [];
  const seen = new Set<string>();
  const observedAt = ctx.now.toISOString();

  for (const link of links) {
    const parsed = parseConversationUrl(link.href);

    if (parsed === null) {
      unidentified.push({
        href: link.href,
        title: link.title,
        reason: 'no_conversation_id',
      });
      continue;
    }

    // First occurrence wins; the sidebar can render the same conversation twice
    // (for example pinned plus in its date group).
    if (seen.has(parsed.conversation_id)) continue;
    seen.add(parsed.conversation_id);

    conversations.push({
      conversation_id: parsed.conversation_id,
      url: parsed.url,
      title: link.title,
      project_id: parsed.project_id,
      date_bucket: link.bucket,
      created_at: createdAtFromBucket(link.bucket, ctx.now),
      observed_at: observedAt,
    });
  }

  const current = ctx.currentUrl === null ? null : parseConversationUrl(ctx.currentUrl);

  return {
    conversations,
    unidentified,
    active_conversation_id: current?.conversation_id ?? null,
    scanned_at: observedAt,
  };
}
