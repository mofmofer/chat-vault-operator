import {
  ARCHIVE_STATUSES,
  CONVERSATION_RECORD_KEYS,
  REFLECTION_STATUSES,
  type ArchiveStatus,
  type ConversationRecord,
  type ReflectionStatus,
} from '../shared/types.js';
import { err, ok, type Result } from '../shared/result.js';
import { parseConversationUrl } from '../domain/conversation-url.js';

export const EXPORT_SCHEMA_VERSION = 1;

export interface VaultExport {
  schema_version: number;
  exported_at: string;
  conversation_count: number;
  conversations: ConversationRecord[];
}

export interface ImportIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Keys that would indicate conversation body text leaked into the file. They are
 * called out explicitly so a rejected import gives an actionable error instead
 * of a generic "unknown field".
 */
const FORBIDDEN_KEYS = new Set([
  'body',
  'content',
  'message',
  'messages',
  'text',
  'transcript',
  'parts',
  'prompt',
  'completion',
]);

const ALLOWED_KEYS = new Set<string>(CONVERSATION_RECORD_KEYS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Rebuilds a record field-by-field from the declared shape.
 *
 * Written out explicitly rather than spread so that a stray property which
 * somehow reached storage cannot escape to disk, and so the compiler fails if a
 * field is ever added to the model without a matching export decision.
 */
function toExportRecord(record: ConversationRecord): ConversationRecord {
  return {
    conversation_id: record.conversation_id,
    url: record.url,
    title: record.title,
    created_at: record.created_at,
    updated_at: record.updated_at,
    project_id: record.project_id,
    reflection_status: record.reflection_status,
    reflection_reference: record.reflection_reference,
    reflection_summary: record.reflection_summary,
    reflection_completed_at: record.reflection_completed_at,
    archive_status: record.archive_status,
    approved_at: record.approved_at,
    archived_at: record.archived_at,
    last_observed_at: record.last_observed_at,
    operation_attempts: record.operation_attempts,
    error_code: record.error_code,
    error_message: record.error_message,
  };
}

/** Builds the export payload. Contains metadata only — never conversation text. */
export function buildExport(records: ConversationRecord[], now: Date): VaultExport {
  const conversations = records.map(toExportRecord);

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: now.toISOString(),
    conversation_count: conversations.length,
    conversations,
  };
}

function validateRecord(
  raw: unknown,
  index: number,
  issues: ImportIssue[],
): ConversationRecord | null {
  const path = `conversations[${index}]`;

  if (!isPlainObject(raw)) {
    issues.push({ path, code: 'not_an_object', message: 'Entry is not an object.' });
    return null;
  }

  let failed = false;
  const fail = (code: string, message: string, field?: string): void => {
    issues.push({ path: field ? `${path}.${field}` : path, code, message });
    failed = true;
  };

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      fail(
        'conversation_body_forbidden',
        'Field looks like conversation content, which this extension never stores.',
        key,
      );
      continue;
    }
    if (!ALLOWED_KEYS.has(key)) {
      fail('unknown_field', 'Field is not part of the schema.', key);
    }
  }

  for (const key of CONVERSATION_RECORD_KEYS) {
    if (!(key in raw)) fail('missing_field', 'Required field is missing.', key);
  }

  if (failed) return null;

  const {
    conversation_id,
    url,
    title,
    created_at,
    updated_at,
    project_id,
    reflection_status,
    reflection_reference,
    reflection_summary,
    reflection_completed_at,
    archive_status,
    approved_at,
    archived_at,
    last_observed_at,
    operation_attempts,
    error_code,
    error_message,
  } = raw;

  if (typeof conversation_id !== 'string' || conversation_id.trim() === '') {
    fail('invalid_type', 'conversation_id must be a non-empty string.', 'conversation_id');
  }
  if (typeof url !== 'string') fail('invalid_type', 'url must be a string.', 'url');
  if (typeof title !== 'string') fail('invalid_type', 'title must be a string.', 'title');
  if (!isIsoOrNull(created_at)) fail('invalid_type', 'created_at must be ISO-8601 or null.', 'created_at');
  if (!isIsoOrNull(updated_at)) fail('invalid_type', 'updated_at must be ISO-8601 or null.', 'updated_at');
  if (!isIsoOrNull(reflection_completed_at)) {
    fail('invalid_type', 'reflection_completed_at must be ISO-8601 or null.', 'reflection_completed_at');
  }
  if (!isIsoOrNull(approved_at)) fail('invalid_type', 'approved_at must be ISO-8601 or null.', 'approved_at');
  if (!isIsoOrNull(archived_at)) fail('invalid_type', 'archived_at must be ISO-8601 or null.', 'archived_at');
  if (!isIsoOrNull(last_observed_at)) {
    fail('invalid_type', 'last_observed_at must be ISO-8601 or null.', 'last_observed_at');
  }
  if (!isStringOrNull(project_id)) fail('invalid_type', 'project_id must be a string or null.', 'project_id');
  if (!isStringOrNull(reflection_reference)) {
    fail('invalid_type', 'reflection_reference must be a string or null.', 'reflection_reference');
  }
  if (!isStringOrNull(reflection_summary)) {
    fail('invalid_type', 'reflection_summary must be a string or null.', 'reflection_summary');
  }
  if (!isStringOrNull(error_code)) fail('invalid_type', 'error_code must be a string or null.', 'error_code');
  if (!isStringOrNull(error_message)) {
    fail('invalid_type', 'error_message must be a string or null.', 'error_message');
  }

  if (!REFLECTION_STATUSES.includes(reflection_status as ReflectionStatus)) {
    fail('unknown_enum_value', `reflection_status must be one of: ${REFLECTION_STATUSES.join(', ')}.`, 'reflection_status');
  }
  if (!ARCHIVE_STATUSES.includes(archive_status as ArchiveStatus)) {
    fail('unknown_enum_value', `archive_status must be one of: ${ARCHIVE_STATUSES.join(', ')}.`, 'archive_status');
  }

  if (
    typeof operation_attempts !== 'number' ||
    !Number.isInteger(operation_attempts) ||
    operation_attempts < 0
  ) {
    fail('invalid_type', 'operation_attempts must be a non-negative integer.', 'operation_attempts');
  }

  if (failed) return null;

  // Identity must be self-consistent: the URL has to point at the same
  // conversation the id claims, otherwise the record cannot be trusted.
  const parsed = parseConversationUrl(url as string);
  if (parsed === null) {
    fail('invalid_url', 'url is not a recognizable chatgpt.com conversation URL.', 'url');
  } else if (parsed.conversation_id !== conversation_id) {
    fail('id_url_mismatch', 'url does not match conversation_id.', 'url');
  }

  if (failed) return null;

  return {
    conversation_id: conversation_id as string,
    url: url as string,
    title: title as string,
    created_at: created_at as string | null,
    updated_at: updated_at as string | null,
    project_id: project_id as string | null,
    reflection_status: reflection_status as ReflectionStatus,
    reflection_reference: reflection_reference as string | null,
    reflection_summary: reflection_summary as string | null,
    reflection_completed_at: reflection_completed_at as string | null,
    archive_status: archive_status as ArchiveStatus,
    approved_at: approved_at as string | null,
    archived_at: archived_at as string | null,
    last_observed_at: last_observed_at as string | null,
    operation_attempts: operation_attempts as number,
    error_code: error_code as string | null,
    error_message: error_message as string | null,
  };
}

