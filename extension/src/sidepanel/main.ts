import {
  approve,
  markCandidate,
  revokeApproval,
  setReflection,
  unmarkCandidate,
  type ApprovalRejection,
} from '../domain/approval.js';
import {
  EXCLUSION_REASON_LABELS,
  evaluateExclusions,
  isDefaultEligibleCandidate,
  type CandidateContext,
} from '../domain/candidates.js';
import { applyObservation, createRecordFromObservation } from '../domain/conversation.js';
import { DRY_RUN_SKIP_LABELS, buildDryRunPlan, type DryRunRow } from '../domain/dry-run.js';
import { isArchiveStatus, isReflectionStatus, isScanResult } from '../shared/messages.js';
import type {
  ArchiveStatus,
  ConversationRecord,
  OperationLogEntry,
  ReflectionStatus,
  ScanResult,
} from '../shared/types.js';
import {
  LocalStore,
  chromeLocalArea,
  type ConversationMap,
} from '../storage/local-store.js';
import { appendLog } from '../storage/operation-log.js';
import { buildExport, mergeImported, parseImport } from '../storage/serialization.js';

/**
 * Side panel controller.
 *
 * All DOM is built with createElement/textContent — never innerHTML — so a
 * conversation title coming off the page can never be interpreted as markup.
 * There is no network code here by design; the extension CSP also sets
 * `connect-src 'none'`, so an accidental request would be blocked outright.
 */

const CONTENT_SCRIPT = 'content/sidebar-reader.js';
const CHATGPT_TAB_QUERY = 'https://chatgpt.com/*';

const store = new LocalStore(chromeLocalArea());

interface UiState {
  records: ConversationMap;
  log: OperationLogEntry[];
  /** Learned from the last scan; drives the `currently_open` exclusion. */
  activeConversationId: string | null;
  selection: Set<string>;
  filterText: string;
  filterReflection: ReflectionStatus | 'all';
  filterArchive: ArchiveStatus | 'all';
}

const state: UiState = {
  records: {},
  log: [],
  activeConversationId: null,
  selection: new Set(),
  filterText: '',
  filterReflection: 'all',
  filterArchive: 'all',
};

// ---------------------------------------------------------------- DOM helpers

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(message: string, kind: 'ok' | 'error' | 'plain' = 'plain'): void {
  const node = byId('status');
  node.textContent = message;
  node.className = kind === 'plain' ? 'status' : `status ${kind}`;
}

function showIssues(lines: string[]): void {
  const list = byId<HTMLUListElement>('issues');
  list.replaceChildren();
  if (lines.length === 0) {
    list.hidden = true;
    return;
  }
  for (const line of lines) list.appendChild(el('li', undefined, line));
  list.hidden = false;
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

// ------------------------------------------------------------------ persist

function candidateContext(): CandidateContext {
  return { now: new Date(), activeConversationId: state.activeConversationId };
}

async function persistRecords(): Promise<void> {
  await store.writeConversations(state.records);
}

async function addLog(
  type: OperationLogEntry['type'],
  detail: string,
  conversationId: string | null = null,
): Promise<void> {
  state.log = appendLog(state.log, { type, conversation_id: conversationId, detail }, new Date());
  await store.writeLog(state.log);
}

// --------------------------------------------------------------------- scan

async function findChatGptTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: CHATGPT_TAB_QUERY });
  const active = tabs.find((tab) => tab.active);
  const chosen = active ?? tabs[0];
  return chosen?.id ?? null;
}

