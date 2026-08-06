# chat-vault-operator

Android版Chromeを中心に、ChatGPTの会話を複数選択して安全にアーカイブするツールです。

## 提供方式

Android版Chromeは拡張機能をインストールできないため、公開CDNと短いブックマークレットを組み合わせます。

1. ChatGPT上で短いブックマークレットを実行
2. 公開CDNの起動タブが固定コミットの実装コードを読み込む
3. `postMessage`でChatGPTタブへ実装コードを渡す
4. ChatGPTタブ上で一覧取得・アーカイブを実行

長い実装コードをChromeのブックマークURL欄へ直接保存しないため、途中切れを避けられます。GitHub Pagesの公開ワークフローも同梱していますが、短いランチャーはPages設定なしでも利用できます。

### 機能

- 通常チャットの一覧取得（最大2,000件）
- タイトル検索
- 表示中の全選択・選択解除
- 選択した会話の一括アーカイブ（通常は3件並列）
- HTTP 429発生時は自動的に1件ずつへ減速し、待機・再試行
- 通常失敗した会話だけを最後に1回再試行
- 成功・失敗件数の表示

意図しないデータ消失を避けるため、**削除機能は実装しません**。

## Android版Chromeへの導入

インストーラーまたはREADME記載の短いブックマークレットをコピーします。

1. Android版Chromeで任意のページをブックマークします。
2. ブックマークを編集し、名前を `Chat整理`、URLをコピーした内容へ置き換えます。
3. `https://chatgpt.com`へログインします。
4. ChatGPTページを開いたままアドレスバーに `Chat整理` と入力し、候補に表示されるブックマークを選択します。
5. 公開CDNのタブが一瞬開き、自動的に閉じた後、ChatGPT上に整理画面が表示されます。

## セキュリティ方針

- ChatGPTのアクセストークンはChatGPTタブのメモリ上でのみ使用
- LocalStorage、IndexedDB、Cookieへの独自保存なし
- 公開CDNへアクセストークンや会話データを送信しない
- 会話本文を取得しない
- アーカイブ対象と件数を実行前に確認
- 通常は最大3件だけ並列実行し、利用制限検知後は逐次実行
- ランチャーと実装コードは固定コミットを参照

## 開発

```bash
npm ci
npm run check
```

主なファイル:

- `src/chat-vault-operator-mini.js`: Android Chrome向け実装
- `docs/index.html`: インストーラー
- `docs/launch.html`: `postMessage`ランチャー
- `.github/workflows/pages.yml`: GitHub Pagesデプロイ

## 技術上の注意

このツールはOpenAIが外部向けに保証している管理APIではなく、ChatGPT Webが利用する内部APIに依存します。ChatGPT側の仕様変更により動作しなくなる可能性があります。

## Attribution

会話一覧取得、認証ヘッダー、アーカイブ、レート制限処理の設計は、MIT Licenseの [`pionxzh/chatgpt-exporter`](https://github.com/pionxzh/chatgpt-exporter) を参考にしています。詳細は `THIRD_PARTY_NOTICES.md` を参照してください。

## License

MIT
