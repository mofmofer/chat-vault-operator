# 現在地サマリ (Status)

最終更新: 2026-08-02 / ブランチ: `agent/safe-local-mvp` / 未コミット

このドキュメントは「今どこまで出来ていて、今すぐ何ができるか」を1枚にまとめたものです。
設計の詳細は [architecture.md](architecture.md)、操作手順は [runbook.md](runbook.md) を参照してください。

---

## 1. 現在地

**第1段階（安全なローカルMVP）の実装が完了しています。**

ChatGPT に対する変更は一切行いません。会話のアーカイブ実行・削除は実装されていません。

| | 状態 |
| --- | --- |
| 実装 | 完了（35ファイル / 約4,500行） |
| テスト | 49 tests / 8 files すべて通過 |
| lint / typecheck | エラー 0 |
| ビルド | 成功（`dist/` 生成可能） |
| 禁止文字列検査 | 24ファイル走査 / 違反 0 |
| Manifest権限検査 | 7項目すべて PASS |
| CI | GitHub Actions 定義済み |
| Chrome への読み込み | **実機 Chrome 150 で確認済み**（manifest 受理・拡張機能ID発行） |
| ビルド成果物の動作確認 | **36項目確認済み**（`dist/` の実バンドルを DOM 上で実行） |
| 実 ChatGPT アカウントでの確認 | **未実施**（→ §6） |

---

## 2. 今すぐできること

`npm ci && npm run build` の後、`chrome://extensions/` で **`dist/` フォルダ**を
「パッケージ化されていない拡張機能」として読み込めば、以下がすべて動作します。

### 2.1 会話メタデータの棚卸し

- chatgpt.com のタブを開いた状態で **サイドバーをスキャン**
- ChatGPT の**サイドバーDOMから**会話リンクを取得（内部API不使用・ページ改変なし）
- 取得項目：`conversation_id` / `url` / `title` / 大まかな作成日時 / Project所属 / `last_observed_at`
- 会話IDは href から抽出。**タイトルでは会話を識別しません**（同名タイトルはIDで区別）
- IDを一意に取得できなかったリンクは取り込まず、件数を「識別不能」として報告
- 保存先は `chrome.storage.local` のみ

### 2.2 会話一覧の操作

- タイトル検索（部分一致・大文字小文字無視）
- `reflection_status` / `archive_status` によるフィルター
- チェックボックスによる複数選択、「表示中をすべて選択」「選択解除」
- 各行に反映状態・アーカイブ状態・Projectバッジ・除外理由バッジを表示

### 2.3 Vault反映状態の管理

- 4状態を選択・一括適用：`unreviewed` / `reflection_required` / `reflected` / `not_required`
- **反映先参照**の入力（Vaultノートのパス、GitHub Issue の URL など）
- **反映メモ**（短文）の入力
- 承認済みの会話の反映状態を下げると、**承認は自動的に取り消され `candidate` に戻ります**

### 2.4 アーカイブ候補の管理

- 選択した会話のうち、**既定の除外条件を満たさないものだけ**を一括で候補に追加
- 除外されたものは理由付きで一覧表示
- 個別に候補へ追加することも可能（各行のボタン、除外理由は表示したまま）
- 候補からの解除

**既定で候補から除外されるもの（4種）**

| 除外条件 | 理由 |
| --- | --- |
| 現在開いている会話 | 作業中の可能性が高い |
| 当日開始された会話 | まだ整理の判断ができない |
| Project 配下の会話 | Project の文脈に属し、単独判断が危険 |
| ID または URL を一意に取得できない会話 | 誤対象を操作する危険がある |

### 2.5 承認（安全ゲート）

- 選択した会話を `approved` へ変更、および承認の取り消し
- **`reflected` または `not_required` の会話のみ承認できます**
- 条件を満たさない場合は状態を変更せず、理由を表示して操作ログに `approval_rejected` を記録

### 2.6 Dry Run

