import type { OperationLogEntry, OperationLogType } from '../shared/types.js';

/**
 * Local, append-only-ish audit trail of what the operator did in the side panel.
 *
 * Entries are capped so the log cannot grow without bound in
 * `chrome.storage.local`. `detail` is written by callers and must stay
 * metadata-only — never conversation text.
 */
export const OPERATION_LOG_LIMIT = 500;

export interface NewLogEntry {
  type: OperationLogType;
  conversation_id?: string | null;
  detail: string;
}

let counter = 0;

function nextId(at: Date): string {
  counter = (counter + 1) % 1_000_000;
  return `${at.getTime().toString(36)}-${counter.toString(36)}`;
}

export function createLogEntry(entry: NewLogEntry, at: Date): OperationLogEntry {
  return {
    id: nextId(at),
    at: at.toISOString(),
    type: entry.type,
    conversation_id: entry.conversation_id ?? null,
    detail: entry.detail,
  };
}

/** Newest first, oldest dropped past the cap. */
export function appendLog(
  existing: OperationLogEntry[],
  entry: NewLogEntry,
  at: Date,
  limit: number = OPERATION_LOG_LIMIT,
): OperationLogEntry[] {
  return [createLogEntry(entry, at), ...existing].slice(0, limit);
}