async function runScan(): Promise<void> {
  setStatus('スキャン中…');
  showIssues([]);

  const tabId = await findChatGptTabId();
  if (tabId === null) {
    setStatus('chatgpt.com のタブが見つかりません。ChatGPT を開いてから再実行してください。', 'error');
    return;
  }

  let scan: ScanResult;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT],
    });
    const raw: unknown = results[0]?.result;
    if (!isScanResult(raw)) {
      setStatus('スキャン結果を解釈できませんでした。ChatGPT のページを再読み込みしてください。', 'error');
      return;
    }
    scan = raw;
  } catch (e) {
    setStatus(`スキャンに失敗しました: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return;
  }

  state.activeConversationId = scan.active_conversation_id;

  let added = 0;
  let updated = 0;
  for (const observed of scan.conversations) {
    const existing = state.records[observed.conversation_id];
    if (existing === undefined) {
      state.records[observed.conversation_id] = createRecordFromObservation(observed);
      added += 1;
    } else {
      state.records[observed.conversation_id] = applyObservation(existing, observed);
      updated += 1;
    }
  }

  await persistRecords();

  const skipped = scan.unidentified.length;
  const detail = `observed=${scan.conversations.length} new=${added} updated=${updated} unidentified=${skipped}`;
  await addLog('scan', detail);

  byId('scan-summary').textContent = `新規 ${added} / 更新 ${updated} / 識別不能 ${skipped}`;
  setStatus(
    skipped > 0
      ? `スキャン完了。${skipped} 件のリンクは会話IDを一意に取得できなかったため取り込んでいません。`
      : 'スキャン完了。',
    'ok',
  );

  render();
}

// ------------------------------------------------------------------ filters

function visibleRecords(): ConversationRecord[] {
  const needle = state.filterText.trim().toLowerCase();

  return Object.values(state.records)
    .filter((record) => {
      if (needle !== '' && !record.title.toLowerCase().includes(needle)) return false;
      if (state.filterReflection !== 'all' && record.reflection_status !== state.filterReflection) {
        return false;
      }
      if (state.filterArchive !== 'all' && record.archive_status !== state.filterArchive) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function selectedRecords(): ConversationRecord[] {
  const out: ConversationRecord[] = [];
  for (const id of state.selection) {
    const record = state.records[id];
    if (record !== undefined) out.push(record);
  }
  return out;
}

// ------------------------------------------------------------------- render

function renderRow(record: ConversationRecord, ctx: CandidateContext): HTMLLIElement {
  const row = el('li', 'row');

  const head = el('div', 'row-head');

  const checkbox = el('input') as HTMLInputElement;
  checkbox.type = 'checkbox';
  checkbox.checked = state.selection.has(record.conversation_id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selection.add(record.conversation_id);
    else state.selection.delete(record.conversation_id);
    updateSelectionCount();
  });
  head.appendChild(checkbox);

  const title = el('div', 'row-title', record.title === '' ? '(無題)' : record.title);
  title.title = record.conversation_id;
  head.appendChild(title);
  row.appendChild(head);

  const badges = el('div', 'badges');
  badges.appendChild(el('span', `badge ${record.reflection_status}`, record.reflection_status));
  badges.appendChild(el('span', `badge ${record.archive_status}`, record.archive_status));
  if (record.project_id !== null) badges.appendChild(el('span', 'badge project', 'Project'));

  const exclusions = evaluateExclusions(record, ctx);
  for (const reason of exclusions) {
    badges.appendChild(el('span', 'badge excluded', EXCLUSION_REASON_LABELS[reason]));
  }
  row.appendChild(badges);

  const meta = el('div', 'row-meta');
  meta.textContent =
    `id: ${record.conversation_id}\n` +
    `作成: ${formatDateTime(record.created_at)} / 最終観測: ${formatDateTime(record.last_observed_at)}` +
    (record.reflection_reference !== null ? `\n参照: ${record.reflection_reference}` : '') +
    (record.reflection_summary !== null ? `\nメモ: ${record.reflection_summary}` : '');
  meta.style.whiteSpace = 'pre-wrap';
  row.appendChild(meta);

  const actions = el('div', 'row-actions');

  const openLink = el('a', undefined, 'ChatGPTで開く') as HTMLAnchorElement;
  openLink.href = record.url;
  openLink.target = '_blank';
  openLink.rel = 'noreferrer';
  actions.appendChild(openLink);

  if (record.archive_status === 'active') {
    const addBtn = el('button', undefined, exclusions.length > 0 ? '候補に追加 (除外条件あり)' : '候補に追加');
    addBtn.addEventListener('click', () => {
      void applyToOne(record.conversation_id, markCandidate, 'candidate_added', '候補に追加');
    });
    actions.appendChild(addBtn);
  }

  if (record.archive_status === 'candidate') {
    const removeBtn = el('button', undefined, '候補から解除');
    removeBtn.addEventListener('click', () => {
      void applyToOne(record.conversation_id, unmarkCandidate, 'candidate_removed', '候補から解除');
    });
    actions.appendChild(removeBtn);
  }

  row.appendChild(actions);
  return row;
}

function updateSelectionCount(): void {
  byId('selection-count').textContent = `${state.selection.size} 件選択中`;
}

function renderList(): void {
  const list = byId<HTMLUListElement>('conversation-list');
  const records = visibleRecords();
  const ctx = candidateContext();

  list.replaceChildren();
  for (const record of records) list.appendChild(renderRow(record, ctx));

  byId('list-empty').hidden = Object.keys(state.records).length > 0;
  updateSelectionCount();
}

function renderLog(): void {
  const list = byId<HTMLUListElement>('log-list');
  list.replaceChildren();

  for (const entry of state.log) {
    const item = el('li');
    item.appendChild(el('span', 'log-type', entry.type));
    item.appendChild(
      el('span', 'muted', `  ${formatDateTime(entry.at)}${entry.conversation_id !== null ? `  ${entry.conversation_id}` : ''}`),
    );
    item.appendChild(el('div', undefined, entry.detail));
    list.appendChild(item);
  }
}

function renderDryRunRow(row: DryRunRow): HTMLDivElement {
  const box = el('div', `dry-row ${row.included ? 'included' : 'excluded'}`);
  box.appendChild(el('strong', undefined, row.title === '' ? '(無題)' : row.title));

  const dl = el('dl');
  const pairs: [string, string][] = [
    ['会話ID', row.conversation_id],
    ['URL', row.url],
    ['作成日時', formatDateTime(row.created_at)],
    ['Project', row.in_project ? (row.project_id ?? 'yes') : 'なし'],
    ['Vault反映', row.reflection_status],
    ['反映先参照', row.reflection_reference ?? '—'],
    ['アーカイブ状態', row.archive_status],
    [
      '除外理由',
      row.skip_reasons.length === 0
        ? 'なし (実行対象)'
        : row.skip_reasons.map((reason) => DRY_RUN_SKIP_LABELS[reason]).join(' / '),
    ],
  ];

  for (const [label, value] of pairs) {
    dl.appendChild(el('dt', undefined, label));
    dl.appendChild(el('dd', undefined, value));
  }

  box.appendChild(dl);
  return box;
}

function renderDryRun(): void {
  const plan = buildDryRunPlan(Object.values(state.records), candidateContext());
  const output = byId('dryrun-output');
  output.replaceChildren();

  byId('dryrun-headline').textContent =
    `実行予定件数: ${plan.planned_count} 件 (評価対象 ${plan.total_evaluated} 件 / 除外 ${plan.excluded.length} 件)`;

  const includedGroup = el('div', 'dry-group');
  includedGroup.appendChild(el('h3', undefined, `実行対象 (${plan.included.length})`));
  if (plan.included.length === 0) {
    includedGroup.appendChild(el('p', 'muted', '実行対象はありません。'));
  }
  for (const row of plan.included) includedGroup.appendChild(renderDryRunRow(row));
  output.appendChild(includedGroup);

  const excludedGroup = el('div', 'dry-group');
  excludedGroup.appendChild(el('h3', undefined, `除外 (${plan.excluded.length})`));
  for (const row of plan.excluded) excludedGroup.appendChild(renderDryRunRow(row));
  output.appendChild(excludedGroup);

  void addLog('dry_run', `planned=${plan.planned_count} evaluated=${plan.total_evaluated}`);
}

function render(): void {
  renderList();
  renderLog();
}

// ------------------------------------------------------------------ actions

const REJECTION_LABELS: Record<ApprovalRejection, string> = {
  reflection_incomplete: 'Vault反映が未確認 (reflected または not_required が必要)',
  not_a_candidate: 'アーカイブ候補ではない',
  already_approved: 'すでに承認済み',
  immutable_archive_status: '次フェーズ用の状態のため変更不可',
};

type RecordTransition = (
  record: ConversationRecord,
) => { ok: true; value: ConversationRecord } | { ok: false; error: ApprovalRejection };

async function applyToOne(
  id: string,
  transition: RecordTransition,
  logType: OperationLogEntry['type'],
  label: string,
): Promise<void> {
  const record = state.records[id];
  if (record === undefined) return;

  const result = transition(record);
  if (!result.ok) {
    setStatus(`${label}できません: ${REJECTION_LABELS[result.error]}`, 'error');
    await addLog('approval_rejected', `${label} rejected: ${result.error}`, id);
    renderLog();
    return;
  }

  state.records[id] = result.value;
  await persistRecords();
  await addLog(logType, label, id);
  setStatus(`${label}しました。`, 'ok');
  render();
}

async function applyToSelection(
  transition: RecordTransition,
  logType: OperationLogEntry['type'],
  label: string,
): Promise<void> {
  const targets = selectedRecords();
  if (targets.length === 0) {
    setStatus('会話が選択されていません。', 'error');
    return;
  }

  let changed = 0;
  const failures: string[] = [];

  for (const record of targets) {
    const result = transition(record);
    if (!result.ok) {
      failures.push(`${record.title || record.conversation_id}: ${REJECTION_LABELS[result.error]}`);
      continue;
    }
    state.records[record.conversation_id] = result.value;
    changed += 1;
  }

  await persistRecords();
  await addLog(logType, `${label}: changed=${changed} rejected=${failures.length}`);

  if (failures.length > 0) {
    await addLog('approval_rejected', `${label}: ${failures.length} rejected`);
    showIssues(failures);
    setStatus(`${label}: ${changed} 件成功 / ${failures.length} 件は条件を満たしません。`, 'error');
  } else {
    showIssues([]);
    setStatus(`${label}: ${changed} 件に適用しました。`, 'ok');
  }

  render();
}

async function applyReflection(): Promise<void> {
  const statusValue = byId<HTMLSelectElement>('reflection-status').value;
  if (!isReflectionStatus(statusValue)) {
    setStatus('不明な反映状態です。', 'error');
    return;
  }

  const referenceRaw = byId<HTMLInputElement>('reflection-reference').value.trim();
  const summaryRaw = byId<HTMLInputElement>('reflection-summary').value.trim();
  const now = new Date();

  const targets = selectedRecords();
  if (targets.length === 0) {
    setStatus('会話が選択されていません。', 'error');
    return;
  }

  for (const record of targets) {
    state.records[record.conversation_id] = setReflection(
      record,
      {
        reflection_status: statusValue,
        // An empty box means "leave as is" rather than "clear".
        ...(referenceRaw === '' ? {} : { reflection_reference: referenceRaw }),
        ...(summaryRaw === '' ? {} : { reflection_summary: summaryRaw }),
      },
      now,
    );
  }

  await persistRecords();
  await addLog('reflection_updated', `status=${statusValue} count=${targets.length}`);
  setStatus(`${targets.length} 件の反映状態を ${statusValue} に更新しました。`, 'ok');
  render();
}

/**
 * Bulk candidate marking only touches conversations that pass every default
 * exclusion. Anything held back is reported with its reasons so the operator
 * can decide individually — accidental bulk inclusion is the failure mode this
 * whole feature exists to prevent.
 */
async function addEligibleCandidates(): Promise<void> {
  const targets = selectedRecords();
  if (targets.length === 0) {
    setStatus('会話が選択されていません。', 'error');
    return;
  }

  const ctx = candidateContext();
  let added = 0;
  const skipped: string[] = [];

  for (const record of targets) {
    if (!isDefaultEligibleCandidate(record, ctx)) {
      const reasons = evaluateExclusions(record, ctx).map((r) => EXCLUSION_REASON_LABELS[r]);
      skipped.push(`${record.title || record.conversation_id}: ${reasons.join(' / ')}`);
      continue;
    }
    const result = markCandidate(record);
    if (!result.ok) {
      skipped.push(`${record.title || record.conversation_id}: ${REJECTION_LABELS[result.error]}`);
      continue;
    }
    state.records[record.conversation_id] = result.value;
    added += 1;
  }

  await persistRecords();
  await addLog('candidate_added', `bulk added=${added} skipped=${skipped.length}`);
  showIssues(skipped);
  setStatus(`候補に追加: ${added} 件 / 除外: ${skipped.length} 件`, skipped.length > 0 ? 'error' : 'ok');
  render();
}

// ---------------------------------------------------------------- data i/o

function exportJson(): void {
  const payload = buildExport(Object.values(state.records), new Date());
  const text = JSON.stringify(payload, null, 2);

  // Written to the user's own disk through a local blob. Nothing is uploaded.
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chat-vault-operator-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);

  void addLog('export', `exported=${payload.conversation_count}`);
  setStatus(`${payload.conversation_count} 件をエクスポートしました。`, 'ok');
  renderLog();
}

async function importJson(file: File): Promise<void> {
  const text = await file.text();
  const parsed = parseImport(text);

  if (!parsed.ok) {
    // Nothing is written on failure: merge is never reached, so existing
    // records in chrome.storage.local are left exactly as they were.
    const lines = parsed.error.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`);
    showIssues(lines.slice(0, 50));
    setStatus(
      `インポートを中止しました (${parsed.error.length} 件の検証エラー)。既存データは変更していません。`,
      'error',
    );
    await addLog('import_rejected', `issues=${parsed.error.length}`);
    renderLog();
    return;
  }

  const outcome = mergeImported(state.records, parsed.value.conversations);
  state.records = outcome.merged;
  await persistRecords();

  showIssues([]);
  await addLog('import', `added=${outcome.added} updated=${outcome.updated}`);
  setStatus(`インポート完了: 新規 ${outcome.added} 件 / 更新 ${outcome.updated} 件`, 'ok');
  render();
}

