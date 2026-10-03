# COMPLETENESS_ENGINE

実装：`src/shared/completeness.ts`。**決定的**（同じ入力→同じ出力）。AIは「未解決候補の件数」を入力として渡すだけで、AI単独でReadyにはできない。

## 必要項目（Required Item）
`{ id, label, type: 'question'|'file', required, questionIds?, minCount?, maxCount?, acceptedFormats?, maxSizeMB?, requireReview?, dueOffsetDays?, notes?, category? }`
- 必須の質問でどの項目にも属さないもの、およびルールで必須化され得る質問は、暗黙の項目 `q:<questionId>` として数える。

## ステータス
| status | 質問項目 | ファイル項目 |
|---|---|---|
| missing 未提出 | 有効回答0 | 有効ファイル0 |
| partial 一部提出 | 一部の質問のみ回答 | 0 < 件数 < minCount（例 3/5） |
| submitted 提出済み（確認待ち） | 全回答・要レビュー | 件数 ≥ min・未承認あり |
| needs_review 要確認 | レビュアーが要確認に | 同左 |
| accepted 承認済み | 全回答＋（自動承認 or レビュー承認） | 承認件数 ≥ min（requireReview=false なら件数 ≥ min） |
| rejected 差し戻し | レビューで差戻（回答変更で解除） | 項目差戻、または全ファイル差戻 |
| not_applicable 対象外 | 条件で非表示 or 内部で対象外 | 同左 |

Upload = Accepted としない（`requireFileReview` 既定 true）。

## 進捗（分母/分子を明示）
- 分母：**表示中かつ必須**の項目数（非表示・対象外は除外）。
- 分子（提出率）：submitted / needs_review / accepted の件数。承認率：accepted の件数。
- 例：必要項目7件中5件提出 → `floor(5/7×100) = 71%`。partial は分子に含めない（3/5 は件数で別表示）。
- 意味不明なAIスコアは使わない。

## Ready判定（ready.reasons が空のとき Ready）
1. `ITEM_NOT_ACCEPTED`：表示中の必須項目がすべて accepted
2. `INVALID_ANSWER`：表示中の質問に形式エラーがない
3. `AI_UNRESOLVED`：未解決のAI候補（追加質問候補・曖昧・矛盾・不足）＋未確認の追加質問 が0件（`aiUnresolvedPolicy`: block 既定 / warn / ignore）
4. `SIGNOFF_REQUIRED`：内部担当者のサインオフ（`requireInternalSignoff` 既定 true）。サインオフは 1〜3 を満たすときのみ可能。

### Override
`ready.override` 権限（Owner/Admin/Manager）＋ **理由5文字以上必須**。`ready_override = { reason, actorId, actorName, at, unmet[] }` を保存し、監査ログ `case.ready_override` とレビュー履歴に記録。

### Ready後の再評価
必須情報（必要項目に属する質問・条件ルールの元質問）の回答変更、ファイル差し戻し、項目差し戻し/対象外変更時に `requiredChanged=true` で再計算し、**サインオフとoverrideを無効化**。条件を満たさなければ Ready を解除（`ready_at=NULL`、`case.ready_revoked` 監査＋通知）。

## ケースステータスの自動遷移
terminal（started/archived/cancelled）以外は毎回再計算：Ready → needs_client（差戻 or 未回答の追加質問） → needs_internal_review（全項目提出済み） → needs_client（クライアント送信済みだが未提出あり） → in_progress（入力あり） → sent（リンク発行済み） → draft。
