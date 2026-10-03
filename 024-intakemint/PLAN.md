# PLAN — IntakeMint #024

中心価値：「回答を集める」ではなく「仕事を始めるために必要なものが全部揃った状態を作る」。

| Phase | 範囲 | 主な成果物 |
|---|---|---|
| 0 | 名称/市場/技術/provider/license/料金調査、PWA/AI PoC | SOURCE_NOTES.md, research/pricing_inputs.json |
| 1 | Auth、Organization、RBAC、Template/Version、Case | services/orgs, rbac, templates, cases |
| 2 | Question Builder、Conditional Logic、Client Link/Portal | shared/logic, TemplateBuilder, access, Portal |
| 3 | Required Items、File Upload、Review、Progress | shared/completeness, intake, review |
| 4 | AI Adaptive Interview、Completeness、Contradiction | ai/providers, services/ai |
| 5 | Reminder、Notifications、Ready Gate | reminders, notifications, review(signoff/override) |
| 6 | Intake Package、Handoff Profiles、Search | packages, search |
| 7 | PWA、Import/Export、MCP foundation、Connector interface | manifest/sw/icons, backup, mcp, connectors |
| 8 | Privacy/Security/Audit/Backup/Restore | security/*, audit, backup |
| 9 | Performance、PC/iPhone/Android/iPad E2E、Accessibility | scripts/perf, e2e |
| 10 | Branding、Docs、Deploy準備、販売前check | docs, buyer_docs, Dockerfile, RELEASE_CHECKLIST |

今回広げない（§30）：汎用Form Builder競争、CRM、PM、会計、電子署名、KYC保証、医療/法律判断、ファイル編集、OCR完全保証、無断メール営業、Client監視。Pro候補（§31）は実装しない。
