# architecture

## 目的とフェーズ1の境界

chat-vault-operator は、ChatGPT の会話一覧（サイドバー）をスキャンして会話の **メタデータ**（id・URL・タイトル・大まかな日付・project 所属）を `chrome.storage.local` に棚卸しし、各会話について「Vault（個人のナレッジ管理）への反映状況」を記録し、アーカイブ候補を選定して Dry Run（実行計画のプレビュー）を行うための Chrome MV3 拡張です。

**フェーズ1の境界は厳格です。このリリースは会話を一切アーカイブしません。** アーカイブの「実行」（`archive_status` を `archive_requested` / `archive_observed` / `reconciliation_required` に進める処理）は実装されておらず、`extension/src/domain/approval.ts` の `PHASE_2_ARCHIVE_STATUSES` としてコード上も明示的に将来フェーズ用として予約されています。フェーズ1が提供するのは、あくまで「棚卸し・記録・プレビュー」までです。

## レイヤー構成

データは一方向に近い形で、DOM から UI まで 4 層を流れます。

```
content script (DOM read-only)
        ↓  ObservedConversation / RawSidebarLink
   domain (pure functions)
        ↓  ConversationRecord / DryRunPlan / ...
   storage (chrome.storage.local)
        ↓
   side panel UI
```

- **content script（`content/`）**: chatgpt.com のサイドバー DOM を読み取るだけの層。DOM 依存のコードはこの層に隔離されており、ChatGPT 側のマークアップ変更に追従する必要が生じたときも、直すべき場所はここだけに閉じ込められています。
- **domain（`extension/src/domain/*.ts`）**: 識別・日付解釈・承認ルール・除外ルールなど、拡張の判断ロジックはすべてこの層の **純粋関数** として実装されています。ブラウザ API に依存しないため、ユニットテストだけで検証できます。
- **storage（`extension/src/storage/*.ts`）**: 唯一の永続化先である `chrome.storage.local` への読み書きと、エクスポート/インポートのシリアライズ・検証を担当します。
- **side panel UI（`sidepanel/`）**: 上記の結果を人間向けに表示し、操作（スキャン・反映記録・候補追加・承認・Dry Run）を発火させる層です。

この構成の要となる「継ぎ目（seam）」は `extension/src/domain/sidebar-extract.ts` の `extractScanResult` です。content script は生の DOM 情報（`RawSidebarLink`: href・表示タイトル・直近の日付見出し）を渡すだけで、そこから「これは有効な会話か」「project 所属か」「日付はいつと見なすか」といった判断はすべて `extractScanResult` 以降の純粋な domain コードが行います。これにより、ChatGPT の DOM 構造が変わっても domain 層のテストは一切壊れず、直すのは抽出側だけで済みます。

## データモデル

### `ConversationRecord`（`extension/src/shared/types.ts`）

| フィールド | 意味 |
| --- | --- |
| `conversation_id` | 会話の一意な識別子。サイドバーリンクの `href` から抽出した UUID（`extension/src/domain/conversation-url.ts`）。 |
| `url` | 正規化された会話 URL（クエリ・フラグメントなし）。 |
| `title` | サイドバーに表示されるタイトル。ChatGPT が生成したラベルであり、会話本文ではない。 |
| `created_at` | ISO-8601、またはサイドバーの日付バケットから導出できない場合は `null`。 |
| `updated_at` | ISO-8601 または `null`。ローカルでのレコード更新時刻（例: 反映状況の変更時）。 |
| `project_id` | 所属する ChatGPT Project（gizmo）の正規 id（`g-p-<32hex>`）。所属しない場合は `null`。 |
| `reflection_status` | Vault への反映状況（下記 enum）。 |
| `reflection_reference` | Vault のノートパス・GitHub issue URL・チケット id など、オペレーターが自由入力する参照情報。ローカルのみ。 |
| `reflection_summary` | オペレーターが書く短いメモ。会話本文は絶対に入らない。 |
| `reflection_completed_at` | 反映状況が「満たされた」状態になった時刻。 |
| `archive_status` | アーカイブ状態（下記 enum）。 |
| `approved_at` | 承認された時刻、または `null`。 |
| `archived_at` | アーカイブされた時刻。フェーズ1では常に `null`。 |
| `last_observed_at` | 最後にスキャンで観測された時刻。 |
| `operation_attempts` | 操作試行回数（非負整数）。フェーズ2の実行処理向けのカウンタ。 |
| `error_code` | 直近のエラーコード、または `null`。 |
| `error_message` | 直近のエラーメッセージ、または `null`。 |

### `ReflectionStatus`

`unreviewed`（未確認） / `reflection_required`（反映が必要と判断済み、未着手） / `reflected`（Vault に反映済み） / `not_required`（反映不要と判断済み）

### `ArchiveStatus`

`active` / `candidate` / `approved` / `archive_requested` / `archive_observed` / `reconciliation_required`

## 状態遷移（フェーズ1が許可するもの）

フェーズ1が実際に書き込むのは次の遷移のみです（`extension/src/domain/approval.ts`）。

