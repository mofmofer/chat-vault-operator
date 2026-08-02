# 運用手順書 (Runbook)

このドキュメントは chat-vault-operator の日常運用手順をまとめたものです。

**前提：このリリース（第1段階）は ChatGPT に対する変更を一切行いません。**
アーカイブ実行と削除は実装されていません。

---

## 1. 前提環境

- Node.js 20 以上
- Chrome 116 以上（`chrome.sidePanel` API が必要）
- ChatGPT (chatgpt.com) にログイン済みであること

---

## 2. ビルド

```bash
npm ci
npm run verify   # lint + typecheck + test + build + 禁止文字列検査 + Manifest検査
npm run build    # dist/ を生成
```

`npm run verify` が通らない状態のものを Chrome に読み込まないでください。

個別に実行する場合：

```bash
npm run lint            # ESLint
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run build           # esbuild で dist/ を生成
npm run check:forbidden # 禁止文字列・外部URL検査
npm run check:manifest  # Chrome権限のAllowlist検査
```

---

## 3. Chrome への読み込み

1. Chrome で `chrome://extensions/` を開く
2. 右上の **デベロッパーモード** を有効化
3. **パッケージ化されていない拡張機能を読み込む** をクリック
4. **`dist/` フォルダを選択する**

> **重要：`dist/` を選択してください。**
> リポジトリのルートでも `extension/` でもありません。
> `extension/src/` は TypeScript のままなので Chrome は読み込めません。
> `dist/` はビルドのたびに再生成されるため、コード変更後は `npm run build` を実行し、
> `chrome://extensions/` で拡張機能の再読み込みボタンを押してください。

読み込み後、権限表示が以下であることを確認してください。

- サイト：`chatgpt.com` のみ
- それ以外のサイトへのアクセス権限が表示される場合は読み込まないでください

---

## 4. 日常の運用手順

### 手順の全体像

```text
chatgpt.com を開く
   ↓
サイドパネルを開く
   ↓
「サイドバーをスキャン」
   ↓
会話一覧を確認
   ↓
Vault反映状態を記録（参照先・メモ）
   ↓
アーカイブ候補に追加
   ↓
承認 (approved)
   ↓
Dry Run で実行予定件数を確認
   ↓
（次フェーズ：アーカイブ実行）
```

### 4.1 スキャン

1. chatgpt.com のタブを開く
2. ツールバーの拡張機能アイコンをクリックしてサイドパネルを開く
3. **サイドバーをスキャン** をクリック

スキャンは**画面に表示されている範囲のサイドバーのみ**を読み取ります。
ページの自動スクロールは行いません。古い会話も取り込みたい場合は、
ChatGPT のサイドバーを手動でスクロールしてからスキャンしてください。

スキャン結果には「新規 / 更新 / 識別不能」の件数が表示されます。
**識別不能**は、リンクから `conversation_id` を一意に取得できなかったものです。
これらは意図的に取り込まれません。

### 4.2 Vault反映状態の記録

1. 会話一覧で対象を複数選択
2. 「選択した会話への操作」→ **Vault反映状態**
3. 状態を選択：
   - `unreviewed` — 未確認（初期値）
   - `reflection_required` — 反映が必要だが未実施
   - `reflected` — Vault へ反映済み
   - `not_required` — 反映不要と判断した
4. **反映先参照** に Vault ノートのパス、GitHub Issue の URL などを入力
5. **反映メモ** に短い説明を入力（会話本文を書かないこと）
6. **選択に反映状態を適用**

> 承認済みの会話の反映状態を `unreviewed` などに戻すと、承認は自動的に取り消され
> `candidate` に戻ります。これは意図的な安全動作です。

### 4.3 アーカイブ候補への追加

対象を選択して **条件を満たす会話を候補に追加** をクリックします。

以下は既定で候補から除外され、追加されません。

| 除外条件 | 理由 |
| --- | --- |
| 現在開いている会話 | 作業中の可能性が高い |
| 当日開始された会話 | まだ整理の判断ができない |
| Project 配下の会話 | Project の文脈に属し、単独での判断が危険 |
| ID または URL を一意に取得できない会話 | 誤対象を操作する危険がある |

除外されたものは理由付きで一覧表示されます。
個別に追加したい場合のみ、各行の **候補に追加** ボタンを使ってください。

### 4.4 承認

対象を選択して **選択を承認 (approved)** をクリックします。

**承認できるのは `reflected` または `not_required` の会話だけです。**
それ以外は拒否され、理由が表示されるとともに操作ログに `approval_rejected` が記録されます。

承認の取り消しは **承認を取り消し** で行えます（`candidate` に戻ります）。

### 4.5 Dry Run

**Dry Run** タブ →「Dry Run を実行」。

表示される内容：

