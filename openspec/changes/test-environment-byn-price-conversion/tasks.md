# Tasks

## 1. Source Implementation

- [x] 1.1 Meaningful RED→GREEN Decimal/scale/date/null/rounding/FX validity/duplicate/stale/replay tests и canonical report schema.
- [x] 1.2 Official historical catalog/rate fetch с raw/URL/hash без fallback; fake responses unit-test only. Primary API research HTTP200 verified отдельно от настоящих данных проекта.
- [x] 1.3 Root-only signed inventory/plan/apply runner, target guards before DB client, atomic expected-value/fingerprint/idempotence и trigger preservation tests.
- [x] 1.4 Targeted/type/lint/strict OpenSpec PASS, source frozen для root. 14/14 tests; TS/lint PASS; operation=inspect/priceOperation packet gate и новый signed operational profile проверены; root ESM/advisory-lock fixes сохранены, runtime/apply не запускался субагентом.

## 2. Actual Data Acceptance

- [ ] 2.1 Root inventory/apply существующих local/staging, real FX proof, all-other-model fingerprints и actual exact-state receipt; субагент БД/runtime не запускал.
- [ ] 2.2 №32: владелец получает actual production app source и один ручной отчёт; без production DB runner и без выдуманных данных.
