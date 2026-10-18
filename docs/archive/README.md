# Archive

These files are kept for history only. They are no longer current and do not describe the project as it is now; the current documents are the [README](../../README.md), [ARCHITECTURE](../ARCHITECTURE.md), [KNOWN_ISSUES](../KNOWN_ISSUES.md) and `docs/methodology/`.

| File | What it was |
|---|---|
| `PROJECT.md` | An early 90-day roadmap; it marks items as done that were never built. |
| `COMPREHENSIVE_ANALYSIS_REPORT.md` | An early assessment that called the project "production-ready"; it is not. |
| `PRODUCT_QUALITY_REPORT.md` | A superseded quality assessment against generator v1.0.0 (55.2% accuracy, produced with another AI tool). |
| `Case Explorer.md` | An internal planning memo for the mortgage-lab upgrade. |
| `SETUP_GUIDE.md` | A guide to setting up a GitHub Projects board for the old roadmap. |
| `DB_SETUP.md` | An old database guide; its `DB_HOST` settings and `schema.sql` steps do not match the code, which reads `DATABASE_URL` and applies `src/db/migrations/` with `npm run db:migrate`. |
| `schema.sql` | The old PostgreSQL schema, replaced by `src/db/migrations/001_core.sql`. |
