# Evidence

## Scope and approval

Задача №158, `feature/158`, собственный `D:/Projects/pero_crm_worktrees/improvements-158`. После fresh fetch база — `origin/staging` d121f0798e963f32d13f52c9bde57c0aa82b7929. Root согласовал scope до production patch: только два retired share-модуля и необходимый regression. Main/production не затронуты.

Existing `remove-task-payment-shares/specs/task-payment-share-retirement/spec.md` уже требует запрета новых распределений для всех ролей и допускает только точный исторический actor/fingerprint replay без записей. Spec-level поведение сохраняется: `skip_specs: true`, дополнительный conditional design.md не требуется. Все consumers `splitTaskCore`/`SplitTaskResult` проверены; удаляемые поля использовала только недостижимая wrapper-ветка.

## Local verification

1. `pnpm install --offline --frozen-lockfile --ignore-scripts`:724 packages, reused721, downloaded0. Первый baseline выявил исключительно отсутствие generated Prisma Client (21 PASS/17 import-or-hook failures, tool4ffac8); он не считается принятым baseline. Root разрешил source-only generation. Два cached Prisma6.19.3 engines из read-only source132 скопированы только в отсутствующие ignored пути own worktree: schema f2b48e3ce8de8712c9dce6c71f952bec383fa472830b91bca8e64b4b51bf0dd7, query263946105f428384d2318dc3241b85b1c3dd98fbb1bfac62d3e81f513ab35897. `pnpm db:generate` PASS (38ec1e), без подключения к БД, миграции или сети.
2. До production patch существующие 6 suites проходят60/60 (0d6fc1). Недостающее action-level покрытие добавлено в existing `work-shares-settlement.test.ts`: exact replay возвращает прежний childTaskId и прежний порядок revalidation; изменённые recipient/percent/revision/UUID и wrong actor отклоняются; no writes, no external effects, весь fixture state неизменен. С добавленным regression ДО patch61/61 PASS (531761).
3. ПОСЛЕ patch 8 suites70/70 PASS (9e2556): прежние6 плюс product-percentage-sql-constraints и crm-byn-domain. Команда из apps/web:

```powershell
pnpm exec tsx --test --test-reporter=spec tests/task-share-retirement.test.ts tests/task-share-retired-ui.test.ts tests/work-shares-core.test.ts tests/work-shares-settlement.test.ts tests/product-engineering-split.test.ts tests/product-percentage-pay.test.ts tests/product-percentage-sql-constraints.test.ts tests/crm-byn-domain.test.ts
```

4. `pnpm exec tsc --noEmit --incremental false`:PASS52ce79/session21458→ba5861 exit0.
5. `pnpm exec eslint src/server/tasks/share-core.ts src/server/tasks/share-actions.ts tests/work-shares-settlement.test.ts`:PASS91445d exit0.
6. `openspec validate simplify-retired-task-split --strict`:PASS20f7d8. `git diff --check`:PASS9b466d.
7. Read-only AST comparison (811f87) confirms unchanged `schema.safeParse`, `splitAllocation`, `resolveVisibilityActor`, `tx.task.findFirst`, `tx.changeLog.findUnique`. Actor/entity/action/recipient/normalized-percent/revision/childTaskId/groupId receipt predicate unchanged after LF normalization. An initial measurement guard stopped because git-show used LF and checkout CRLF (ed213a); read-only diagnosis c3fb3e confirmed normalized equality, then only measurement comparison was corrected. No production guard was weakened.

Тесты используют существующие in-memory fixtures; DB/runtime/browser запусков и новых стендов нет. Schema, все SQL migrations, финансовая арифметика, share-policy, закрытые engineering endpoints и inert TaskSplitDialog без изменений. DI/AST результаты не выдаются за staging acceptance.

## Code reduction

Измерение 811f87: LF-normalized source, esbuild TypeScript→ESM ES2022 minify, gzip level9 отдельно для каждого модуля; зависимости external, bundling не выполнялся.

| Метрика двух production-модулей | До | После | Изменение |
|---|---:|---:|---:|
| Физические строки |89|82|−7|
| UTF-8 source bytes |5865|5187|−678|
| Minified module JS bytes |4296|3731|−565|
| Сумма отдельных gzip module bytes |1763|1549|−214|

Убраны2импорта,1недостижимая effect-ветка и4ненужных result fields. `repeated:true`, `groupId` и данные revalidation сохранены. Regression suite выросла на28 net lines; это отдельная стоимость необходимого action-level покрытия. Частный JS delta не доказывает уменьшение deployed Next.js bundle или latency.

## Independent review and staging

Независимый агент independent_cleanup_review выдал CODE_COMMIT_GO без замечаний для exact source: core f22b090bfa2fdc9c22fb4a7f3582d29eab1e39826bc29a429641c2fd13ce70f0, actions 08280f008283f9d57ce255233bec13b47daabf99ed7d5e02da47ab37e292cede, test 86ac4d19cb5f2864b31ca8d77ec0f4c10ccc5841d64f95099da64d8805c8df74. Root разрешил атомарный commit только семи файлов задачи; право на коммиты по всему плану ранее явно выдано владельцем. Проверка перед commit подтвердила те же source hashes; никаких повторных тестов, browser/native или memory-run не выполнялось. Push/merge/deploy выполняет Root; staging SHA/образ/health и retired сценарии ещё не приняты. Задача №158 пока не завершена.