- `active ↔ candidate`（`markCandidate` / `unmarkCandidate`）
- `candidate → approved`（`approve`。承認ゲートを満たした場合のみ）
- `approved → candidate`（`revokeApproval`。承認はいつでも取り消し可能）

一方、`archive_requested` / `archive_observed` / `reconciliation_required` の 3 状態は **フェーズ2専用として予約** されており、このリリースのコードパスはどれもこれらを書き込みません（`PHASE_2_ARCHIVE_STATUSES` 定数）。これらは将来、実際に ChatGPT 側でのアーカイブ実行結果を観測できるようになったときに初めて使われる想定です。

## 承認ゲート

`candidate → approved` には `canApprove()` によるゲートがあります。ゲートを通過できるのは、`reflection_status` が `reflected` または `not_required` のとき（`isReflectionSatisfied` / `APPROVABLE_REFLECTION_STATUSES`）だけです。

これは phase 1 における最も重要な安全ルールです。オペレーターが「Vault に反映した」または「反映不要と明示的に判断した」と記録しない限り、その会話は承認されません。逆に、承認済みの会話の反映状況が後から未確定な状態に引き下げられた場合、`setReflection()` は承認を自動的に取り消し `candidate` に戻します（反映が崩れたまま承認だけが残ることを防ぐため）。

## デフォルトの候補除外（4種類）

`evaluateExclusions()`（`extension/src/domain/candidates.ts`）は、一括操作で誤って候補に入れてしまうことを防ぐための **デフォルト除外** を4つ判定します。これらはロックではなく既定値であり、オペレーターは個別に意図して候補指定できますが、一括操作では自動的にスキップされます。

| 除外理由 | 条件 | 保守的である理由 |
| --- | --- | --- |
| `currently_open` | 今アクティブなタブで開いている会話 | 開いたまま操作対象にすると事故が起きやすいため |
| `started_today` | `created_at` が「今日」と同じローカル日付 | 直近着手した会話をまだ Vault に反映する前に候補化しないため |
| `in_project` | `project_id` が非 `null` | Project 配下の会話は個別の扱いが必要という前提を崩さないため |
| `unidentifiable` | `conversation_id` が空、または URL 再パース結果と一致しない | 識別が保証できない会話を誤って操作しないため |

## Dry Run の意味

`buildDryRunPlan()` / `evaluateDryRunRow()`（`extension/src/domain/dry-run.ts`）は「もしアーカイブ実行が存在したら、今この瞬間に何が対象になるか」を答えるレポートです。

- 承認済み（`archive_status === 'approved'`）であっても、Dry Run は除外条件を **再評価** します。承認は数日前に行われている可能性があり、その間に会話が Project に移動した、あるいは今まさに開かれているタブになった、といった事実の変化がありうるためです。
- Dry Run はレポートを組み立てるだけで、**保存済みレコードに対する副作用は一切ありません**。

## 識別ポリシー

会話の識別（identity）は **リンクの `href` のみ** から導出され、タイトルは一切使いません（`extension/src/domain/conversation-url.ts` のコメントに明記）。ChatGPT はタイトルの重複を許しており、2つの異なる会話が同じタイトルを持つことは珍しくないため、タイトルを識別に使うと誤って別会話を同一視してしまう危険があります。

## `created_at` の精度に関する注意

`created_at` はサイドバーの粗い日付バケット（"Today" / "Yesterday" / それ以外）から導出されます（`extension/src/domain/sidebar-extract.ts` の `createdAtFromBucket`）。

- 実際に日付へ変換されるのは **"Today" と "Yesterday" の2バケットのみ**。それ以外（"Previous 7 days" など)は `null` になります。曖昧なバケットから日付を推測すると、"started_today" の安全ルールに誤ったデータを渡しかねないためです。
- ChatGPT のサイドバーは「作成日」ではなく「直近の活動」でグルーピングしています。したがって "Today" を「今日作成された」と読み替えるのは技術的には不正確ですが、それは意図的に保守的な解釈です。誤りがあるとしても、会話を候補から外す方向にしか働かない（候補に押し込む方向には働かない）ため安全側に倒れます。

## ストレージキーと operation log の上限

`chrome.storage.local` に保存されるキーは2つだけです（`extension/src/storage/local-store.ts`）。

- `cvo.conversations` — `conversation_id` をキーとした `ConversationRecord` の連想配列
- `cvo.operation_log` — `OperationLogEntry` の配列

operation log は無制限に増え続けないよう `OPERATION_LOG_LIMIT = 500` 件で上限が設けられており（`extension/src/storage/operation-log.ts`）、新しいエントリが先頭に追加され、上限を超えた古いエントリから捨てられます（`appendLog`）。エントリの `detail` は呼び出し側が書く短いメタデータ文字列で、会話本文を含めてはならないという制約がコード上のコメントに明記されています。

## ビルドと拡張の読み込み

ビルド手順と Chrome への読み込み手順は `docs/runbook.md` を参照してください。
