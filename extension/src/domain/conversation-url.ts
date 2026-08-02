/**
 * Pure parsing of ChatGPT conversation links.
 *
 * The only supported identity source is the `href` of a sidebar link. Titles are
 * never used to identify a conversation: ChatGPT allows duplicate titles, and
 * two distinct conversations frequently share one.
 *
 * Known URL shapes:
 *   https://chatgpt.com/c/<uuid>
 *   https://chatgpt.com/chat/<uuid>                     (legacy)
 *   https://chatgpt.com/g/g-p-<32hex>-<slug>/c/<uuid>   (project conversation)
 *
 * Anything that does not yield a canonical UUID is treated as unidentifiable and
 * is excluded from archive candidacy rather than guessed at.
 */

export const CHATGPT_ORIGIN = 'https://chatgpt.com';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical project id is `g-p-` followed by exactly 32 hex characters. */
const PROJECT_RE = /^(g-p-[0-9a-f]{32})/i;

export interface ParsedConversationUrl {
  conversation_id: string;
  /** Normalized absolute URL, without query string or fragment. */
  url: string;
  project_id: string | null;
}

function normalizeSegments(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0);
}

/**
 * Extracts the canonical project id from a `/g/<gizmo>` path segment.
 * The sidebar href often carries a human slug suffix (`g-p-<hex>-dailyemails`);
 * only the `g-p-<32hex>` prefix is stable, so that is what we key on.
 */
export function parseProjectId(gizmoSegment: string): string | null {
  const match = PROJECT_RE.exec(gizmoSegment);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/**
 * Parses a conversation link. Returns null when no unique conversation id can be
 * derived, or when the link points somewhere other than chatgpt.com.
 *
 * @param href  Absolute or root-relative link taken from the sidebar DOM.
 */
export function parseConversationUrl(href: string): ParsedConversationUrl | null {
  if (typeof href !== 'string' || href.trim().length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(href, CHATGPT_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'chatgpt.com') return null;

  const segments = normalizeSegments(parsed.pathname);

  let project_id: string | null = null;
  let rest = segments;

  if (segments[0] === 'g' && segments[1] !== undefined) {
    project_id = parseProjectId(segments[1]);
    // A `/g/...` link whose gizmo id is not canonical cannot be attributed to a
    // project reliably; treat the whole link as unidentifiable.
    if (project_id === null) return null;
    rest = segments.slice(2);
  }

  const [kind, id] = rest;
  if (kind !== 'c' && kind !== 'chat') return null;
  if (id === undefined || !UUID_RE.test(id)) return null;
  // Reject anything deeper than the conversation itself.
  if (rest.length > 2) return null;

  const conversation_id = id.toLowerCase();

  return {
    conversation_id,
    url: `${CHATGPT_ORIGIN}${parsed.pathname}`,
    project_id,
  };
}

/** True when the link is a project *landing page* (`/g/<gizmo>/project`). */
export function isProjectLandingUrl(href: string): boolean {
  try {
    const parsed = new URL(href, CHATGPT_ORIGIN);
    if (parsed.hostname !== 'chatgpt.com') return false;
    const segments = normalizeSegments(parsed.pathname);
    return segments[0] === 'g' && segments[2] === 'project' && segments.length === 3;
  } catch {
    return false;
  }
}
