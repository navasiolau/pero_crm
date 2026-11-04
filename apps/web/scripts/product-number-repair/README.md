# Точечная коррекция изделия 1.64 → 1.15, №211

Владелец 04.11.2026 после READ ONLY выбрал **только это изделие**, ID `cmw1xgkk8001opd01mal0r7ad`, проект ID `1`. Остальные 14 изделий сохраняются буквально, включая текущие пропуски. Согласованный исходный состав: 1.2–1.5, 1.7–1.12, 1.14, 1.61–1.64. Это ограниченная коррекция данных; обычные создание/удаление после выпуска используют последовательность 1…N.

Схема БД не меняется. По отдельному указанию владельца перед выпуском 04.11.2026 создаётся один production-дамп с изолированной проверкой восстановления; это исключение из прежнего плана без дампа. Reset/seed существующих данных, S3 и restic не используются. Исторические документы, финансовые и производственные факты не переписываются.

## Проверки и применение

1. Прочитать `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`. При mismatch остановиться; не менять guards под неожиданные данные. Коммит, staging и main выполняются по разрешениям владельца. Применение — после штатного CI, staging-приёмки и подтверждённого production deployment.
2. Из корня worktree собрать одноразовый bundle. Используются уже установленные tsx/esbuild, без новых зависимостей:

```powershell
pnpm --filter @pero/web exec node -e "const {createRequire}=require('node:module'); const r=createRequire(require.resolve('tsx/package.json')); r('esbuild').buildSync({entryPoints:['scripts/product-number-repair/run.ts'],outfile:'../../.playwright-mcp/task-211/number-repair.bundle.mjs',bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:'tsconfig.json'});"
```

3. Перед каждым apply выполнить свежий `check` на полном SHA принятого production. Каждый `--out` — новый файл внутри ignored `.playwright-mcp`. Значение `<SHA>` в командах заменить фактическим SHA; `production-check-approved.private.json` от старого deployment нельзя использовать после нового выпуска.

```powershell
python apps/web/scripts/product-number-repair/remote.py check --revision <SHA> --bundle .playwright-mcp/task-211/number-repair.bundle.mjs --out .playwright-mcp/task-211/check-<SHA>.private.json
```

Dispatcher проверяет PVE → CT100 hostname crm, compose identity, SHA web/renderer, здоровые сервисы, прежний DB container/start time/volume, сети, watcher hash и S3 binding. Приложение отдельно проверяет DB name/schema/user, фактический состав и фиксированный ID изделия. Секреты остаются в целевом процессе. Check не пишет бизнес-данные или receipt.

4. Сверить результат check с согласованным изменением. Apply повторно проверяет baseline и protected hash, берёт те же locks, меняет одну Product-строку (`number`, `suffixInt`, служебный `updatedAt`), закрепляет старые Notification.link за ID и создаёт один audit/receipt. Несовпадение других строк или защищённых данных откатывает транзакцию.

```powershell
python apps/web/scripts/product-number-repair/remote.py apply --revision <SHA> --bundle .playwright-mcp/task-211/number-repair.bundle.mjs --baseline .playwright-mcp/task-211/check-<SHA>.private.json --out .playwright-mcp/task-211/apply-<SHA>.private.json
```

Точный повтор того же baseline возвращает сохранённый результат без новой записи. После rollback повтор apply прежней операции запрещён.

5. Проверить свежим чтением: прежний ID имеет 1.15/15; остальные 14 строк совпадают с baseline; задача/файлы/назначения/цены/количество/начисления/снимки сохранены. В браузере заново открыть проект, карточку по ID и поиск 1.15. Старый alias 1.64 больше не является действующим номером. Полную непрерывность состава при этой ограниченной коррекции не заявлять.

## Обратная операция

Выполняется только по отдельному решению об отмене. Требует тот же deployment и baseline, неизменный состав/updatedAt/защищённые данные после apply, свободный действующий 1.64. Возвращает тот же Product ID к 1.64/64, сохраняет стабильные ссылки по ID и пишет компенсирующий audit/receipt. Restore из дампа не применяется.

```powershell
python apps/web/scripts/product-number-repair/remote.py rollback --revision <SHA> --bundle .playwright-mcp/task-211/number-repair.bundle.mjs --baseline .playwright-mcp/task-211/check-<SHA>.private.json --out .playwright-mcp/task-211/rollback-<SHA>.private.json
```

## Локальная приёмка

`local-acceptance.ts` проверяет native SQL в rollback-транзакции существующей БД 5433 и сравнивает fingerprint всех исходных данных. `browser-fixture.ts` создаёт только собственные QA211-записи в той же разрешённой БД; `race` синхронизирует две реальные PostgreSQL-сессии, `cleanup` проверяет принадлежность и удаляет только эти записи с повторной сверкой исходных fingerprints. Нужен `CRM_LOCAL_CONTAINER_ID`, подтверждённый чтением metadata существующего `pero_crm_pg`; CLI не создаёт контейнер или БД.