- 「もし今アーカイブを実行したら何が対象になるか」を**副作用なしで**表示
- 表示項目：タイトル / 会話ID / URL / 作成日時 / Project情報 / Vault反映状態 /
  反映先参照 / アーカイブ状態 / 除外理由 / **実行予定件数**
- 承認済みでも、その後 Project へ移動された・現在開いている等は**再評価して除外**します

### 2.7 JSON インポート／エクスポート

- エクスポート：ローカルディスクへダウンロード（アップロードなし）
- **会話本文は含まれません**（許可キーのみを1件ずつ組み立てて出力）
- インポート：スキーマ検証を行い、壊れたJSON・未知の列挙値・未知フィールド・
  会話本文らしきフィールド（`messages`, `content`, `body` など）を拒否
- **検証に失敗した場合、既存データは一切変更されません**（部分適用なし）
- マージは `conversation_id` をキーに実施

### 2.8 ローカル操作ログ

- スキャン・反映状態変更・候補操作・承認・承認拒否・Dry Run・インポート／エクスポートを記録
- 上限500件、メタデータのみ（会話本文なし）
- ログのみの消去が可能（会話データには影響しません）

---

## 3. 今はできないこと

### 意図的に実装していない（第1段階の範囲外）

| 項目 | 状況 |
| --- | --- |
| アーカイブの実行 | 未実装。ボタンは「次フェーズ」として無効化（リスナー未接続） |
| ChatGPT側の状態との突合 | 未実装（`archive_requested` / `archive_observed` / `reconciliation_required` は次フェーズ用に予約、**現コードから一度も書き込まれません**） |

### 恒久的にスコープ外

会話の削除・一括削除、会話本文の取得と保存、ChatGPT非公開内部API（`backend-api`）、
Authorizationヘッダー／Bearerトークン／Cookieの取得、`chrome.webRequest`、`chrome.identity`、
`<all_urls>`、外部分析・テレメトリー・広告・課金確認、開発者所有サーバーへの通信、リモートコード。

### 仕様上の制約

- **画面に表示されている範囲のサイドバーしか読みません。**
  上流のような自動スクロールは行わないため、古い会話は手動でスクロールしてから再スキャンが必要です。
- `created_at` は**サイドバーの粗い日付見出し由来**です。`Today` / `Yesterday` のみ日付に変換し、
  `Previous 7 days` などは `null` のままです。また ChatGPT の見出しは「最終活動」基準のため、
  当日判定は**安全側（除外されやすい方向）**に倒しています。
- Project 配下の会話は**観測と除外のみ**で、操作対象にはしていません。

---

## 4. 安全性の現状

| 項目 | 実測結果 |
| --- | --- |
| Chrome権限 | `storage` / `sidePanel` / `scripting` のみ |
| host_permissions | `https://chatgpt.com/*` のみ |
| `activeTab` | **要求していません**（host_permissions で足りるため未使用の宣言になる） |
| `content_scripts` 宣言 | **なし**。chatgpt.com を開いただけでは何も実行されず、Scan押下時のみ注入 |
| CSP | `script-src 'self'; object-src 'self'; connect-src 'none'` |
| 外部通信 | **なし**。絶対URLは `https://chatgpt.com` のみ |
| 使用Chrome API | `sidePanel` / `action.onClicked` / `runtime.onInstalled` / `scripting.executeScript` / `tabs.query`（読取） / `storage.local` |
| chatgpt.com への書き込み経路 | **存在しません**（`tabs.update` / `tabs.reload` も不使用） |

検査スクリプトは**意図的な違反を注入して実際に検出することを確認済み**です
（`check-forbidden` が4件、`check-manifest` が3件を検出して exit 1）。常に通るだけの
見せかけの検査ではありません。

自己検証コマンド：

```bash
npm run check:forbidden  # 禁止文字列・外部URL検査
npm run check:manifest   # 権限Allowlist検査
npm test                 # 承認ゲート・除外条件・JSON検証など49件
```

