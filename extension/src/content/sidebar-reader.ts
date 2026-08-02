import { extractScanResult, type RawSidebarLink } from '../domain/sidebar-extract.js';

/**
 * Read-only reader for the ChatGPT sidebar.
 *
 * Injected on demand by the side panel via `chrome.scripting.executeScript`, so
 * nothing runs on chatgpt.com unless the operator presses Scan. It is not
 * registered as a declarative content script for exactly that reason.
 *
 * Hard rules for this file:
 *   - It never mutates the page: no clicks, no scrolling, no DOM writes.
 *     (The upstream project force-scrolled the sidebar to trigger lazy loading;
 *     we deliberately do not, and only read what is already on screen.)
 *   - It never reads conversation content. The only text taken from the page is
 *     the sidebar link label, which is ChatGPT's own short title.
 *   - It makes no network requests of any kind.
 *
 * The script's completion value is the ScanResult, which `executeScript`
 * returns to the caller in `results[0].result`.
 */

const DATE_BUCKET_PREFIXES = ['today', 'yesterday', 'previous 7 days', 'previous 30 days'];

/** How far up the tree to look for the date heading that governs a link. */
const BUCKET_ANCESTOR_DEPTH = 12;
const BUCKET_SIBLING_SCAN = 6;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function matchesBucket(text: string): boolean {
  const lowered = text.toLowerCase();
  return DATE_BUCKET_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

/**
 * Finds the date heading a link sits under.
 *
 * ChatGPT renders these as plain headings that precede a group of links rather
 * than as a container, so the only way to associate one is to walk up and look
 * back. Bounded on both axes so a markup change cannot turn this into a full
 * document scan.
 */
function findDateBucket(anchor: Element): string | null {
  let current: Element | null = anchor;

  for (let depth = 0; depth < BUCKET_ANCESTOR_DEPTH && current !== null; depth += 1) {
    const parent: Element | null = current.parentElement;
    if (parent === null) break;

    let sibling: Element | null = parent.previousElementSibling;
    for (let i = 0; i < BUCKET_SIBLING_SCAN && sibling !== null; i += 1) {
      const text = normalizeText(sibling.textContent);
      // Headings are short; a long match means we grabbed a content block.
      if (text.length > 0 && text.length <= 40 && matchesBucket(text)) return text;
      sibling = sibling.previousElementSibling;
    }

    current = parent;
  }

  return null;
}

function collectSidebarLinks(): RawSidebarLink[] {
  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    'a[href^="/c/"], a[href^="/chat/"], a[href*="/c/"]',
  );

  const links: RawSidebarLink[] = [];

  for (const anchor of Array.from(anchors)) {
    // Skip anything not actually rendered, such as collapsed or virtualized rows.
    if (anchor.offsetParent === null) continue;

    const href = anchor.getAttribute('href');
    if (href === null) continue;

    // Only text belonging to the anchor itself is read. Identity comes from the
    // href; the title is display-only and is never used to match conversations.
    const title =
      normalizeText(anchor.textContent) || normalizeText(anchor.getAttribute('aria-label'));

    links.push({ href, title, bucket: findDateBucket(anchor) });
  }

  return links;
}

// The value of this expression becomes the injection result.
(() =>
  extractScanResult(collectSidebarLinks(), {
    now: new Date(),
    currentUrl: window.location.href,
  }))();
