# IntakeMint Phase 0 デスクリサーチ — SOURCE_NOTES

- 確認日: **2026-10-03**（全項目共通。個別に記載がない限りこの日付）
- 調査者: Claude Code（自動調査）。第三者サイトへのサインアップ・データ入力は一切していない。
- 価格はすべて USD・税別・公表定価。為替・税・割引は考慮していない。

## 調査方法と信頼度について（重要）

この調査環境ではネットワーク egress proxy により、多くのベンダー公式ページ（openai.com / developers.openai.com / aws.amazon.com / neon.com / supabase.com / resend.com / postmarkapp.com / backblaze.com / fly.io / render.com / railway.com / lucia-auth.com / modelcontextprotocol.io / developers.cloudflare.com 等）を **WebFetch で直接取得できなかった**。そのため以下の3段階で信頼度を区別する。

| 表記 | 意味 |
|---|---|
| **official（直接取得）** | 公式ページ/公式ドキュメント/公式レジストリを直接取得して確認（claude.com/pricing、platform.claude.com、code.claude.com、GitHub、npm registry、Cloudflare 公式 docs MCP、Supabase 公式 docs MCP） |
| **official（検索経由）** | 公式ドメインに限定した Web 検索の抜粋で確認。ページ本文は直接未取得 → **要再確認** |
| **secondary** | 第三者の比較記事・レビューサイト等の検索結果。公式ページで **要再確認** |
| **未取得/要再確認** | 数値が取れなかった、または情報源間で食い違いがある |

価格は頻繁に変わるため、本番の価格設計・原価計算前に必ず公式ページで再確認すること。

---

## 1. 名称 / 類似製品

### 1.1 「IntakeMint」名称衝突チェック（※正式な商標クリアランスではない）

| 確認対象 | 結果 | ソース |
|---|---|---|
| Web 検索 `"IntakeMint"` | 該当する製品・企業・サービスは検出されず（"intake" 単語や mint 製品のみヒット） | WebSearch（2026-10-03） |
| Web 検索 `"Intake Mint" OR "intakemint.com" OR "IntakeMint app"` | 同名プロダクトは検出されず。類似語として App Store に "Intake"（カロリー/栄養トラッカー系）アプリが複数存在 | https://apps.apple.com/us/app/intake-ai-calorie-tracker/id6759715682 ほか |
| Web 検索 `IntakeMint client intake software` | 同名なし。"client intake software" は法律事務所向け製品が多数（Lawmatics, MyCase, CloudLex, Law Ruler 等） | WebSearch |
| `intakemint.com` への接続 | DNS 解決不可（getaddrinfo ENOTFOUND）。**DNS レコードがない＝未登録とは限らない**（登録済みで未設定の可能性あり） | WebFetch 試行 |
| `.com/.io/.app/.ai/.co/.jp` の RDAP 照会 | proxy によりブロックされ **未取得/要再確認** | — |
| npm パッケージ名 `intakemint` | 存在しない（registry 404） | https://registry.npmjs.org/intakemint |
| GitHub リポジトリ検索 | API 応答が取得できず **未取得/要再確認** | — |
| 商標（USPTO/J-PlatPat/EUIPO） | 直接検索できず **未取得/要再確認**。周辺情報: "MINT" は Intuit の登録商標（家計簿 Mint、2024年サービス終了）、"INTAKE" は Intake Breathing Technology, LLC が2024年出願（医薬品等の区分）。"Mint" を含む SaaS ブランドは多数（MINT = 広告リソース管理 SaaS 等） | https://www.trademarkia.com/intake-98400392 , https://mint.intuit.com/ , https://www.mint.ai/ （secondary） |

**所見**: 2026-10-03 時点の Web 検索では、同一名称のクライアントインテーク SaaS は見当たらない。ただし「Mint」は Intuit の著名商標であり、"Intake" も既存商標がある。結合商標 "IntakeMint" として類否判断は別途必要。**ローンチ前に J-PlatPat（第9類・第35類・第42類）と USPTO で弁理士によるクリアランスを推奨**。ドメインはレジストラで空き確認が必要。

### 1.2 類似製品（ポジショニング / 価格）

すべて **secondary**（公式価格ページは未取得、または検索抜粋のみ）。年払い/月払いの区別が情報源で混在しているため要再確認。

