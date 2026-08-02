# privacy-model

## ハードな保証: 外部通信は一切行わない

chat-vault-operator はどこにも通信しません。すべてのデータはユーザー自身のマシン上の `chrome.storage.local` にのみ保存されます。サーバーもバックエンドも同期ストレージ（`chrome.storage.sync`）も存在しません。この保証は `extension/manifest.json` の Content Security Policy（`connect-src 'none'`）、`scripts/check-forbidden.mjs` によるソースコード全文スキャン、`scripts/check-manifest.mjs` による権限監査という3段構えで機械的に検証されています。

## 保存するもの

- 会話 id（`conversation_id`。サイドバーリンクの href から抽出した UUID）
- URL（正規化済みの chatgpt.com 上の会話 URL）
- サイドバーのタイトル（`title`）
- 粗い日付（`created_at`。"Today"/"Yesterday" のみ具体的な日付になり、それ以外は `null`）
- project id（ChatGPT Project 所属を示す `g-p-<32hex>`、または `null`）
- ローカルで作成する反映・アーカイブ用のブックキーピング情報（`reflection_status`・`reflection_reference`・`reflection_summary`・`archive_status`・`approved_at` など）

**タイトルについて明示しておきます。** `title` は ChatGPT がサイドバー上に表示するために生成したラベルであり、会話本文そのものではありません。それでもこの拡張はタイトルを保持します。オペレーターがどの会話を反映・候補化・承認するか判断するために、タイトルという最小限の手がかりが必要だからです。しかし、それ以外の情報はページから一切読み取りません。

## 絶対に保存しない、そもそも読み取らないもの

- 会話本文（プロンプト・応答のテキスト）
- 添付ファイル
- アカウント識別子
- 認証トークン
- Cookie

これは `extension/src/shared/types.ts` の型定義自体が強制しています。`ConversationRecord` にはこれらを保持するフィールドが存在せず、`extension/src/storage/serialization.ts` のインポート検証はさらに一歩進んで、`body` / `content` / `message` / `messages` / `text` / `transcript` / `parts` / `prompt` / `completion` といった「会話本文らしきフィールド名」を明示的な禁止リスト（`FORBIDDEN_KEYS`）として弾きます。

## 権限ごとの正当化

`extension/manifest.json` が要求する権限は次の3つだけです。

| 権限 | 理由 |
| --- | --- |
| `storage` | `chrome.storage.local` へのローカル永続化のため。 |
| `sidePanel` | この拡張の唯一の UI サーフェスである side panel を表示するため。 |
| `scripting` | ユーザーが「スキャン」を押したときにだけ、chatgpt.com のタブへ読み取り専用のリーダースクリプトをオンデマンドで注入するため。 |

`host_permissions` は `["https://chatgpt.com/*"]` のみです。

**`activeTab` は要求していません。** `host_permissions` によって chatgpt.com へのアクセスはすでにスコープされているため、`activeTab` を追加しても得られる権限は増えず、単に未使用の宣言になるだけだからです。

**`webRequest` / `identity` / `cookies` / `tabs` / `<all_urls>` も要求していません。** この拡張はネットワークリクエストを傍受・改変せず（`webRequest` 不要）、ユーザー認証やアカウント連携を一切行わず（`identity` 不要）、Cookie を読み書きせず（`cookies` 不要）、chatgpt.com 以外のタブを操作・列挙する必要がなく（`tabs` 不要）、chatgpt.com 以外のオリジンに触れる理由がありません（`<all_urls>` 不要）。これらは `scripts/check-manifest.mjs` が権限のアローリストと `host_permissions` の完全一致、`<all_urls>` の不在をチェックすることで機械的に保証されています。

## content script はオンデマンド注入のみ

`extension/manifest.json` に `content_scripts` の宣言はありません。つまり chatgpt.com を開いただけでは何も実行されません。サイドバーリーダーは `scripting` 権限を使って、ユーザーが side panel で「Scan」を押した瞬間にだけ注入されます。ユーザーの操作なしに chatgpt.com 上でコードが走ることはありません。

## 拡張ページの CSP

`extension_pages` の CSP は `script-src 'self'; object-src 'self'; connect-src 'none'` です。`connect-src 'none'` は側パネル UI（および将来追加されうる拡張ページ）からの `fetch`・`XMLHttpRequest`・`WebSocket` などあらゆる outbound 接続をブラウザ自身に強制的にブロックさせます。これはコードレビューや善意に依存しない、ブラウザレベルで機械的に強制されるハードな遮断です。

## データのエクスポート/インポート

エクスポートは `extension/src/storage/serialization.ts` の `buildExport()` が JSON を組み立て、side panel UI がそれをユーザー自身のディスクへ Blob ダウンロードとして書き出します。データがどこかへアップロードされることはありません。

インポートは `parseImport()` によって厳格に検証されます。スキーマバージョン、型、enum 値、`conversation_id` と `url` の整合性（`parseConversationUrl` による再検証）をすべてチェックし、前述の「会話本文らしきフィールド名」も拒否します。検証に1件でも失敗があれば、インポート全体が失敗として扱われ **既存のローカル状態は一切変更されません**（`parseImport` は純粋関数で、ストレージに触れません）。

## operation log

`cvo.operation_log` はローカルのみに保存され、`OPERATION_LOG_LIMIT = 500` 件で上限されたメタデータのみのログです。各エントリは種別（`scan` / `reflection_updated` / `approved` / `dry_run` など）・対象の `conversation_id`・短い `detail` 文字列のみを保持し、会話本文を含めてはならないという制約がコード上のコメントで明記されています。

## 自分で検証する方法

この文書の主張を鵜呑みにする必要はありません。以下はすべてユーザー自身が実行できます。

- `npm run check:forbidden` — ソースコード全体（`extension/` と `dist/`）を走査し、`fetch(` や `Authorization` のような禁止パターン、chatgpt.com 以外へのハードコードされた絶対 URL がないことを機械的に確認します。
- `npm run check:manifest` — `manifest.json` の権限・`host_permissions`・`<all_urls>` の不在などを検証します。
- `npm test` — domain/storage の純粋関数群に対するユニットテストを実行します。
- `dist/` 配下の出力を直接読む — `npm run build` は minify をかけないため、実際に読み込まれるコードはそのまま人間が読める形で `dist/` に出力されます。難読化・圧縮による「隠しどころ」は存在しません。
