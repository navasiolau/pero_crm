# Tasks

## 1. Baseline и helper

- [x] 1.1 Зафиксировать22existing business case names/canonical AST bodies и310/288LOC; выполнить actual baseline только в разрешённом root local slot, no external effects.
- [x] 1.2 Добавить один import-inert typed guarded-module-cache helper с explicit owner/override/target allowlist; неизвестные paths/nested scope запрещены до load.
- [x] 1.3 Реализовать owned cache/global descriptors/active marker и restore при setup/async/falsy failure; сохранить original errors и доказать чужой cache conflict refusal без overwrite.

## 2. Миграция и guards

- [x] 2.1 Перевести только3fixed suites на сценарные setup/cleanup;20exact callback AST +2explicit import-seam-normalized hashes,22names/value assertions, real Enum/Decimal/Sharp иtarget imports сохраняются.
- [x] 2.2 Добавить negative stale ESM owner refusal, минимальные Prisma construction/unknown method/network-beforeeffect cases в выбранную suite; original effect counters0, callbacks послеcleanup refuse, no DB/HTTP/network execution.
- [x] 2.3 Прогнать original22cases в обычном ипереставленном порядке/повторно; cache/globals послекаждогоscenario exact restored, fake transactions не названы PostgreSQL locks.
- [x] 2.4 Записать netLOC/helper/wiring/newguards раздельно и reuse3→1; unrelated suites/source/package/lock/schema/CI diff0, meaningful local lint/typing/strict проходят.

## 3. Review и staging

- [x] 3.1 Получить independent code review exact4source paths+OpenSpec иverifiedlocal evidence; root отдельно разрешает atomic commit/integration.
- [ ] 3.2 Послеnormalmerge/CI API проверитьactualSHA/image/health/relevant readonly smoke наexistingstaging; secrets/privatefixture evidence не коммитить, main не менять.
