import {
  ARCHIVE_STATUSES,
  REFLECTION_STATUSES,
  type ScanResult,
  type ArchiveStatus,
  type ReflectionStatus,
} from './types.js';

/**
 * The side panel injects the sidebar reader and receives its return value.
 * There is no persistent message channel and no background router: the panel
 * asks once, on an explicit user action, and gets one answer back.
 *
 * Because the value crosses a script boundary it arrives as `unknown`, so it is
 * validated here rather than trusted.
 */

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isScanResult(value: unknown): value is ScanResult {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.conversations)) return false;
  if (!Array.isArray(value.unidentified)) return false;
  if (!isStringOrNull(value.active_conversation_id)) return false;
  if (typeof value.scanned_at !== 'string') return false;

  return value.conversations.every((entry) => {
    if (!isObject(entry)) return false;
    return (
      typeof entry.conversation_id === 'string' &&
      typeof entry.url === 'string' &&
      typeof entry.title === 'string' &&
      isStringOrNull(entry.project_id) &&
      isStringOrNull(entry.created_at) &&
      typeof entry.observed_at === 'string'
    );
  });
}

export function isReflectionStatus(value: string): value is ReflectionStatus {
  return (REFLECTION_STATUSES as readonly string[]).includes(value);
}

export function isArchiveStatus(value: string): value is ArchiveStatus {
  return (ARCHIVE_STATUSES as readonly string[]).includes(value);
}
