# IntakeMint — 案件開始に必要な情報を揃える

質問・提出ファイル・不足確認をまとめ、回答の出典をたどれる案件開始パックにするヒアリング管理ツールです。

実装ブランチ：`claude/intakemint-024`。アプリ本体は `024-intakemint/`。

## できること

- 条件分岐付き質問、ファイル回収、アカウント不要の顧客ポータル
- 充足度・矛盾候補の確認、Ready判定と人によるサインオフ
- 案件開始パック、承認付きリマインド、監査・MCP連携

## 現在の範囲・制限

- 既定のAIはローカル判定、メールはローカル記録です。外部AI・実メール送信には個別設定が必要です。
- PGliteで試せるデモと、PostgreSQL・ストレージ・TLSを設定する本番運用は別です。実機確認は残項目です。

## 実装の見どころ

**構成：** React / TypeScript / Vite、Node.js、PGlite / PostgreSQL、PWA、MCP。

- [024-intakemint/src/server](./024-intakemint/src/server)
- [024-intakemint/src/web](./024-intakemint/src/web)
- [024-intakemint/src/mcp](./024-intakemint/src/mcp)

## ローカルで試す

Node.js 22.12以上。末尾の環境変数指定はBash形式です。PowerShellでは $env:SEED_SAMPLE="true"; $env:PGLITE_DIR="./data/pg" を設定してから npm run dev:server を実行します。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/intakemint-024 https://github.com/Atsushi-Odajima/IntakeMint_hb.git
cd IntakeMint_hb/024-intakemint
npm install
npm run build
SEED_SAMPLE=true PGLITE_DIR=./data/pg npm run dev:server
```

環境設定・初期化の詳細：[セットアップ手順](./024-intakemint/DEVELOPMENT.md)。

## 検証方法

`024-intakemint/` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [024-intakemint/DEVELOPMENT.md](./024-intakemint/DEVELOPMENT.md)
- [024-intakemint/NEXT_STEPS.txt](./024-intakemint/NEXT_STEPS.txt)
- [024-intakemint/README.md](./024-intakemint/README.md)
- [024-intakemint/TEST_REPORT.md](./024-intakemint/TEST_REPORT.md)
- [024-intakemint/RELEASE_CHECKLIST.md](./024-intakemint/RELEASE_CHECKLIST.md)
- [024-intakemint/DATA_MODEL.md](./024-intakemint/DATA_MODEL.md)
- [024-intakemint/DECISIONS.md](./024-intakemint/DECISIONS.md)
- [024-intakemint/SECURITY.md](./024-intakemint/SECURITY.md)
- [024-intakemint/OPERATIONS.md](./024-intakemint/OPERATIONS.md)
- [画面資料](./024-intakemint/docs/screenshots)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