| 製品 | ポジショニング | 価格（概要） | ソース |
|---|---|---|---|
| **Content Snare** | 代理店・会計事務所向け「クライアントからの資料/情報回収」専用。リマインダー自動送信、リクエスト単位課金。IntakeMint の最も直接的な競合 | 資料により差異: Basic $29〜35/月、Plus $59〜71、Pro $99〜119、Custom $215+（年払い/月払いで差）。アクティブリクエスト数・ユーザー数・ストレージで段階。無料トライアルあり | https://www.portico.run/blog/post/content-snare-pricing , https://www.capterra.com/p/167019/Content-Snare/ |
| **Dubsado** | フリーランス/小規模事業者向け CRM（フォーム・契約・請求・ワークフロー） | Starter $35/月（$335/年）、Premier $55/月（$525/年） | https://agiled.app/blog/dubsado-pricing |
| **HoneyBook** | クリエイティブ系フリーランス向けクライアント管理（提案・契約・支払い） | Starter $29、Essentials $49、Premium $109（年払い時の月額） | https://assembly.com/blog/honeybook-pricing |
| **Typeform** | 汎用会話型フォーム | Basic 約 $25/月（年払い、100回答/月）、月払い約 $39 | https://www.koji.so/blog/typeform-pricing-2026 |
| **Jotform** | 汎用フォーム＋ファイル収集 | Bronze $34/月（年払い、1,000件/月、1GB） | https://formbricks.com/blog/jotform-pricing |
| **Tally** | 無料枠が広い汎用フォーム | Free あり、Pro は €20〜$29/月（情報源で差異 → 要再確認） | https://formbricks.com/blog/tally-pricing |
| **FileInvite** | 金融・融資・会計向けの書類回収（エンタープライズ寄り） | Collect $829/月(10ユーザー)、Connect $1,659/月、Connect+ $2,499/月、Enterprise 要問合せ | https://www.capterra.com/p/138728/FileInvite/pricing/ |
| **Clinked** | ホワイトラベルのクライアントポータル（ファイル共有） | Lite $119/月、Standard $299、Premium $599（月払い）、ゲスト無制限 | https://www.tryplox.com/blog/clinked-pricing |
| **Moxo** | クライアント対応ワークフロー/ポータル（中堅〜エンタープライズ） | Starter 約 $100/月〜、Business $425〜450/月、Pro $1,000/月。見積制の記述もあり **要再確認** | https://www.agencyhandy.com/client-portal/moxo-pricing/ |
| **Ignition** | 会計事務所向け提案書・契約・請求自動化 | Solo $49/月($39年払い)、Core $149($99)、Pro $279($199)、Pro+ $499($399)＋決済手数料 | https://getuku.com/articles/ignition-pricing/ |

**ポジショニング示唆**: 汎用フォーム（Typeform/Jotform/Tally）は $25〜35/月帯、資料回収特化（Content Snare）は $29〜119/月帯、ポータル/エンタープライズ（Clinked/Moxo/FileInvite）は $100〜数千ドル帯。IntakeMint は「AI による欠落検知・自動催促・抽出」を差別化軸に、Content Snare 帯（$29〜99/月）が自然な比較対象。

---

## 2. Auth 候補

前提: **IntakeMint の実装は自前のセッション管理＋マジックリンク**（外部 IdP 依存なし）。以下は比較・将来オプションとしての記録。

| 候補 | ライセンス / 状況 | 価格 | 信頼度・ソース |
|---|---|---|---|
| **Auth.js (NextAuth.js)** | `@auth/core` 0.41.3 / `next-auth` 4.24.15、**ISC**。2025-09-22 に保守が Better Auth チームへ移管。セキュリティ修正は継続するが、新規プロジェクトには Better Auth を推奨と公式に表明 | OSS（無料） | npm registry（official 直接）: https://registry.npmjs.org/@auth/core/latest ／ 移管: https://better-auth.com/blog/authjs-joins-better-auth（検索経由） |
| **Better Auth** | `better-auth` 1.7.7、**MIT** | OSS（無料） | npm registry（official 直接） |
| **Lucia** | `lucia` 3.2.2、MIT。**npm 上で deprecated**（「lucia-auth.com/lucia-v3/migrate を参照」）。2025年3月に v3 廃止、現在は「セッション認証を自前実装するための学習リソース」 | — | npm registry（official 直接）／ https://github.com/lucia-auth/lucia/discussions/1714（検索経由） |
| **Clerk** | SaaS（SDK は `@clerk/nextjs` 7.9.10 MIT） | Free: **50,000 MRU/アプリ**（2026-02-05 改定。旧 10,000 MAU）。Pro $20/月（年払い）/$25（月払い）、50,001〜100,000 MRU は $0.02/MRU | clerk.com 検索経由: https://clerk.com/pricing , https://clerk.com/changelog/2026-02-05-new-plans-more-value |
| **Supabase Auth** | `@supabase/auth-js` MIT（GoTrue ベース） | Free プランに含む。Pro $25/月で 100,000 MAU 含む、超過 $0.00325/MAU | secondary: https://makerkit.dev/blog/saas/supabase-pricing （MAU 単価は要再確認） |
| **Auth0 (Okta)** | 商用 SaaS | Free: 25,000 MAU まで（MFA・カスタムドメイン等の制限あり）。B2C Essentials $35/月〜（500 MAU）、超過 約 $0.07/MAU | secondary: https://idsync.com/guides/auth0-pricing |

