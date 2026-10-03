# DEVELOPMENT

## 必要環境
Node.js 22.12+（npm 10）。DBサーバー不要（PGlite組込み）。本番相当は PostgreSQL 16。

## コマンド
| コマンド | 内容 |
|---|---|
| `npm install` | 依存関係 |
| `npm run dev` | API(8787, tsx watch) + Vite(5173, /api をプロキシ) |
| `npm run build` | PWAを `dist/web` にビルド |
| `npm start` | 本番モード起動（`dist/web` を配信） |
| `npm run seed` | サンプル環境作成（PGLITE_DIR/DATABASE_URL に対して） |
| `npm run typecheck` | TypeScript 型チェック |
| `npm test` | Vitest（エンジン・API・フロー：PGlite） |
| `TEST_DATABASE_URL=... TEST_DATABASE_URL2=... npm test` | 実PostgreSQLでの検証も実行 |
| `npm run test:e2e` | Playwright（desktop / iPhone 13 / Pixel 7 / iPad の各プロファイル。Chromium: `/opt/pw-browsers/chromium` または `CHROMIUM_PATH`） |
| `npm run perf` | 性能計測（`DATABASE_URL` 指定でPostgreSQL） |
| `npm run icons` | SVG→PWA PNG アイコン生成 |
| `npm run mcp` | MCP stdio サーバー（`INTAKEMINT_API_TOKEN` 必須） |
| `npm run restore -- file.zip` | バックアップ復元 |

## ディレクトリ
```
src/shared/     型・条件分岐・検証・充足判定・サンプル（ブラウザ/サーバー共通）
src/server/     app.ts(API) / services / db / ai / storage / email / jobs / security / connectors / seed.ts
src/web/        React PWA（public/ に manifest・sw.js・アイコン）
src/mcp/        MCP tools / stdio server
tests/          Vitest   e2e/  Playwright   scripts/  seed・restore・perf・icons・screenshots
docs/           screenshots, perf results, BRANDING
buyer_docs/     購入者向け資料
```

## 方針
- サービス関数は `(ctx, actor, ...)`。最初に `requirePerm`、SQLは `org_id` で絞る。
- 状態を変える処理の後は `recompute()`。
- AIは `services/ai.ts` からのみ呼ぶ。
- 時刻は `ctx.now()`（テストで固定可能）。
