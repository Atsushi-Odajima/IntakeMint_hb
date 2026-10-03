# AI_REVIEW — Adaptive AI Interview / 不足・矛盾チェック

## 原則
- AIの出力は **すべて候補**（`ai_candidates`）。回答の自動修正・要件の自動確定・クライアントへの自動送信はしない。
- ReadyはDeterministic中心。AIだけで100% Readyにはならない（未解決候補は既定で Ready を止める）。
- 呼び出しは **AIゲートウェイ**（`services/ai.ts`）経由のみ。組織AI OFF / 案件AI OFF → プロバイダ呼び出し0（`ai_calls` 0件・テスト #23）。
- 外部AI（Anthropic）は `AI_PROVIDER=anthropic` + `AI_API_KEY` + `AI_ALLOW_EXTERNAL=true` の3条件が揃った時のみ。既定はローカル判定（外部送信なし）。
- ファイル単位のAI除外（テスト #12 / E2E-5）。非表示質問の回答はAIに渡さない。

## プロバイダ
| provider | external | 内容 |
|---|---|---|
| `local-heuristic`（既定） | なし | 決定的ルール：曖昧回答（「会社のサイトです」等の定型/短文）→ 主目的確認の追加質問候補（問い合わせ獲得/採用/会社案内/販売）、参考サイトの理由欠落、数量矛盾（「商品数10」vs「全25商品」）、はい/いいえと本文の矛盾、過去日付 |
| `anthropic` | あり | Messages API。JSONのみを要求し、**存在する質問IDを参照しない候補は破棄**（架空Requirement防止）。失敗時はローカル判定にフォールバック |

## 候補の種類と処理
| kind | 例 | 人間の操作 |
|---|---|---|
| follow_up | 主目的の確認 | 「確認して質問する」（文面編集可）→ ポータルに追加質問 |
| ambiguous | 参考にしたい点が未記入 | 質問する / 社内で解決 / 却下 |
| contradiction | 商品数10 vs 全25商品 | 質問する / 社内で解決 / 却下（自動修正しない・テスト #13） |
| classification / extraction | ファイル分類・テキスト抽出 | 参考表示のみ |

- fingerprint（質問ID＋回答ハッシュ）で重複を防止。却下済みの同一候補は再生成されない。
- 回答が更新された open 候補は `stale` 表示（自動では閉じない）。
- 追加質問の回答 →「元の回答に追記して確認済み」で質問の回答へ反映（internal 更新として監査）。

## AI生成ルール
条件分岐ルールの提案は `status: draft` で保存し、ビルダーで人間が有効化するまで無効。

## 検証済みテスト
#8 自動確定しない / #13 矛盾候補 / #19 架空Requirementなし / #23 AI OFFで呼び出し0 / #24 案件削除でAI index削除 / E2E-2 / E2E-5。