- 実行予定件数（ヘッドライン）
- 実行対象／除外の各行について：タイトル、会話ID、URL、作成日時、Project情報、
  Vault反映状態、反映先参照、アーカイブ状態、除外理由

Dry Run は**表示のみ**で、いかなる状態も変更しません。
承認済みであっても、その後に Project へ移動された、現在開いている、といった条件は
Dry Run 時点で再評価されるため、承認後に状況が変わった会話は除外されます。

**運用上、Dry Run の実行予定件数が想定と一致することを必ず確認してください。**

---

## 5. バックアップと復元

### エクスポート

**データ** タブ →「JSONをダウンロード」。

- 保存先はブラウザの通常のダウンロード先（ローカルディスク）です
- **会話本文は含まれません**。メタデータと反映状態のみです
- アップロードは一切行われません

### インポート

**データ** タブ → ファイル選択。

- スキーマ検証を行い、壊れた JSON・未知の列挙値・会話本文らしきフィールドは拒否します
- **検証に失敗した場合、既存データは一切変更されません**（部分適用は起きません）
- マージは `conversation_id` をキーに行います
- 同一 ID が存在する場合はインポート側の値で更新されますが、
  `last_observed_at` と `operation_attempts` は新しい方／大きい方が保持されます

---

## 6. 操作ログ

**操作ログ** タブで、ローカルに記録された操作履歴を確認できます。

- 保存先は `chrome.storage.local` のみ
- 上限 500 件（超過分は古いものから破棄）
- 記録されるのはメタデータのみ。会話本文は含まれません
- 「ログを消去」はログのみを消去し、会話データには影響しません

---

## 7. トラブルシューティング

### 「chatgpt.com のタブが見つかりません」

chatgpt.com を開いてから再実行してください。
拡張機能は `https://chatgpt.com/*` 以外のタブにはアクセスできません。

### スキャンしても 0 件

考えられる原因：

1. ChatGPT のサイドバーが折りたたまれている → 展開してから再スキャン
2. ChatGPT が DOM 構造を変更した

2 の場合、修正が必要なのは **`extension/src/content/sidebar-reader.ts` だけ** です。
このファイルが DOM 依存を封じ込めており、識別・日付・承認のロジックはすべて
`extension/src/domain/` の純粋関数側にあります。

確認手順：

1. chatgpt.com で DevTools を開く
2. コンソールで `document.querySelectorAll('a[href^="/c/"]').length` を実行
3. 0 なら会話リンクのセレクタが変わっている
4. `sidebar-reader.ts` の `collectSidebarLinks()` のセレクタを更新する
5. `npm test` で `domain/` 側のテストが引き続き通ることを確認する

### 「識別不能」が多い

リンクから `conversation_id` を一意に取得できなかったものです。
ChatGPT の URL 形式が変わった可能性があります。
`extension/src/domain/conversation-url.ts` の対応形式を確認してください。
**取り込まれていないだけで、データが壊れているわけではありません。**

### 保存データを直接確認したい

1. `chrome://extensions/` で本拡張機能の「Service Worker」または
   サイドパネルの DevTools を開く
2. Console で以下を実行

```js
chrome.storage.local.get(['cvo.conversations', 'cvo.operation_log']).then(console.log)
```

### スキャン結果を解釈できない

ChatGPT のページを再読み込みしてから再スキャンしてください。
それでも解消しない場合は `npm run build` をやり直し、
`chrome://extensions/` で拡張機能を再読み込みしてください。

---

## 8. このリリースに含まれないもの

以下は**第1段階では実装されていません**。

| 項目 | 状況 |
| --- | --- |
| アーカイブの実行 | 未実装。ボタンは「次フェーズ」として無効化 |
| 会話の削除 | **恒久的にスコープ外**。実装予定なし |
| 一括削除 | **恒久的にスコープ外** |
| Project 配下会話の個別管理 | 観測と除外のみ。操作対象外 |
| ChatGPT 側の状態との突合 | 未実装（`archive_observed` / `reconciliation_required` は次フェーズ用） |
| 会話本文の取得・保存 | **恒久的にスコープ外** |
| 外部サーバーとの同期 | **恒久的にスコープ外** |

`archive_requested` / `archive_observed` / `reconciliation_required` の 3 状態は
次フェーズ用に予約されており、このリリースのコードからは書き込まれません。

---

## 9. 安全性の自己検証

利用者自身で以下を確認できます。

```bash
npm run check:forbidden  # backend-api / Bearer / webRequest / 外部URL などの混入検査
npm run check:manifest   # 権限がAllowlist内か、<all_urls>がないか
npm test                 # 承認ゲート・除外条件・JSON検証などの単体テスト
```

さらに `dist/` の出力は**意図的に minify されていません**。
実際に Chrome で動作するコードをそのまま読んで確認できます。