**所見**: Lucia の思想（セッションを自前実装）は当方実装方針と一致。外部 IdP を使わないため MAU 課金は発生しない。マジックリンクのメール送信原価のみ（§5参照）。

---

## 3. DB

| 項目 | 事実 | 信頼度・ソース |
|---|---|---|
| **PostgreSQL ライセンス** | PostgreSQL License（BSD/MIT 類似の permissive、OSI 認定）。商用・プロプライエタリ利用可、著作権表示の保持のみ要件 | official（検索経由）: https://www.postgresql.org/about/licence/ |
| **PGlite** (`@electric-sql/pglite`) | npm 最新 0.5.8。**Apache-2.0 と PostgreSQL License のデュアルライセンス（選択可）**。Postgres ソースへの改変部分は PostgreSQL License | official 直接: https://github.com/electric-sql/pglite , https://registry.npmjs.org/@electric-sql/pglite/latest |
| **Neon** | 2025-12 以降 Launch/Scale は**月額最低料金なしの従量制**。Launch: compute **$0.106/CU-hour**（1 CU = 1 vCPU / 4GB）、storage **$0.35/GB-month**。5分無操作で scale-to-zero。Free: 100 プロジェクト、100 CU-hours/プロジェクト/月、1 GB/プロジェクト（2026-10-02 に 0.5GB→1GB と記載）、egress 5GB/月 | Launch 単価: secondary（https://swyftstack.com/blog/neon-pricing-explained 等）／Free: neon.com 検索経由 https://neon.com/faqs/free-plan-limits-and-quotas , https://neon.com/docs/changelog/2026-10-02 |
| **Supabase** | Pro **$25/月/組織**、Compute Credits $10/月（Micro 1台分）。Micro $0.01344/h（≈$10/月）、Small $0.0206/h（≈$15/月）、Medium ≈$60/月。Free は2アクティブプロジェクト（無操作で一時停止あり）。Pro は Egress 250GB、Storage 100GB 含む | official 直接（Supabase docs MCP）: https://supabase.com/docs/guides/platform/manage-your-usage/compute , https://supabase.com/docs/guides/platform/billing-faq , https://supabase.com/docs/guides/platform/your-monthly-invoice |
| **AWS RDS for PostgreSQL** | db.t4g.micro Single-AZ（us-east-1）約 **$0.016/h ≈ $11.68/月**、gp3 storage **$0.115/GB-month**（別途バックアップ・転送料） | secondary: https://selfhost.dev/blog/aws-rds-cost-breakdown-2026/ 等（aws.amazon.com 未取得 → 要再確認） |
| **Render Postgres** | Basic-256mb **$6/月**〜 | secondary: https://www.budgetforge.dev/tools/render-pricing-2026 |

---

## 4. オブジェクトストレージ

