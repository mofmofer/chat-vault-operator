(() => {
  'use strict';

  const APP_ID = 'chat-vault-operator-root';
  const MAX_CONVERSATIONS = 2000;
  const MAIN_PAGE_SIZE = 100;
  const PROJECT_PAGE_SIZE = 50;
  const ARCHIVE_DELAY_MS = 250;
  const MAX_RATE_LIMIT_RETRIES = 2;

  const existing = document.getElementById(APP_ID);
  if (existing) {
    existing.remove();
    return;
  }

  if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)$/.test(location.origin)) {
    alert('Chat Vault Operatorはchatgpt.com上で実行してください。');
    return;
  }

  const previousOverflow = document.documentElement.style.overflow;
  const state = {
    conversations: [],
    filtered: [],
    selected: new Set(),
    includeProjects: false,
    loading: false,
    archiving: false,
    auth: null,
  };

  class RateLimitError extends Error {
    constructor(retryAfterHeader) {
      super('Too Many Requests');
      this.name = 'RateLimitError';
      const seconds = Number.parseInt(retryAfterHeader || '', 10);
      this.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30000;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const apiBase = `${location.origin}/backend-api`;

  async function getAuth() {
    if (state.auth) return state.auth;

    const sessionResponse = await fetch(`${location.origin}/api/auth/session`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!sessionResponse.ok) throw new Error('ログインセッションを取得できませんでした。');

    const session = await sessionResponse.json();
    if (!session.accessToken) throw new Error('アクセストークンを取得できませんでした。再ログインしてください。');

    let accountId = null;
    try {
      const accountsResponse = await fetch(`${apiBase}/accounts/check/v4-2023-04-27`, {
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Authorization': `Bearer ${session.accessToken}`,
        },
      });
      if (accountsResponse.ok) {
        const accounts = await accountsResponse.json();
        const workspaceCookie = document.cookie
          .split(';')
          .map((value) => value.trim())
          .find((value) => value.startsWith('_account='));
        const workspaceId = workspaceCookie ? decodeURIComponent(workspaceCookie.slice('_account='.length)) : '';
        accountId = accounts.accounts?.[workspaceId]?.account?.account_id || null;
      }
    } catch (_) {
      accountId = null;
    }

    state.auth = { accessToken: session.accessToken, accountId };
    return state.auth;
  }

  async function apiFetch(path, options = {}) {
    const auth = await getAuth();
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'X-Authorization': `Bearer ${auth.accessToken}`,
        ...(auth.accountId ? { 'Chatgpt-Account-Id': auth.accountId } : {}),
        ...(options.headers || {}),
      },
    });

    if (response.status === 429) throw new RateLimitError(response.headers.get('Retry-After'));
    if (!response.ok) throw new Error(`APIエラー: ${response.status} ${response.statusText}`);
    return response.json();
  }

  async function fetchMainConversations() {
    const items = [];
    let offset = 0;

    while (items.length < MAX_CONVERSATIONS) {
      const result = await apiFetch(`/conversations?offset=${offset}&limit=${MAIN_PAGE_SIZE}`);
      const page = Array.isArray(result.items) ? result.items : [];
      items.push(...page);
      if (page.length === 0) break;
      if (result.total != null && items.length >= result.total) break;
      if (page.length < MAIN_PAGE_SIZE && result.cursor == null) break;
      offset += page.length;
    }

    return items.slice(0, MAX_CONVERSATIONS);
  }

  async function fetchProjects() {
    const projects = [];
    let cursor = null;
    let safety = 0;

    do {
      const cursorQuery = cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const result = await apiFetch(`/gizmos/snorlax/sidebar?conversations_per_gizmo=0${cursorQuery}`);
      const entries = Array.isArray(result.items) ? result.items : [];
      for (const entry of entries) {
        const project = entry?.gizmo?.gizmo || entry?.gizmo || entry;
        if (project?.id) {
          projects.push({
            id: project.id,
            name: project.display?.name || project.name || 'プロジェクト',
          });
        }
      }
      cursor = result.cursor ?? null;
      safety += 1;
    } while (cursor != null && safety < 100);

    return projects;
  }

  async function fetchProjectConversations(project) {
    const items = [];
    let cursor = 0;
    let safety = 0;

    while (items.length < MAX_CONVERSATIONS && safety < 100) {
      const result = await apiFetch(`/gizmos/${encodeURIComponent(project.id)}/conversations?cursor=${encodeURIComponent(cursor)}&limit=${PROJECT_PAGE_SIZE}`);
      const page = Array.isArray(result.items) ? result.items : [];
      items.push(...page.map((item) => ({ ...item, projectName: project.name, projectId: project.id })));
      if (page.length === 0 || result.cursor == null) break;
      cursor = result.cursor;
      safety += 1;
    }

    return items;
  }

  async function fetchAllConversations() {
    const main = await fetchMainConversations();
    if (!state.includeProjects) return main;

    const projects = await fetchProjects();
    const all = [...main];
    for (let index = 0; index < projects.length; index += 1) {
      setStatus(`プロジェクトを取得中… ${index + 1}/${projects.length}`);
      try {
        all.push(...await fetchProjectConversations(projects[index]));
      } catch (error) {
        console.warn('Project conversation fetch failed', projects[index].id, error);
      }
    }
    return all;
  }

  function normalizeTime(value) {
    if (typeof value === 'number') return value > 1000000000000 ? value : value * 1000;
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatTime(value) {
    const timestamp = normalizeTime(value);
    if (!timestamp) return '日時不明';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(timestamp));
  }

  function deduplicateAndSort(items) {
    const map = new Map();
    for (const item of items) {
      if (!item?.id || item.is_archived || item.is_temporary_chat) continue;
      const current = map.get(item.id);
      if (!current || normalizeTime(item.update_time) > normalizeTime(current.update_time)) map.set(item.id, item);
    }
    return [...map.values()].sort((left, right) => normalizeTime(right.update_time || right.create_time) - normalizeTime(left.update_time || left.create_time));
  }

  const root = document.createElement('div');
  root.id = APP_ID;
  root.innerHTML = `
    <style>
      [id="${APP_ID}"] { position: fixed; inset: 0; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: rgb(31, 31, 31); }
      [id="${APP_ID}"] * { box-sizing: border-box; }
      [id="${APP_ID}"] .cvo-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .48); }
      [id="${APP_ID}"] .cvo-panel { position: absolute; inset: max(10px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); max-width: 760px; margin: auto; display: flex; flex-direction: column; background: rgb(255, 255, 255); border-radius: 18px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.28); }
      [id="${APP_ID}"] .cvo-header { padding: 14px 16px 10px; border-bottom: 1px solid rgb(229, 229, 229); }
      [id="${APP_ID}"] .cvo-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      [id="${APP_ID}"] h1 { margin: 0; font-size: 18px; line-height: 1.35; }
      [id="${APP_ID}"] button { border: 0; border-radius: 10px; min-height: 40px; padding: 8px 12px; font: inherit; font-weight: 650; cursor: pointer; }
      [id="${APP_ID}"] button:disabled { opacity: .45; cursor: default; }
      [id="${APP_ID}"] .cvo-close { width: 40px; padding: 0; background: rgb(242, 242, 242); font-size: 22px; }
      [id="${APP_ID}"] .cvo-controls { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 12px; }
      [id="${APP_ID}"] input[type="search"] { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid rgb(205, 205, 205); border-radius: 10px; font: inherit; background: rgb(255,255,255); color: inherit; }
      [id="${APP_ID}"] .cvo-reload { background: rgb(236, 236, 236); }
      [id="${APP_ID}"] .cvo-options { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 10px; font-size: 13px; }
      [id="${APP_ID}"] .cvo-options label { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; }
      [id="${APP_ID}"] input[type="checkbox"] { width: 20px; height: 20px; accent-color: rgb(16, 122, 88); }
      [id="${APP_ID}"] .cvo-status { min-height: 22px; margin-top: 7px; font-size: 13px; color: rgb(88, 88, 88); }
      [id="${APP_ID}"] .cvo-list { flex: 1; overflow: auto; padding: 6px 10px 120px; overscroll-behavior: contain; }
      [id="${APP_ID}"] .cvo-item { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; padding: 12px 8px; border-bottom: 1px solid rgb(235,235,235); }
      [id="${APP_ID}"] .cvo-item-title { font-size: 15px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
      [id="${APP_ID}"] .cvo-meta { display: flex; flex-wrap: wrap; gap: 5px 9px; margin-top: 5px; color: rgb(105,105,105); font-size: 12px; }
      [id="${APP_ID}"] .cvo-project { padding: 2px 7px; border-radius: 999px; background: rgb(238,245,242); color: rgb(16,92,68); }
      [id="${APP_ID}"] .cvo-empty { padding: 32px 16px; text-align: center; color: rgb(105,105,105); }
      [id="${APP_ID}"] .cvo-footer { position: absolute; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid rgb(225,225,225); background: rgba(255,255,255,.96); backdrop-filter: blur(12px); }
      [id="${APP_ID}"] .cvo-select-all { background: rgb(236,236,236); }
      [id="${APP_ID}"] .cvo-count { text-align: center; font-size: 13px; font-weight: 650; }
      [id="${APP_ID}"] .cvo-archive { background: rgb(16, 122, 88); color: rgb(255,255,255); }
      @media (max-width: 520px) {
        [id="${APP_ID}"] .cvo-panel { inset: 0; max-width: none; border-radius: 0; }
        [id="${APP_ID}"] .cvo-footer { grid-template-columns: 1fr 1fr; }
        [id="${APP_ID}"] .cvo-count { grid-column: 1 / -1; grid-row: 1; }
        [id="${APP_ID}"] .cvo-select-all { grid-column: 1; grid-row: 2; }
        [id="${APP_ID}"] .cvo-archive { grid-column: 2; grid-row: 2; }
      }
    </style>
    <div class="cvo-backdrop"></div>
    <section class="cvo-panel" role="dialog" aria-modal="true" aria-label="Chat Vault Operator">
      <header class="cvo-header">
        <div class="cvo-title-row">
          <h1>Chat Vault Operator</h1>
          <button class="cvo-close" type="button" aria-label="閉じる">×</button>
        </div>
        <div class="cvo-controls">
          <input class="cvo-search" type="search" placeholder="タイトルで検索" autocomplete="off">
          <button class="cvo-reload" type="button">再取得</button>
        </div>
        <div class="cvo-options">
          <label><input class="cvo-projects-toggle" type="checkbox">プロジェクト内も含める</label>
          <span>削除機能なし・外部送信なし</span>
        </div>
        <div class="cvo-status" aria-live="polite">準備中…</div>
      </header>
      <main class="cvo-list"></main>
      <footer class="cvo-footer">
        <button class="cvo-select-all" type="button">表示中を全選択</button>
        <div class="cvo-count">0件選択</div>
        <button class="cvo-archive" type="button" disabled>選択分をアーカイブ</button>
      </footer>
    </section>
  `;
  document.documentElement.appendChild(root);
  document.documentElement.style.overflow = 'hidden';

  const elements = {
    close: root.querySelector('.cvo-close'),
    backdrop: root.querySelector('.cvo-backdrop'),
    search: root.querySelector('.cvo-search'),
    reload: root.querySelector('.cvo-reload'),
    projectsToggle: root.querySelector('.cvo-projects-toggle'),
    status: root.querySelector('.cvo-status'),
    list: root.querySelector('.cvo-list'),
    selectAll: root.querySelector('.cvo-select-all'),
    count: root.querySelector('.cvo-count'),
    archive: root.querySelector('.cvo-archive'),
  };

  function close() {
    document.documentElement.style.overflow = previousOverflow;
    root.remove();
  }

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function setBusy(isBusy) {
    elements.reload.disabled = isBusy;
    elements.projectsToggle.disabled = isBusy;
    elements.search.disabled = isBusy;
    elements.selectAll.disabled = isBusy;
    elements.archive.disabled = isBusy || state.selected.size === 0;
  }

  function updateSelectionUi() {
    elements.count.textContent = `${state.selected.size}件選択`;
    elements.archive.disabled = state.loading || state.archiving || state.selected.size === 0;
    const selectableIds = state.filtered.map((item) => item.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => state.selected.has(id));
    elements.selectAll.textContent = allSelected ? '表示中を選択解除' : '表示中を全選択';
  }

  function applyFilter() {
    const query = elements.search.value.trim().toLocaleLowerCase('ja-JP');
    state.filtered = query
      ? state.conversations.filter((item) => `${item.title || ''} ${item.projectName || ''}`.toLocaleLowerCase('ja-JP').includes(query))
      : [...state.conversations];
    renderList();
  }

  function renderList() {
    elements.list.replaceChildren();
    if (state.filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cvo-empty';
      empty.textContent = state.loading ? '会話を取得しています…' : '該当する会話はありません。';
      elements.list.appendChild(empty);
      updateSelectionUi();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of state.filtered) {
      const label = document.createElement('label');
      label.className = 'cvo-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selected.has(item.id);
      checkbox.disabled = state.archiving;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selected.add(item.id);
        else state.selected.delete(item.id);
        updateSelectionUi();
      });

      const body = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'cvo-item-title';
      title.textContent = item.title || '無題のチャット';
      body.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'cvo-meta';
      const time = document.createElement('span');
      time.textContent = `更新: ${formatTime(item.update_time || item.create_time)}`;
      meta.appendChild(time);
      if (item.projectName) {
        const project = document.createElement('span');
        project.className = 'cvo-project';
        project.textContent = item.projectName;
        meta.appendChild(project);
      }
      body.appendChild(meta);

      label.append(checkbox, body);
      fragment.appendChild(label);
    }
    elements.list.appendChild(fragment);
    updateSelectionUi();
  }

  async function loadConversations() {
    if (state.loading || state.archiving) return;
    state.loading = true;
    state.selected.clear();
    setBusy(true);
    setStatus('会話一覧を取得中…');
    renderList();

    try {
      const items = await fetchAllConversations();
      state.conversations = deduplicateAndSort(items);
      applyFilter();
      const capped = state.conversations.length >= MAX_CONVERSATIONS ? `（上限${MAX_CONVERSATIONS}件）` : '';
      setStatus(`${state.conversations.length}件を取得しました${capped}。`);
    } catch (error) {
      console.error('Chat Vault Operator load failed', error);
      setStatus(`取得に失敗しました: ${error.message || error}`);
      state.conversations = [];
      applyFilter();
    } finally {
      state.loading = false;
      setBusy(false);
      updateSelectionUi();
    }
  }

  async function archiveOne(id) {
    let attempt = 0;
    while (true) {
      try {
        const result = await apiFetch(`/conversation/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_archived: true }),
        });
        return result?.success === true;
      } catch (error) {
        if (error instanceof RateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
          attempt += 1;
          setStatus(`利用制限のため${Math.ceil(error.retryAfterMs / 1000)}秒待機します…`);
          await sleep(error.retryAfterMs);
          continue;
        }
        throw error;
      }
    }
  }

  async function archiveSelected() {
    if (state.archiving || state.selected.size === 0) return;
    const targets = state.conversations.filter((item) => state.selected.has(item.id));
    const preview = targets.slice(0, 5).map((item) => `・${item.title || '無題のチャット'}`).join('\n');
    const remainder = targets.length > 5 ? `\nほか${targets.length - 5}件` : '';
    if (!confirm(`${targets.length}件をアーカイブします。削除はされません。\n\n${preview}${remainder}`)) return;

    state.archiving = true;
    setBusy(true);
    renderList();
    const succeeded = [];
    const failed = [];

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      setStatus(`アーカイブ中… ${index + 1}/${targets.length}：${target.title || '無題のチャット'}`);
      try {
        if (await archiveOne(target.id)) succeeded.push(target.id);
        else failed.push({ item: target, reason: 'APIが成功を返しませんでした。' });
      } catch (error) {
        failed.push({ item: target, reason: error.message || String(error) });
      }
      if (index < targets.length - 1) await sleep(ARCHIVE_DELAY_MS);
    }

    const succeededSet = new Set(succeeded);
    state.conversations = state.conversations.filter((item) => !succeededSet.has(item.id));
    for (const id of succeeded) state.selected.delete(id);
    state.archiving = false;
    applyFilter();
    setBusy(false);

    if (failed.length === 0) {
      setStatus(`${succeeded.length}件をアーカイブしました。ChatGPTを再読み込みするとサイドバーにも反映されます。`);
    } else {
      const failedTitles = failed.slice(0, 3).map(({ item }) => item.title || '無題のチャット').join('、');
      setStatus(`成功${succeeded.length}件、失敗${failed.length}件。失敗: ${failedTitles}${failed.length > 3 ? ' ほか' : ''}`);
    }
  }

  elements.close.addEventListener('click', close);
  elements.backdrop.addEventListener('click', close);
  elements.search.addEventListener('input', applyFilter);
  elements.reload.addEventListener('click', loadConversations);
  elements.projectsToggle.addEventListener('change', () => {
    state.includeProjects = elements.projectsToggle.checked;
    loadConversations();
  });
  elements.selectAll.addEventListener('click', () => {
    const ids = state.filtered.map((item) => item.id);
    const allSelected = ids.length > 0 && ids.every((id) => state.selected.has(id));
    for (const id of ids) {
      if (allSelected) state.selected.delete(id);
      else state.selected.add(id);
    }
    renderList();
  });
  elements.archive.addEventListener('click', archiveSelected);
  document.addEventListener('keydown', function escapeHandler(event) {
    if (event.key === 'Escape' && document.getElementById(APP_ID)) {
      document.removeEventListener('keydown', escapeHandler);
      close();
    }
  });

  loadConversations();
})();
