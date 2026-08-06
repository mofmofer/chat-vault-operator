# chat-vault-operator

Android版Chromeを中心に、ChatGPTの会話を複数選択して安全にアーカイブするためのツールです。

## 現在の提供形態

Android版Chromeは拡張機能をインストールできないため、MVPは**自己完結型ブックマークレット**として提供します。PC版Chromeでも同じブックマークレットを使用できます。

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

ローカルで `npm run build` を実行し、`dist/chat-vault-operator-mini-bookmarklet.txt` の内容をコピーします。Android ChromeのURL欄で途中切れしにくいよう、軽量版は1万文字未満をCIで保証します。

1. Android版Chromeで任意のページをブックマークします。
2. ブックマークを編集し、名前を `Chat整理`、URLをコピーした内容へ置き換えます。
3. 保存後、URL欄の先頭が `javascript:`、末尾が `));` になっていることを確認します。
4. `https://chatgpt.com`へログインします。
5. ChatGPTページを開いたままアドレスバーに `Chat整理` と入力し、候補に表示されるブックマークを選択します。

ブックマーク一覧から直接開くのではなく、ChatGPTページ上でアドレスバーの候補から実行してください。

## セキュリティ方針

- ChatGPTのアクセストークンはメモリ上でのみ使用
- LocalStorage、IndexedDB、Cookieへの独自保存なし
- 外部サーバーへの送信なし
- 会話本文を取得しない
- アーカイブ対象と件数を実行前に確認
- 通常は最大3件だけ並列実行し、利用制限検知後は逐次実行

## 開発

```bash
npm ci
npm run check
```

生成物:

- `dist/chat-vault-operator.js`: フル版の実行コード
- `dist/chat-vault-operator-bookmarklet.txt`: フル版ブックマークレット
- `dist/chat-vault-operator-mini.js`: Android Chrome向け軽量版
- `dist/chat-vault-operator-mini-bookmarklet.txt`: Android ChromeのURL欄へ貼り付ける軽量版

## 技術上の注意

このツールはOpenAIが外部向けに保証している管理APIではなく、ChatGPT Webが利用する内部APIに依存します。ChatGPT側の仕様変更により動作しなくなる可能性があります。

## Attribution

会話一覧取得、認証ヘッダー、アーカイブ、レート制限処理の設計は、MIT Licenseの [`pionxzh/chatgpt-exporter`](https://github.com/pionxzh/chatgpt-exporter) を参考にしています。詳細は `THIRD_PARTY_NOTICES.md` を参照してください。

## License

MIT
