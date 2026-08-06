(async () => {
  const APP_ID = 'cvo-mini';
  const CONCURRENCY = 3;
  const BATCH_DELAY_MS = 75;
  const RETRY_DELAY_MS = 500;
  const MAX_RATE_LIMIT_RETRIES = 2;

  if (document.getElementById(APP_ID)) {
    document.getElementById(APP_ID).remove();
    return;
  }
  if (location.hostname !== 'chatgpt.com' && location.hostname !== 'chat.openai.com') {
    alert('chatgpt.comで実行してください');
    return;
  }

  class RateLimitError extends Error {
    constructor(retryAfter) {
      super('Too Many Requests');
      const seconds = Number.parseInt(retryAfter || '', 10);
      this.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30000;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const root = document.createElement('div');
  root.id = APP_ID;
  root.innerHTML = `<style>#${APP_ID}{position:fixed;inset:0;z-index:2147483647;background:#fff;color:#111;font-family:system-ui;display:flex;flex-direction:column}#${APP_ID} *{box-sizing:border-box}#${APP_ID} header{padding:12px;border-bottom:1px solid #ddd}#${APP_ID} h2{margin:0 0 10px;font-size:18px}#${APP_ID} input[type=search]{width:100%;padding:11px;border:1px solid #bbb;border-radius:9px;font-size:16px}#${APP_ID} .bar{display:flex;gap:8px;margin-top:8px}#${APP_ID} button{border:0;border-radius:9px;padding:10px 12px;font:inherit;font-weight:700;background:#eee}#${APP_ID} .go{background:#0b7a53;color:#fff}#${APP_ID} main{flex:1;overflow:auto;padding:4px 10px 100px}#${APP_ID} label{display:grid;grid-template-columns:28px 1fr;gap:8px;padding:11px 4px;border-bottom:1px solid #eee}#${APP_ID} input[type=checkbox]{width:20px;height:20px}#${APP_ID} small{color:#666}#${APP_ID} footer{position:fixed;left:0;right:0;bottom:0;padding:10px;background:#fff;border-top:1px solid #ddd;display:grid;grid-template-columns:1fr 1fr;gap:8px}#${APP_ID} .status{font-size:13px;color:#666;margin-top:7px}</style><header><h2>Chat整理</h2><input type="search" placeholder="タイトル検索"><div class="bar"><button class="all">表示中を全選択</button><button class="close">閉じる</button></div><div class="status">取得中…</div></header><main></main><footer><button class="reload">再取得</button><button class="go" disabled>0件をアーカイブ</button></footer>`;
  document.documentElement.appendChild(root);

  const query = (selector) => root.querySelector(selector);
  const main = query('main');
  const status = query('.status');
  const archiveButton = query('.go');
  const search = query('input[type=search]');
  const selectAllButton = query('.all');
  let items = [];
  const selected = new Set();
  let busy = false;
  let visibleItems = [];
  let token = '';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  async function getToken() {
    if (token) return token;
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`セッション取得失敗 ${response.status}`);
    const session = await response.json();
    if (!session.accessToken) throw new Error('再ログインしてください');
    token = session.accessToken;
    return token;
  }

  async function api(path, options = {}) {
    const accessToken = await getToken();
    const response = await fetch(`/backend-api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Authorization': `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
    if (response.status === 429) throw new RateLimitError(response.headers.get('Retry-After'));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function formatTime(value) {
    const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ja-JP');
  }

  function updateButton() {
    archiveButton.textContent = `${selected.size}件をアーカイブ`;
    archiveButton.disabled = busy || selected.size === 0;
  }

  function render() {
    const keyword = search.value.trim().toLowerCase();
    visibleItems = items.filter((item) => (item.title || '').toLowerCase().includes(keyword));
    main.innerHTML = visibleItems.length
      ? visibleItems.map((item) => `<label><input type="checkbox" data-id="${item.id}" ${selected.has(item.id) ? 'checked' : ''}><span><b>${escapeHtml(item.title || '無題のチャット')}</b><br><small>${escapeHtml(formatTime(item.update_time || item.create_time))}</small></span></label>`).join('')
      : '<p>該当なし</p>';
    main.querySelectorAll('input').forEach((checkbox) => {
      checkbox.onchange = () => {
        if (checkbox.checked) selected.add(checkbox.dataset.id);
        else selected.delete(checkbox.dataset.id);
        updateButton();
      };
    });
    const allSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(item.id));
    selectAllButton.textContent = allSelected ? '表示中を選択解除' : '表示中を全選択';
    updateButton();
  }

  async function load() {
    if (busy) return;
    busy = true;
    selected.clear();
    status.textContent = '取得中…';
    updateButton();
    try {
      const all = [];
      let offset = 0;
      for (let page = 0; page < 20; page += 1) {
        const result = await api(`/conversations?offset=${offset}&limit=100`);
        const pageItems = result.items || [];
        all.push(...pageItems.filter((item) => !item.is_archived && !item.is_temporary_chat));
        if (pageItems.length === 0 || pageItems.length < 100 || (result.total != null && all.length >= result.total)) break;
        offset += pageItems.length;
      }
      items = [...new Map(all.map((item) => [item.id, item])).values()]
        .sort((left, right) => new Date(right.update_time || right.create_time) - new Date(left.update_time || left.create_time));
      status.textContent = `${items.length}件取得`;
      render();
    } catch (error) {
      status.textContent = `取得失敗: ${error.message}`;
    } finally {
      busy = false;
      updateButton();
    }
  }

  async function archiveOnce(item) {
    const result = await api(`/conversation/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: true }),
    });
    return result.success === true;
  }

  async function retryFailed(failed, succeededIds) {
    if (failed.length === 0) return [];
    status.textContent = `失敗した${failed.length}件を1件ずつ再試行…`;
    await sleep(RETRY_DELAY_MS);
    const remaining = [];

    for (let index = 0; index < failed.length; index += 1) {
      const item = failed[index].item;
      let rateLimitRetries = 0;
      while (true) {
        status.textContent = `再試行中 ${index + 1}/${failed.length}`;
        try {
          if (await archiveOnce(item)) succeededIds.add(item.id);
          else remaining.push({ item, reason: 'APIが成功を返しませんでした' });
          break;
        } catch (error) {
          if (error instanceof RateLimitError && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries += 1;
            status.textContent = `利用制限のため${Math.ceil(error.retryAfterMs / 1000)}秒待機…`;
            await sleep(error.retryAfterMs);
            continue;
          }
          remaining.push({ item, reason: error.message || String(error) });
          break;
        }
      }
    }
    return remaining;
  }

  async function archiveSelected() {
    if (selected.size === 0 || busy) return;
    const targets = items.filter((item) => selected.has(item.id));
    if (!confirm(`${targets.length}件をアーカイブします。削除はしません。`)) return;

    busy = true;
    updateButton();
    const pending = [...targets];
    const succeededIds = new Set();
    let failed = [];
    let concurrency = CONCURRENCY;
    let completed = 0;

    while (pending.length > 0) {
      const batch = pending.splice(0, concurrency);
      status.textContent = `処理中 ${completed}/${targets.length}（${concurrency}件並列）`;
      const results = await Promise.all(batch.map(async (item) => {
        try {
          return { item, success: await archiveOnce(item) };
        } catch (error) {
          return { item, success: false, error };
        }
      }));

      const rateLimited = [];
      let retryAfterMs = 0;
      for (const result of results) {
        if (result.success) {
          succeededIds.add(result.item.id);
          completed += 1;
        } else if (result.error instanceof RateLimitError) {
          rateLimited.push(result.item);
          retryAfterMs = Math.max(retryAfterMs, result.error.retryAfterMs);
        } else {
          failed.push({ item: result.item, reason: result.error?.message || 'APIが成功を返しませんでした' });
          completed += 1;
        }
      }

      if (rateLimited.length > 0) {
        concurrency = 1;
        pending.unshift(...rateLimited);
        status.textContent = `利用制限を検知。${Math.ceil(retryAfterMs / 1000)}秒後に1件ずつ再開…`;
        await sleep(retryAfterMs);
      } else if (pending.length > 0) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    failed = await retryFailed(failed, succeededIds);
    items = items.filter((item) => !succeededIds.has(item.id));
    succeededIds.forEach((id) => selected.delete(id));
    busy = false;
    render();
    status.textContent = `完了: 成功${succeededIds.size}件 / 失敗${failed.length}件`;
  }

  search.oninput = render;
  selectAllButton.onclick = () => {
    const allSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(item.id));
    visibleItems.forEach((item) => {
      if (allSelected) selected.delete(item.id);
      else selected.add(item.id);
    });
    render();
  };
  query('.close').onclick = () => root.remove();
  query('.reload').onclick = load;
  archiveButton.onclick = archiveSelected;
  await load();
})().catch((error) => alert(`起動失敗: ${error.message}`));
