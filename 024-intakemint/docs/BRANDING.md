# BRANDING

- 製品名：**IntakeMint**（名称・商標・ドメイン・App Store・類似SaaSは release 前に再確認。SOURCE_NOTES.md：同名製品は見当たらないが、「Mint」はIntuitの商標、「INTAKE」は他社登録あり → 正式な商標クリアランスが必要。問題時は候補名を人間へ提示し、勝手に変更しない）。
- タグライン：「必要な情報が、1回でちゃんと揃う。」／ SMART INTAKE FOR REAL WORK
- 基準：同梱 `02_branding/brand_board.png`・`brand_spec.txt`。画像内UIは貼らず、実装UIとして再構成。

## カラー
| Token | 値 | 用途 |
|---|---|---|
| Deep Forest | #0F2D2A | 主ボタン・見出し・アイコン背景 |
| Mint | #3CB371 | 進捗・アクセント（文字には #217A4B を使用しAAを確保） |
| Warm Ivory | #E8E1D6 | アイコンの葉・淡い面 |
| Soft Background | #F8F9F7 | 背景 |
| Charcoal | #1D2422 | 本文 |
前商品の青/オレンジは使用しない。

## ロゴ
`src/web/public/logo-mark.svg`：2枚の葉（Forest／Mint）が中央に集まる抽象形＝「情報が集まり、整う」。書類＋チェックの直球表現は避けた。PWAアイコン `icon.svg`（Forest地にIvory/Mintの葉、32pxでも識別可能）、maskable版 `icon-maskable.svg`（セーフゾーン内72%）。PNGは `npm run icons` で生成（192/512/maskable512/apple-touch180/favicon32/48）。

## タイポグラフィ
フォントファイルは同梱しない。`"Inter", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", system-ui` のシステムフォントスタック（いずれも OS 搭載／OFL等の商用利用可能フォントをユーザー環境に依存）。ワードマークはUI上はテキスト＋ウェイト差（Intake=Forest、Mint=Mint）で表現。印刷物用にアウトライン化したワードマークは release 前に作成（NEXT_STEPS）。

## トーン
十分な余白、落ち着いた高級感、人物写真なし、ピクトグラム/抽象図形中心。

## スクリーンショット
`docs/screenshots/`（desktop / ipad / iphone / android × dashboard / case / portal、desktop-ai / desktop-reminder）。