| サービス | Storage | Egress | Ops | 無料枠 | 署名付き URL | 信頼度・ソース |
|---|---|---|---|---|---|---|
| **Cloudflare R2** (Standard) | **$0.015/GB-month**（IA は $0.01） | **無料** | Class A $4.50/百万、Class B $0.36/百万 | 10 GB-month、Class A 100万、Class B 1,000万/月 | S3 互換 presigned URL 対応（有効期限 1秒〜7日） | official 直接（Cloudflare docs MCP、"Last updated Oct 1, 2026"）: https://developers.cloudflare.com/r2/pricing/ ／ presigned: https://developers.cloudflare.com/r2/api/s3/presigned-urls/（検索経由） |
| **AWS S3** Standard (us-east-1) | **$0.023/GB-month**（最初の50TB） | インターネットへ **$0.09/GB**（最初10TB）、全サービス合算で月100GBまで無料 | PUT 等 $0.005/1,000、GET $0.0004/1,000（一般値・要再確認） | 新規アカウントは AWS Free Tier クレジット制 | SigV4 presigned URL（最大7日。一時認証情報の場合はその失効時まで） | secondary: https://www.cloudzero.com/blog/s3-pricing/ ／ https://docs.amazonaws.cn/en_us/AmazonS3/latest/userguide/using-presigned-url.html（aws.amazon.com 未取得 → 要再確認） |
| **Backblaze B2** | **$6.95/TB-month**（≈$0.00695/GB） | 平均保管量の**3倍まで無料**、超過 $0.01/GB | Class A 無料、Class B/C は日2,500回まで無料、以降 $0.004/1万（B）・$0.004/1,000（C）。※PAYG は A/B/C 無料・D 課金という記述もあり**要再確認** | 最初 10GB 無料（一般値・要再確認） | S3 互換 API の presigned URL 対応（一般知識・要再確認） | official（検索経由）: https://www.backblaze.com/cloud-storage/pricing , https://www.backblaze.com/cloud-storage/transaction-pricing |

**所見**: クライアントが資料をダウンロード/プレビューする用途では egress 無料の R2 が原価予測しやすい。

---

## 5. メール（マジックリンク・催促メール）

| サービス | 無料枠 | 有料 | 1,000通あたり | 信頼度・ソース |
|---|---|---|---|---|
| **Resend** | 3,000通/月（100通/日上限、3ドメイン） | Pro $20/月で 50,000通、$35 で 100,000通、Scale $90〜 | 超過 約 **$0.90/1,000**（Pro 50K 込み換算では ≈$0.40/1,000） | secondary: https://automationatlas.io/answers/resend-pricing-explained-2026/ |
| **Postmark** | 開発用無料枠（100通/月程度、要再確認） | Basic $15/月で 10,000通 | 超過 Basic $1.80、Pro $1.30、Platform $1.20 /1,000 | secondary: https://www.sequenzy.com/pricing/postmark |
| **Amazon SES** | **2026-07-21 以降の新規アカウントは SES 専用無料枠（3,000通/月×12か月）廃止**。AWS 新規は最大 $200 クレジット | 従量 | **$0.10/1,000**（添付は別途 $0.12/GB が一般値・要再確認）。2026-07-21 から Essentials/Pro/Enterprise の「pricing plans」導入、新規は Essentials から | official（検索経由）: https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-ses-pricing-plans/ , https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/ ／ 単価は secondary |
| **SendGrid (Twilio)** | 恒久無料プランは 2025 年に廃止 → 60日トライアル（100通/日） | Essentials $19.95/月（50,000通）、$34.95（100,000通）、Pro $89.95〜 | ≈$0.40/1,000（50K プラン換算） | secondary: https://www.sendx.io/blog/sendgrid-pricing |

**注意**: Essentials プラン導入に伴う SES の実効単価（$0.10 に上乗せがあるか）は**未取得/要再確認**。

---

## 6. AI プロバイダ

### 6.1 Anthropic Claude API（official 直接: https://claude.com/pricing — anthropic.com/pricing から 301 リダイレクト）

| モデル | Input /MTok | Output /MTok | Cache read | Cache write |
|---|---|---|---|---|
| Claude Opus 5.5 | $4 | $20 | $0.20 | $5 |
| **Claude Sonnet 5.5**（中位） | **$2** | **$10** | $0.20 | $2.50 |
| **Claude Haiku 4.5**（小型） | **$1** | **$5** | $0.10 | $1.25 |
| Claude Fable 5.1 | $10 | $50 | $0.25 | $12.50 |

- Batch 処理で 50% 割引。US-only inference は 1.1 倍価格。
- **データ利用/保持**（official 直接: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention 、privacy.claude.com）: 商用 API の入出力は**デフォルトでモデル学習に使用しない**（明示的な許可がない限り）。バックエンドでは受信/生成から **30日以内に自動削除**（法的要請・Trust & Safety でフラグされた場合等の例外あり）。ZDR（Zero Data Retention）・HIPAA-ready の取り決めあり（対象機能は適格性表で確認）。**Fable 5.1 / Mythos 5.1 / Fable 5 / Mythos 5 は "Covered Models" として30日保持が必須で ZDR 不可**（検索経由: https://privacy.claude.com/en/articles/15425996-data-retention-practices-for-covered-models ）。

