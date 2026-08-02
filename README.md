# chat-vault-operator

AI会話の棚卸し・Vault反映・安全なアーカイブを支援する Chrome 拡張（Manifest V3）。

---

## 第1段階の安全境界

**このリリースは ChatGPT に対していかなる変更も行いません。**

ChatGPT のサイドバーに表示されている会話の**メタデータのみ**をローカルに棚卸しし、
Vault への反映状況を記録し、アーカイブ候補を選定して **Dry Run（実行計画のプレビュー）**
までを行います。実際のアーカイブ実行は次フェーズです。

- 外部への通信は一切ありません（CSP `connect-src 'none'` でブラウザが強制遮断）
- 会話本文は読み取りも保存もしません
- 削除機能はスコープ外であり、実装予定もありません

## 実装しないもの（禁止事項）

| 項目 | 状況 |
| --- | --- |
| ChatGPT 会話の削除 / 一括削除 / Delete ボタン | 恒久的にスコープ外 |
| ChatGPT の非公開内部 API・`backend-api` | 使用しない |
| Authorization ヘッダー / Bearer トークン / Cookie の取得 | 行わない |
| `chrome.webRequest` / `chrome.identity` | 要求しない |
| `<all_urls>` | 要求しない |
| 外部分析・テレメトリー・広告・課金確認 | 実装しない |
| 開発者所有サーバーへの通信 | 存在しない |
| リモートコード実行 | 存在しない |
| 会話本文の保存 | 行わない |
| 実際のアーカイブ実行 | 第1段階では未実装 |

これらは善意ではなく、**CI で機械的に検査されています**
（`npm run check:forbidden` / `npm run check:manifest` および単体テスト）。

## クイックスタート

```bash
npm ci
npm run verify   # lint + typecheck + test + build + 禁止文字列検査 + Manifest検査
npm run build    # dist/ を生成
```

Chrome で `chrome://extensions/` を開き、デベロッパーモードを有効にして
**「パッケージ化されていない拡張機能を読み込む」から `dist/` フォルダを選択**します
（リポジトリのルートでも `extension/` でもありません）。

詳細は [docs/runbook.md](docs/runbook.md) を参照してください。

## Chrome 権限

| 権限 | 用途 |
| --- | --- |
| `storage` | `chrome.storage.local` への保存（唯一の永続化先） |
| `sidePanel` | 唯一の UI サーフェスであるサイドパネルの表示 |
| `scripting` | 「スキャン」を押したときにのみ、読み取り専用リーダーをオンデマンド注入 |
| `host_permissions: https://chatgpt.com/*` | 対象サイトの限定 |

`activeTab` は要求していません。`host_permissions` で chatgpt.com にスコープ済みのため、
追加しても未使用の宣言になるだけだからです。

`content_scripts` の宣言はありません。chatgpt.com を開いただけでは何も実行されず、
ユーザーが明示的に「スキャン」を押した瞬間にのみリーダーが注入されます。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/status.md](docs/status.md) | **現在地サマリ — 今どこまで出来ていて、今すぐ何ができるか** |
| [docs/architecture.md](docs/architecture.md) | 設計・データモデル・状態遷移・レイヤー分離 |
| [docs/upstream-assessment.md](docs/upstream-assessment.md) | 上流 OSS の監査結果と流用可否の判断根拠 |
| [docs/privacy-model.md](docs/privacy-model.md) | 何を保存し何を保存しないか、権限の根拠、検証方法 |
| [docs/runbook.md](docs/runbook.md) | ビルド・Chrome への読み込み・日常運用・トラブルシューティング |

## 主な機能

- ChatGPT サイドバー DOM からの会話メタデータ取得（内部 API 不使用・ページ改変なし）
- `chrome.storage.local` へのローカル保存
- Vault 反映状態の管理（参照先・短いメモ付き）
- アーカイブ候補の管理と**承認ゲート**
  （`reflected` または `not_required` でなければ `approved` にできない）
- 既定の候補除外（現在開いている会話 / 当日開始 / Project 配下 / 一意識別不能）
- Dry Run による実行予定件数と除外理由の事前確認（副作用なし）
- スキーマ検証付き JSON インポート／エクスポート（会話本文を含まない・失敗時は既存データ不変）
- ローカル操作ログ

## ライセンスと帰属

本プロジェクトは MIT License です（[LICENSE](LICENSE)）。

設計にあたり、以下の上流 OSS を**参照専用**として監査しました。

- yurtools/gpt-conv-manager-chrome — MIT License
- commit `8b7e7c55f4e72f186e90eab6fd288e0ee7e6da51`

上流の危険な処理（`chrome.webRequest` による Bearer トークン傍受、`backend-api` への
認証済みリクエスト、会話削除）とは密結合していたため、**コードは流用せずクリーン実装**
しています。ChatGPT の DOM 構造に関する知見の出所は上流であるため、MIT の著作権表示を
[NOTICE.md](NOTICE.md) に保持しています。

判断の詳細は [docs/upstream-assessment.md](docs/upstream-assessment.md) を参照してください。