/**
 * Parses and fully validates an import payload.
 *
 * Pure: it never touches storage. Callers must treat a failed result as
 * "change nothing", which is what keeps a bad file from destroying local state.
 */
export function parseImport(rawText: string): Result<VaultExport, ImportIssue[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return err([
      {
        path: '$',
        code: 'invalid_json',
        message: `File is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
    ]);
  }

  const issues: ImportIssue[] = [];

  if (!isPlainObject(parsed)) {
    return err([{ path: '$', code: 'not_an_object', message: 'Top level must be an object.' }]);
  }

  if (parsed.schema_version !== EXPORT_SCHEMA_VERSION) {
    issues.push({
      path: '$.schema_version',
      code: 'unsupported_schema_version',
      message: `Expected schema_version ${EXPORT_SCHEMA_VERSION}, received ${JSON.stringify(parsed.schema_version)}.`,
    });
  }

  if (!Array.isArray(parsed.conversations)) {
    issues.push({
      path: '$.conversations',
      code: 'invalid_type',
      message: 'conversations must be an array.',
    });
    return err(issues);
  }

  const records: ConversationRecord[] = [];
  const seen = new Set<string>();

  parsed.conversations.forEach((entry, index) => {
    const record = validateRecord(entry, index, issues);
    if (record === null) return;
    if (seen.has(record.conversation_id)) {
      issues.push({
        path: `conversations[${index}].conversation_id`,
        code: 'duplicate_conversation_id',
        message: `Duplicate conversation_id ${record.conversation_id} in the same file.`,
      });
      return;
    }
    seen.add(record.conversation_id);
    records.push(record);
  });

  if (issues.length > 0) return err(issues);

  return ok({
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: typeof parsed.exported_at === 'string' ? parsed.exported_at : '',
    conversation_count: records.length,
    conversations: records,
  });
}

export interface MergeOutcome {
  merged: Record<string, ConversationRecord>;
  added: number;
  updated: number;
}

/**
 * Merges validated records into existing state, keyed by conversation_id.
 *
 * The imported record wins for operator-authored fields (that is the point of
 * importing), but monotonic bookkeeping fields keep their highest known value so
 * restoring an older backup cannot rewind them.
 */
export function mergeImported(
  existing: Record<string, ConversationRecord>,
  incoming: ConversationRecord[],
): MergeOutcome {
  const merged: Record<string, ConversationRecord> = { ...existing };
  let added = 0;
  let updated = 0;

  for (const record of incoming) {
    const prior = merged[record.conversation_id];
    if (prior === undefined) {
      merged[record.conversation_id] = record;
      added += 1;
      continue;
    }

    const laterIso = (a: string | null, b: string | null): string | null => {
      if (a === null) return b;
      if (b === null) return a;
      return Date.parse(a) >= Date.parse(b) ? a : b;
    };

    merged[record.conversation_id] = {
      ...record,
      last_observed_at: laterIso(prior.last_observed_at, record.last_observed_at),
      operation_attempts: Math.max(prior.operation_attempts, record.operation_attempts),
    };
    updated += 1;
  }

  return { merged, added, updated };
}
