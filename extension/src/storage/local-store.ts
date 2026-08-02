import type { ConversationRecord, OperationLogEntry } from '../shared/types.js';

/**
 * The only persistence layer in this extension is `chrome.storage.local`.
 * Nothing is sent anywhere; there is no sync storage, no server, no cache.
 */

export const STORAGE_KEYS = {
  conversations: 'cvo.conversations',
  operationLog: 'cvo.operation_log',
} as const;

export type ConversationMap = Record<string, ConversationRecord>;

/** Minimal slice of `chrome.storage.local`, so tests can supply a fake. */
export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function chromeLocalArea(): StorageArea {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
  };
}

export class LocalStore {
  constructor(private readonly area: StorageArea) {}

  async readConversations(): Promise<ConversationMap> {
    const raw = await this.area.get([STORAGE_KEYS.conversations]);
    const value = raw[STORAGE_KEYS.conversations];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return value as ConversationMap;
  }

  async writeConversations(map: ConversationMap): Promise<void> {
    await this.area.set({ [STORAGE_KEYS.conversations]: map });
  }

  async readLog(): Promise<OperationLogEntry[]> {
    const raw = await this.area.get([STORAGE_KEYS.operationLog]);
    const value = raw[STORAGE_KEYS.operationLog];
    return Array.isArray(value) ? (value as OperationLogEntry[]) : [];
  }

  async writeLog(entries: OperationLogEntry[]): Promise<void> {
    await this.area.set({ [STORAGE_KEYS.operationLog]: entries });
  }
}