### 6.2 OpenAI API（openai.com / developers.openai.com は直接取得不可 → **official（検索経由）/secondary、要再確認**）

| モデル | Input /MTok | Cached input | Output /MTok | ソース |
|---|---|---|---|---|
| GPT-5.5（中上位） | $5.00 | 未取得 | $30.00（272K 超入力は割増） | 検索経由: https://developers.openai.com/api/docs/models/gpt-5.5 |
| GPT-5 mini（小型） | $0.25 | $0.025 | $2.00（Batch は半額） | 検索経由: https://developers.openai.com/api/docs/models/gpt-5-mini ／ secondary 多数 |

- 最新の小型モデル（GPT-5.5 mini 等）が存在するかは**未確認**。公式価格表で要再確認。
- **データ利用/保持**（検索経由: https://developers.openai.com/api/docs/guides/your-data ）: 2023-03-01 以降、API データは**デフォルトで学習に使用しない**（オプトイン時のみ）。abuse monitoring ログは**最大30日保持**。適格ユースケースは ZDR 申請可。エンドポイント（/v1/responses の stored 応答、/v1/conversations, assistants 等）ごとに保持が異なる点に注意。

---

## 7. OCR / Vision

| サービス | 価格 | 無料枠 | 信頼度・ソース |
|---|---|---|---|
| **Google Cloud Vision** (DOCUMENT_TEXT_DETECTION) | **$1.50/1,000 units**（1,001〜500万）、$0.60/1,000（500万超） | 1,000 units/月 | official（検索経由）: https://cloud.google.com/vision/pricing |
| **AWS Textract** | DetectDocumentText **$1.50/1,000 pages**、AnalyzeDocument Tables $15、Forms $50、Forms+Tables $65 /1,000 pages | 1,000 pages/月×3か月（DetectDocumentText のみ） | secondary: https://www.wring.co/blog/aws-textract-pricing-guide（要再確認） |
| **Azure AI Document Intelligence** | Read **$1.50/1,000 pages**、Prebuilt Layout $10/1,000 pages | F0: 500 pages/月（各リクエスト先頭2ページ・4MB 制限） | secondary: https://docuocr.com/blog/azure-document-intelligence-pricing（要再確認） |

**所見**: 単純 OCR は3社とも $1.50/1,000 ページ水準。構造抽出は Claude/GPT の Vision 入力で代替する設計も可能（トークン原価で比較要）。

---

## 8. ウイルススキャン候補

| 候補 | 事実 | 実装上の含意 | 信頼度・ソース |
|---|---|---|---|
| **ClamAV** | **GPLv2**。サードパーティ（Yara: Apache-2.0、libmspack: LGPL、UnRAR: 非フリーで GPL 非互換のため libclamunrar は実行時ロード）を含む | **clamd を別プロセス/別コンテナとして起動し、ソケット（INSTREAM）経由で通信する構成なら、IntakeMint 本体は GPL の派生物にならないと一般に解される**。libclamav を本体にリンク/同梱して配布する場合は GPL 義務が生じ得る。SaaS 提供のみ（配布なし）なら GPLv2 のソース開示義務は通常発生しないが、オンプレ/セルフホスト版を顧客に配布する場合は要注意（clamav イメージを別配布物として扱う）。法的判断は要専門家確認 | official 直接: https://github.com/Cisco-Talos/clamav |
| **Cloudmersive Virus Scan API** | 無料枠 800 calls/月（600 とする情報もあり）、1同時リクエスト、2.5MB 上限。Basic $19.99/月で 10,000 calls | 外部 API にクライアント文書を送信するため DPA・データ所在の確認が必要 | secondary: https://cloudmersive.com/pricing-small-business（検索経由） |
| **VirusTotal** | Public API は 500 req/日・4 req/分。**商用製品・サービスでの利用禁止**、新規ファイルを提供しない業務ワークフローでの利用も禁止。違反は恒久 BAN | **IntakeMint では Public API を使ってはならない**。さらにアップロードしたファイルはセキュリティコミュニティに共有され得るため、顧客の機密書類スキャンには不適。Premium は高額（要問合せ） | official（検索経由）: https://docs.virustotal.com/reference/public-vs-premium-api |
| **AWS GuardDuty Malware Protection for S3** | **$0.09/GB スキャン**（2025-02-01 に $0.60 から値下げ）＋ **$0.215/1,000 objects 評価**（us-east-1） | S3 を採用する場合はマネージドで最も簡便。R2 では使えない | official（検索経由）: https://aws.amazon.com/about-aws/whats-new/2025/02/amazon-guardduty-malware-protection-s3-price-reduction |

