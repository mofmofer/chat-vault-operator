# 上流OSS監査結果 (Upstream Assessment)

| 項目 | 内容 |
| --- | --- |
| Project | gpt-conv-manager-chrome |
| Repository | https://github.com/yurtools/gpt-conv-manager-chrome |
| 監査対象 commit | `8b7e7c55f4e72f186e90eab6fd288e0ee7e6da51` |
| License | MIT License (Copyright (c) 2026 yurtools) |
| 監査日 | 2026-08-02 |
| 監査範囲 | リポジトリ全体（23ファイル / JS 実装 3,130 行相当） |
| 監査者判断 | **コード流用せず、クリーン実装。MIT 表示は保持する。** |

上流は参照専用として扱い、一切変更していない。

---

## 1. 上流の構成

上流は同一実装の 2 バリアントを持つ。

```text
chatgpt-managing-extension-popup/      # Popup UI 版
chatgpt-managing-extension-sidepanel/  # Side Panel UI 版（本プロジェクトに近い）
  ├─ manifest.json
  ├─ content.js    (213行)  DOM スクレイピング + 強制スクロール
  ├─ popup.js      (808行)  UI・一括操作オーケストレーション
  ├─ sw.js         (158行)  Service Worker：Bearer 窃取 + backend-api 呼び出し
  └─ sidepanel.html (155行)
```

`popup.js` は両バリアントで完全に同一（808行）。差分は `sw.js` の Side Panel 起動処理と manifest の `sidePanel` 権限のみ。

---

## 2. 監査項目別の結果

凡例：**❌ = 本プロジェクトの禁止事項に該当** / ⚠️ = 要注意 / ✅ = 問題なし

| # | 監査項目 | 上流での状況 | 判定 |
| --- | --- | --- | --- |
| 1 | ライセンス | MIT License, Copyright (c) 2026 yurtools。ライセンス条項は標準文面のまま | ✅ 流用可能（表示保持が条件） |
| 2 | Manifest バージョン | `manifest_version: 3` | ✅ |
| 3 | Chrome 権限 | `["activeTab", "scripting", "storage", "webRequest", "sidePanel"]` | ❌ `webRequest` |
| 4 | host_permissions | `["https://chatgpt.com/*"]` | ✅ 適切に限定 |
| 5 | サイドパネル構成 | `side_panel.default_path: sidepanel.html`、`chrome.action.onClicked` で `sidePanel.open()` | ✅ 構成自体は妥当 |
| 6 | 会話一覧の取得方法 | **2系統**。(a) サイドバー DOM スクレイピング (`content.js`)、(b) Project 配下は内部 API | ⚠️ (a) は安全 / ❌ (b) |
| 7 | ChatGPT 内部 API の使用 | `sw.js` で 2 エンドポイントを使用 | ❌ |
| 8 | `backend-api` の使用 | `PATCH /backend-api/conversation/<id>`、`GET /backend-api/gizmos/<id>/conversations?cursor=` | ❌ |
| 9 | Authorization ヘッダーの取得 | `sw.js:26` — `onBeforeSendHeaders` で `authorization` ヘッダーを名前一致で抽出 | ❌ |
| 10 | Bearer トークンの取得 | `sw.js:22-37` — `Bearer ` 前置詞を判定し `chrome.storage.session` へ永続化 | ❌ |
| 11 | Cookie の取得 | `chrome.cookies` / `document.cookie` の使用なし。ただし `fetch` が同一オリジンのため実質セッション Cookie に便乗 | ⚠️ 直接取得はなし |
| 12 | `chrome.webRequest` の使用 | `sw.js:22` — `onBeforeSendHeaders` を `https://chatgpt.com/backend-api/*` に対して登録 | ❌ |
| 13 | 会話削除機能 | あり。`PATCH { is_visible: false }`（削除）/ `{ is_visible: true }`（復元）。UI に `delete` ボタンと一括削除モード | ❌ |
| 14 | 外部通信 | 開発者所有サーバーへの通信は**なし**。通信先は `https://chatgpt.com` のみ | ✅ 第三者送信なし |
| 15 | 分析・テレメトリー | なし（`analytics` / `telemetry` の文字列ヒット 0） | ✅ |
| 16 | 広告・課金処理 | なし | ✅ |
| 17 | 会話本文の取得・保存 | **取得も保存もしていない**。DOM 走査対象は `<a>` のリンクテキスト（＝タイトル）のみ | ✅ |
| 18 | リモートコード | なし。`eval` / `new Function` / 外部 script タグの使用なし | ✅ |
| 19 | DOM 書き換え | `treeEl.innerHTML = ""` のみ（クリア用途、データ挿入なし） | ✅ 低リスク |
| 20 | ページ自動操作 | `content.js:151` — サイドバーを最大120回強制スクロールして遅延ロードを誘発 | ⚠️ |
| 21 | タブ操作 | `chrome.tabs.update` / `chrome.tabs.reload`（一括操作後にページ再読込） | ⚠️ |

