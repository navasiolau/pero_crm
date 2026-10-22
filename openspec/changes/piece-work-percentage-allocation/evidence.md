# Проверки №191

Дата: 22.10.2026. Ветка `feature/191`, база `3def4f0c`; зависимость №190 принята оркестратором и влита обычным merge `dd91a049c62f81239f0301682994785d5fe07eb1` из `dea3ae5268a9bf48e5d69a9823b10017ddc9c03e`.

- `pnpm install --frozen-lockfile` и генерация Prisma Client: PASS, lockfile сохранён. Команды миграции/БД не запускались.
- Начальная regression-проверка 50 тестов arithmetic/core/dialog/исторического settlement/retirement/transaction/privacy: PASS до интеграции №190. После ревью добавлен отдельный отказ устаревшей начальной ревизии, включая смену расценки.
- После merge №190: 31 релевантный тест `piecework-allocation`, `piecework-allocation-dialog`, `work-shares-settlement`, `production-worker-allocation-ui`: PASS. Новые N долей выполняются через настоящий `changeTaskStatusCore` с запретом любого доступа к `TimeEntry`: ровно 500/300/200 BYN, повтор DONE не добавляет начислений, смена Work.priceSnapshot не меняет суммы.
- Типизация web `tsc --noEmit --incremental false`, scoped ESLint изменённых файлов, `git diff --check`, OpenSpec strict: PASS. После финального изменения мобильной сетки повторены 4 затронутых UI-теста: PASS.
- Chromium, настоящий `PieceworkAllocationDialog`, настоящие Base UI/Tailwind/SearchableSelect, синтетические данные/transport: PASS на ширинах 390 и 1440. Проверены N=3, 50/30/20, 500/300/200 BYN, текущая доля 500 BYN → передача 20% = 100 BYN, остаток 400 BYN, блокировка после потерянного ответа и идентичный повтор UUID/payload. Скриншоты визуально просмотрены; мобильные участники переведены в адаптивную сетку.
- Browser receipt и PNG находятся в ignored `apps/web/test-results/piecework191/`. Браузер и временный локальный HTTP helper остановлены после проверки; обращения к БД отсутствовали.

## Ограничения приёмки

Нативные PostgreSQL-проверки и полный сценарий CRM с реальной авторизацией/ролями/БД: NOT_RUN этим исполнителем по запрету записи в БД. Component browser не является доказательством staging или полного приложения. Развёртывание, миграции, push и production не выполнялись.

Старый `splitTaskCore` и команды передачи процентных фондов остаются закрытыми; новый namespace `piecework-v1` допускает только обычные LEGACY без специальных связей. Исходная расценка сохраняется в immutable receipt вместе с объёмом, бюджетом и валютой, сами денежные начисления используют `shareAmount`.

Stash перед merge: `c31c4134b5987c3a0db09422872f23bd1e469ec0`, оставлен для оркестратора. Единственный конфликт `task-share-fixture` разрешён с сохранением `timeEntries` из №190 и `stageSettlementShares` из №191.