---

## 9. バックグラウンドジョブ

| ライブラリ | バージョン / ライセンス | 備考 | ソース |
|---|---|---|---|
| **pg-boss** | 12.36.0 / **MIT** | PostgreSQL のみで動作（Redis 不要）。当方スタックと相性良 | official 直接: https://registry.npmjs.org/pg-boss/latest |
| **BullMQ** | 6.3.11 / **MIT** | Redis 必須。BullMQ Pro は別途商用ライセンス（一般知識・要再確認） | official 直接: https://registry.npmjs.org/bullmq/latest |

---

## 10. MCP

| 項目 | 事実 | 信頼度・ソース |
|---|---|---|
| **MCP 仕様の現行版** | **2026-07-28**（RC は 2026-05-21 ロック、2026-07-28 に正式公開）。主な変更: ステートレスなプロトコルコア（initialize/initialized と `Mcp-Session-Id` ヘッダーを廃止、各リクエストが `_meta` に protocol version / client 情報 / capabilities を持つ）、Multi Round-Trip Requests、ヘッダーベースルーティング、list 結果のキャッシュ、認可の強化、拡張フレームワーク（reverse-DNS ID）。Tier 1 SDK（TypeScript/Python/Go/C#）が対応 | official（検索経由）: https://blog.modelcontextprotocol.io/posts/2026-07-28/ , https://modelcontextprotocol.io/specification/2026-07-28/basic （modelcontextprotocol.io は直接取得不可） |
| **公式 TypeScript SDK** | GitHub `modelcontextprotocol/typescript-sdk` の main は **v2**、2026-07-28 仕様をサポート。パッケージは分割: `@modelcontextprotocol/server`（2.3.0, **Apache-2.0**）、`@modelcontextprotocol/client`、各種ミドルウェア（Express/Fastify/Hono/Node HTTP）。ライセンスは「新規コントリビューションは Apache-2.0、既存コードは MIT」。旧単一パッケージ `@modelcontextprotocol/sdk` は 1.32.0 / **MIT**（v1 系） | official 直接: https://github.com/modelcontextprotocol/typescript-sdk , https://registry.npmjs.org/@modelcontextprotocol/sdk/latest , https://registry.npmjs.org/@modelcontextprotocol/server/latest |
| **OpenAI Apps SDK / ChatGPT** | Apps SDK は MCP ベース（プレビュー、OSS）。ChatGPT **developer mode**（ベータ）は read/write 両方のツールを含むフル MCP クライアント対応。現行ドキュメントでは "plugins"（ChatGPT と Codex にサーバー機能を公開する単位）という用語で整理されている | official（検索経由）: https://developers.openai.com/plugins/deploy/connect-chatgpt , https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk , https://developers.openai.com/api/docs/mcp |
| **Codex** | ChatGPT デスクトップアプリ・Codex CLI・IDE 拡張が MCP サーバーをサポートし、設定を共有。**STDIO** と **Streamable HTTP** に対応 | official（検索経由）: https://developers.openai.com/codex/mcp |
| **Claude Code** | MCP をサポート。トランスポート: **HTTP（リモート推奨、OAuth 2.0 対応）**、SSE（非推奨、HTTP 失敗時にフォールバック）、**stdio**（ローカル）、WebSocket（JSON 設定のみ）。スコープ: local（既定、`~/.claude.json`）/ project（`.mcp.json` で共有）/ user。`claude mcp add --transport http <name> <url>`、`claude mcp login`、Dynamic Client Registration 対応、`.mcp.json` で `${VAR}` 展開、ツール出力上限 既定 25,000 tokens | official 直接: https://code.claude.com/docs/en/mcp |

**所見**: IntakeMint の MCP サーバーは **Streamable HTTP + OAuth** を実装すれば Claude Code / Codex / ChatGPT developer mode のいずれからも接続可能。新仕様 2026-07-28 はステートレスでセッション ID を廃止しているため、v2 SDK を前提に設計すべき。旧 SDK（v1, MIT）との互換性は要確認。

---

## 11. コネクタ（外部ストレージ/通知）