### 危険度の内訳

**致命的（禁止事項に直接該当）— すべて `sw.js` に集中**

1. `chrome.webRequest.onBeforeSendHeaders` によるユーザーの ChatGPT 認証情報（Bearer トークン）の傍受・保存
2. 傍受したトークンを用いた非公開 `backend-api` への認証済みリクエスト
3. `PATCH { is_visible: false }` による会話削除、およびその一括実行

**中程度**

4. `popup.js` の UI が上記 1〜3 と密結合（`apiPatch()` / `runBulkApiActionOnList()` / `mutated` state / Stop 制御が一体）
5. `content.js` のサイドバー強制スクロール（ページ挙動への介入）

---

## 3. コード流用可否の判断

**結論：上流からコードを 1 行も流用しない。ただし MIT 表示は保持する。**

ファイル単位の判断は以下のとおり。

### `sw.js` — 全面的に不採用

禁止事項のほぼ全て（`webRequest`、Authorization 取得、Bearer 取得、`backend-api`、削除）がこの 1 ファイルに存在する。部分流用の余地はない。本プロジェクトの Service Worker は Side Panel を開くだけのクリーン実装とした。

### `popup.js` — 不採用

UI としての参考価値はあるが、以下の理由で流用しない。

- 一括アーカイブ／削除の実行ループ（`runBulkApiActionOnList`）と Stop 制御が UI 状態と一体化しており、危険な処理と密結合している
- `apiPatch()` / `apiHasBearer()` 経由で `sw.js` の禁止機能に直接依存
- ドメインロジックと DOM 操作が分離されておらず、単体テストが不可能
- 本プロジェクトが必要とする Vault 反映状態・承認ゲート・Dry Run は上流に存在しない概念であり、流用しても土台にならない

**作業ルールの「危険な処理と密結合している場合はコピーせずクリーン実装」に該当する。**

### `content.js` — 不採用（ただし知見は参照）

このファイル自体は API を一切呼ばず、会話本文も読まない。最も流用に近いファイルだが、以下の理由でクリーン実装とした。

1. **識別子の抽出方法が本プロジェクトの要件を満たさない。**
   上流の `uniqIdFromUrl()` は URL の最終パスセグメントを無条件に返す。`/g/<gizmo>/project` に対して `"project"` を返し、UUID 形式の検証も行わない。本プロジェクトは「ID または URL を一意に取得できない会話は候補から除外する」ことを要件としており、形式検証を伴う厳密な実装が必要。
2. **強制スクロール（`scrollSidebarToLoadAll`）を採用しない。**
   ページの遅延ロードを誘発する自動操作であり、第1段階の「読み取りのみ」方針から外れる。
3. **メッセージングの構造が上流の危険なフローに合わせて設計されている。**

一方、以下は「ChatGPT の DOM 構造に関する事実」であり、上流の調査結果として参照した。

