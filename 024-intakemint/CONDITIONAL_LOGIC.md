# CONDITIONAL_LOGIC

実装：`src/shared/logic.ts`（ブラウザとサーバーで同一コード。サーバーが正）。

## ルール
```ts
{ id, when: Condition, then: [{ type: 'show'|'hide'|'require'|'unrequire', target: questionId|itemId }], status?: 'active'|'draft', origin?: 'human'|'ai' }
Condition = { questionId, op, value } | { all: [...] } | { any: [...] } | { not: ... }
op = eq | neq | in | contains | gt | gte | lt | lte | answered | not_answered
```
例（Web制作サンプル）：`site_purpose contains 'ec'` → EC質問（商品数・決済・配送・会員）を表示＆商品数・決済を必須化。`contains 'recruit'` → 採用質問（募集職種・応募フロー）。

## 評価
1. 各質問/項目の既定値：`visibleByDefault !== false`、`required`。
2. **非表示の質問の回答は「未回答」として条件評価に使う**（カスケード：非表示の質問に依存する質問も非表示）。
3. 変化がなくなるまで反復（上限＝質問数+項目数+2）。循環ルールは公開時に拒否されるため実運用では収束する。

## 循環検知
ルールの依存グラフ（条件の質問 → 対象）でDFSし、循環を `A → B → A` の形で返す。ビルダーで即時表示し、`publishTemplate` は循環があれば 400 で拒否（テスト #7）。

## 非表示回答の扱い（hiddenAnswerPolicy = retain_excluded）
- 回答は **削除せず保持**（条件が戻れば復元）。
- 進捗・Ready判定・バリデーション・案件開始パック・AI分析からは **除外**（`effectiveAnswers`）。
- 内部の回答タブでは「（非表示）」として薄く表示、CSVには `no(hidden)` で出力。

## AI生成ルール
AIが提案したルールは `status: 'draft', origin: 'ai'` で保存し、**有効化するまで評価しない**（テスト：draft rules ignored）。ビルダーに「有効化」ボタン。