| API | 規約・審査上の要点 | 信頼度・ソース |
|---|---|---|
| **Google Drive API** | `drive` / `drive.readonly` は **restricted scope** → 第三者サーバーでデータを扱うアプリは **CASA（App Defense Alliance）による年次セキュリティ評価が必須**（12か月ごとの再認証、変更有無にかかわらず包括テスト）。**`drive.file`（非機密）＋ Google Picker** を使えばファイル単位アクセスでセキュリティ評価不要・審査が簡略。Google 推奨も drive.file への移行 | official（検索経由）: https://developers.google.com/workspace/drive/api/guides/api-specific-auth , https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification , https://support.google.com/cloud/answer/13463816 |
| **Gmail API** | `gmail.send`（送信のみ）は **sensitive**（審査必要・セキュリティ評価は不要）。本文/メタデータの読み取り・変更を含むスコープは **restricted**（CASA 必須）。未審査アプリはユーザー数上限・警告画面あり | official（検索経由）: https://developers.google.com/workspace/gmail/api/auth/scopes , https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |
| **Dropbox API** | 新規アプリは development status（自分＋有効化した追加ユーザー、最大500）。**50ユーザー連携後2週間以内に production status 申請・承認が必要**（未承認だと新規連携が凍結）。審査は通常数営業日 | official（検索経由）: https://www.dropbox.com/developers/reference/developer-guide |
| **Microsoft Graph (OneDrive)** | 委任権限 `Files.ReadWrite` は管理者同意不要、`Files.ReadWrite.All` は組織ポリシーで管理者同意扱いになりやすい。**新規登録のマルチテナントアプリは publisher verification（企業登録・MPN）がないとユーザー同意できない**ケースあり。OneDrive File Picker の利用も選択肢 | official（検索経由）: https://learn.microsoft.com/en-us/graph/permissions-reference , https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/ |
| **Slack API** | 2025-05-29 以降、**Marketplace 未承認の商用配布アプリ**は `conversations.history` / `conversations.replies` が Tier 1（**1 req/分・最大15件**）に制限（既存インストールも 2025-09-02 から適用）。通知送信（chat.postMessage / Incoming Webhook）用途なら影響小。履歴読み取りが必要なら Marketplace 承認が実質必須 | official（検索経由）: https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/ |

**所見**: MVP では「Drive は drive.file + Picker」「Gmail は使わず自社送信（SES/Resend）」「Slack は通知送信のみ」で restricted scope と Marketplace 審査を回避するのが妥当。

---

## 12. フォント

前提: **IntakeMint はフォントファイルを同梱しない**。system font stack を基本とし、必要に応じて Google Fonts CDN から読み込む（Google Fonts CDN 利用時は第三者への IP 送信が発生する点をプライバシーポリシーに記載）。

| フォント | ライセンス | 備考 | ソース |
|---|---|---|---|
| **Inter** | SIL OFL 1.1 | UI 向けモダンサンセリフ（欧文） | official（検索経由）: https://fonts.google.com/specimen/Inter/license |
| **Noto Sans JP** | SIL OFL 1.1 | Google/Adobe（Source Han Sans 系） | secondary: https://fontsource.org/fonts/noto-sans-jp |
| **M PLUS 1p / M PLUS 1** | SIL OFL 1.1 | M+ FONTS の Google Fonts 版 | secondary: https://github.com/rayshan/mplus-fonts |
| **IBM Plex Sans JP** | SIL OFL 1.1 | IBM Plex の日本語版 | secondary: https://fonts.adobe.com/fonts/ibm-plex-sans-jp |

OFL はフォント単体の販売禁止・Reserved Font Name 制約があるが、Web サイトでの表示や CDN 経由利用・商用 SaaS での利用は可能。同梱しない方針なのでライセンス表記義務も最小。