- 会話リンクのセレクタ形状（`a[href^="/c/"]` 系）
- Project の canonical id が `g-p-` + 32 桁 hex であり、サイドバーの href には slug 接尾辞が付く場合があること
- 日付見出し（`Today` / `Yesterday` / `Previous 7 days` / `Previous 30 days`）が祖先の兄弟要素として現れること

これらは表現ではなく事実の知見だが、出所が上流であることは明確なため、**MIT ライセンス表示を保持する方針を取る**（`NOTICE.md` および `LICENSE` 参照）。過剰な帰属は無害だが、不足は許されないという判断による。

### `manifest.json` — 不採用

`webRequest` を含むため、権限セットをそのまま使えない。本プロジェクトの権限は `storage` / `sidePanel` / `scripting` のみに削減した（`webRequest` と `activeTab` を除去）。

---

## 4. 本プロジェクトでの対応方針

| 上流の機能 | 本プロジェクトでの扱い |
| --- | --- |
| Bearer 傍受 (`webRequest`) | **実装しない。** `webRequest` 権限を要求しない |
| `backend-api` 呼び出し | **実装しない。** 外部通信を一切行わない（CSP `connect-src 'none'` で強制） |
| 会話のアーカイブ実行 | **第1段階では実装しない。** Dry Run による事前確認のみ |
| 会話の削除 | **恒久的に実装しない。** 本プロジェクトのスコープ外 |
| Project 配下会話の API 取得 | **実装しない。** Project 配下会話はサイドバー DOM で観測し、既定でアーカイブ候補から除外する |
| サイドバー DOM 走査 | クリーン実装。厳密な UUID 検証を追加し、抽出した純粋ロジックを `domain/sidebar-extract.ts` に分離してテスト可能にした |
| サイドバー強制スクロール | **実装しない。** 画面に表示されている範囲のみ読み取る |
| 一括操作 + Stop 制御 | 破壊的操作が存在しないため不要 |
| Side Panel の起動 | 概念のみ共通。実装はクリーン |

上流に存在しない、本プロジェクト固有の追加要素：

- Vault 反映状態の管理（`reflection_status` と参照先・メモ）
- 承認ゲート（`reflected` または `not_required` でなければ `approved` にできない）
- 既定の候補除外ルール 4 種（現在開いている会話 / 当日会話 / Project 配下 / 一意識別不能）
- Dry Run（副作用なしの実行予定プレビュー）
- スキーマ検証付き JSON インポート／エクスポート
- ローカル操作ログ
- 単体テストと CI による禁止文字列・権限検査

---

## 5. ライセンス上の措置

上流は MIT License であり、コード流用そのものは著作権表示の保持を条件に許諾される。

本プロジェクトは**コードを流用していない**が、DOM 構造に関する知見の出所が上流であることを明示するため、以下を保持する。

- `NOTICE.md` — 上流リポジトリ、ライセンス、監査対象 commit、監査日を記載（作成済み）
- `LICENSE` — 本プロジェクト自身の MIT License
- 本ドキュメント — 何を採用し何を採用しなかったかの判断根拠

上流コードを将来的に流用する場合は、該当ファイル冒頭に上流の著作権表示（`Copyright (c) 2026 yurtools`）と MIT 許諾文を記載すること。

---

## 6. 上流利用者への注意（参考）

本監査の副産物として、上流をそのまま利用する場合のリスクを記録しておく。

- 上流は ChatGPT の認証トークンを `chrome.storage.session` に保存する。拡張機能の権限を持つ他のコードから読み取れる状態になる。
- 上流の削除機能は `is_visible: false` を送る。ChatGPT UI 上は復元手段が限られるため、誤操作の影響が大きい。
- 上流 README には「作者はコードを一切手書きしておらず、生成物をそのまま公開している」と明記されている。レビュー前提での利用が想定されている。

これらは本プロジェクトが上流をフォークではなくクリーン実装として再構築した理由でもある。