`dist/` は意図的に minify していないため、実際に動くコードをそのまま読めます。

---

## 5. 上流OSSの扱い

上流 `yurtools/gpt-conv-manager-chrome`（MIT, commit `8b7e7c55…`）を参照専用で監査しました。

**コードは1行も流用していません。** 危険な処理（`chrome.webRequest` による Bearer 傍受、
`backend-api` への認証済みリクエスト、`is_visible: false` による会話削除）が
`sw.js` に集中し、UI もそれと密結合していたためです。

参照したのは**ChatGPTのDOM構造に関する事実**のみ（会話リンクのセレクタ形状、
Project canonical id が `g-p-`+32hex であること、日付見出しの位置）。表現ではありませんが
出所が明確なため、MIT の著作権表示を `NOTICE.md` に保持しています。

判断根拠の全文は [upstream-assessment.md](upstream-assessment.md) にあります。

---

## 6. 動作確認の範囲と、まだ確認できていないこと

### 確認済み

**実機 Chrome 150 での読み込み**

`dist/` を CDP `Extensions.loadUnpacked` で実際の Chrome 150 に読み込み、
**manifest が受理され拡張機能IDが発行されること**を確認しました。
manifest の妥当性と宣言ファイルの実在が保証されています。

**ビルド成果物の動作確認（36項目すべて PASS）**

`dist/` の**実バンドル**（Chrome が実行するのと同一のコード）を DOM 上で実行し、
以下を確認しました。

- content script が ChatGPT 風サイドバーから会話を抽出（4件）
- 不正リンク 1 件を「識別不能」として除外
- Project の canonical id を slug を除いて正しく取得
- `Today` は日付変換、`Previous 7 days` は `null`
- **同名タイトル 2 件が別IDとして保持される**
- 会話本文が観測結果に一切含まれない
- サイドパネル初期化 → スキャン → 保存 の一連の流れ
- **`unreviewed` の承認が拒否され、UI に理由が出る**
- 現在開いている会話・当日会話・Project 配下が一括候補追加から除外される
- `reflected` にすると承認が通り `approved_at` が記録される
- **反映状態を下げると承認が自動取り消しされる**
- Dry Run の実行予定件数が実際の対象行数と一致し、**副作用がない**
- アーカイブボタンが無効で、押しても何も変わらない
- 操作ログに `approval_rejected` が残り、会話本文を含まない

### 未確認

- **実際の ChatGPT アカウントでの動作は未確認です。** ログイン済みブラウザでの操作は
  自動化できないため、DOM セレクタが**現行の本物の ChatGPT の markup に一致するか**は
  実際に読み込んで確認する必要があります。**ここが唯一の実質的な残リスクです。**
  スキャン結果が 0 件の場合は [runbook.md の該当節](runbook.md#スキャンしても-0-件)を参照してください。
  修正が必要になるのは `extension/src/content/sidebar-reader.ts` のみです。
- 実際のサイドパネル UI（`chrome.sidePanel` で開いた状態）での目視確認は未実施です。
  Chrome 137+ が自動化からの拡張機能ページ遷移を禁止しているため、
  同一コードをページとして実行する形で代替しています。
- 拡張機能のアイコン画像は未同梱です（動作には影響しません）。

---

## 7. 次フェーズの作業

1. **アーカイブ実行**：`approved` → `archive_requested` → `archive_observed` の遷移実装
2. **ChatGPT側状態との突合**と `reconciliation_required` の運用設計
3. `operation_attempts` / `error_code` / `error_message` の実利用（リトライと失敗記録）

> **要設計判断：** 内部API不使用の方針を維持したままアーカイブを実行する手段が自明ではありません。
> UI操作の自動化を含めて、安全性と実現性のトレードオフを別途検討する必要があります。
> ここは実装に入る前に方針を決めるべき箇所です。