// ------------------------------------------------------------------ wiring

function showView(name: 'list' | 'dryrun' | 'log' | 'data'): void {
  const views: Record<string, string> = {
    list: 'view-list',
    dryrun: 'view-dryrun',
    log: 'view-log',
    data: 'view-data',
  };
  const tabs: Record<string, string> = {
    list: 'tab-list',
    dryrun: 'tab-dryrun',
    log: 'tab-log',
    data: 'tab-data',
  };

  for (const [key, viewId] of Object.entries(views)) {
    byId(viewId).hidden = key !== name;
    byId(tabs[key] as string).classList.toggle('active', key === name);
  }

  if (name === 'log') renderLog();
}

function wire(): void {
  byId('btn-scan').addEventListener('click', () => void runScan());

  byId('tab-list').addEventListener('click', () => showView('list'));
  byId('tab-dryrun').addEventListener('click', () => showView('dryrun'));
  byId('tab-log').addEventListener('click', () => showView('log'));
  byId('tab-data').addEventListener('click', () => showView('data'));

  byId<HTMLInputElement>('filter-text').addEventListener('input', (event) => {
    state.filterText = (event.target as HTMLInputElement).value;
    renderList();
  });

  byId<HTMLSelectElement>('filter-reflection').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    state.filterReflection = value === 'all' || !isReflectionStatus(value) ? 'all' : value;
    renderList();
  });

  byId<HTMLSelectElement>('filter-archive').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    state.filterArchive = value === 'all' || !isArchiveStatus(value) ? 'all' : value;
    renderList();
  });

  byId('btn-select-all').addEventListener('click', () => {
    for (const record of visibleRecords()) state.selection.add(record.conversation_id);
    renderList();
  });

  byId('btn-select-none').addEventListener('click', () => {
    state.selection.clear();
    renderList();
  });

  byId('btn-apply-reflection').addEventListener('click', () => void applyReflection());
  byId('btn-add-candidates').addEventListener('click', () => void addEligibleCandidates());

  byId('btn-remove-candidates').addEventListener('click', () => {
    void applyToSelection(unmarkCandidate, 'candidate_removed', '候補から解除');
  });

  byId('btn-approve').addEventListener('click', () => {
    const now = new Date();
    void applyToSelection((record) => approve(record, now), 'approved', '承認');
  });

  byId('btn-revoke').addEventListener('click', () => {
    void applyToSelection(revokeApproval, 'approval_revoked', '承認取り消し');
  });

  byId('btn-dryrun').addEventListener('click', () => {
    renderDryRun();
    renderLog();
  });

  byId('btn-clear-log').addEventListener('click', () => {
    void (async () => {
      state.log = [];
      await store.writeLog(state.log);
      await addLog('log_cleared', 'operation log cleared by operator');
      renderLog();
      setStatus('操作ログを消去しました。', 'ok');
    })();
  });

  byId('btn-export').addEventListener('click', () => exportJson());

  byId<HTMLInputElement>('import-file').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    void importJson(file).finally(() => {
      // Allow re-selecting the same file after fixing it.
      input.value = '';
    });
  });

  // The archive button is inert by design in phase 1. No listener is attached.
}

async function init(): Promise<void> {
  wire();
  state.records = await store.readConversations();
  state.log = await store.readLog();
  render();
  setStatus(`${Object.keys(state.records).length} 件を読み込みました。`);
}

void init();