推奨 stack 例: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif`

---

## 13. iOS Safari 上の PWA 制約

| 項目 | 事実 | 信頼度・ソース |
|---|---|---|
| ストレージ退避 | Safari（ブラウザタブ）では ITP により**7日間未使用でスクリプト書き込み可能ストレージ（IndexedDB, localStorage, Cache 等）が削除され得る**。**ホーム画面 Web アプリの first-party ドメインは 7日上限の対象外**。既定は best-effort モードで退避あり得る。`navigator.storage.persist()` は WebKit のヒューリスティック（ホーム画面アプリ等）で許可判断 | official（検索経由）: https://webkit.org/blog/14403/updates-to-storage-policy/ , https://webkit.org/tracking-prevention/ |
| クォータ | ブラウザアプリ: origin あたりディスクの最大60%（全体80%）、その他アプリ（WebView 等）: 15% | 同上 |
| Web Push | iOS/iPadOS 16.4 以降、**ホーム画面に追加した Web アプリのみ**対応（Safari タブからは不可）。サイレント（data-only）プッシュ不可 | secondary: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide |
| インストール | iOS 26 では、ホーム画面に追加したサイトが既定で Web アプリとして開く（manifest 要件なし） | secondary: https://www.mobiloud.com/blog/progressive-web-apps-ios/ （要再確認） |
| カメラ撮影アップロード | `<input type="file" accept="image/*">` でカメラ/写真ライブラリ選択肢が出る。`capture` 属性（`capture="environment"`）の挙動は iOS バージョンにより異なり、完全準拠ではないとする情報あり。ユーザー操作起点が必須 | secondary: https://blog.addpipe.com/correct-syntax-html-media-capture/ （実機確認推奨） |

**所見**: 未送信のドラフト等をクライアント側に長期保存する設計は避け、**サーバー側に逐次保存**する。通知はメールを主とし Web Push は補助。

---

## 14. ホスティング / デプロイ（小規模 Node サービス）

| サービス | 小規模構成の価格 | 備考 | 信頼度・ソース |
|---|---|---|---|
| **Fly.io** | shared-cpu-1x 256MB **$2.19/月**、512MB **$3.19/月**、1GB **$5.70/月**（秒課金）。**2026-10-01 にメモリ単価を $6.00/GB-月 に改定**（CPU 価格は据え置き）とされる | 完全従量制、旧無料枠は廃止 | fly.io 検索経由: https://fly.io/docs/about/pricing/ ／ 改定日は secondary（要再確認） |
| **Render** | Starter web service **$7/月**（0.5 vCPU / 512MB）、Standard $25/月。Hobby ワークスペース無料、Pro ワークスペース $25/月。Postgres Basic-256mb $6/月 | Free インスタンスは15分でスリープ。2026-09 に価格改定があったとの記事あり → 要再確認 | secondary: https://www.budgetforge.dev/tools/render-pricing-2026 , https://bex.co/blog/2026/09/04/render-price-changes-cost-sheet |
| **Railway** | Hobby **$5/月**（$5 分の利用込み）、Pro $20/月（$20 分込み）。従量 ≈ $20/vCPU-月、$10/GB RAM-月 | 1 vCPU/1GB 常時稼働だと Hobby 枠を超過 | secondary: https://www.budgetforge.dev/tools/railway-pricing-2026 |
| **Cloudflare Workers / Containers** | Workers Paid **$5/月**: 1,000万リクエスト・3,000万 CPU-ms 込み、超過 $0.30/百万リクエスト・$0.02/百万 CPU-ms。Containers は Paid に 25 GiB-h メモリ・375 vCPU-分・200 GB-h ディスク込み、以降従量 | Node 互換は Workers の nodejs_compat 依存。フル Node サーバーなら Containers | official（検索経由）: https://developers.cloudflare.com/workers/platform/pricing/ , https://developers.cloudflare.com/containers/platform/pricing/ |

---

## 未取得 / 要再確認 一覧

1. IntakeMint のドメイン登録状況（RDAP ブロック）、GitHub 上の同名、商標（USPTO/J-PlatPat）— **正式クリアランス未実施**
2. OpenAI 公式価格表（openai.com 直接取得不可）。GPT-5.5 の cached input 単価、最新の mini/nano モデル有無
3. AWS 各種（S3 リクエスト単価、RDS、SES の Essentials プラン実効単価、Textract）— aws.amazon.com 直接取得不可
4. Neon Launch の単価（第三者記事ベース）、Resend/Postmark/SendGrid の超過単価
5. Backblaze B2 のトランザクション課金（"PAYG は A/B/C 無料" と "B/C は日2,500回超で課金" の記述が混在）
6. Tally Pro（€20 or $29）、Content Snare（年払い/月払いの金額差）、Moxo（公開価格の有無）
7. Fly.io の 2026-10-01 メモリ価格改定（第三者 GitHub issue が出典）、Render の 2026-09 価格改定内容
8. iOS 26 における `capture` 属性とホーム画面 Web アプリの挙動（実機確認推奨）
