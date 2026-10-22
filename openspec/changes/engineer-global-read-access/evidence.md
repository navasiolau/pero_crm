# Проверки №194

Root native local5433 — PASS на SHA `e15d110cc8c9889bc958ec3356fc26fe2cb7ed97`: реальные Prisma predicates подтвердили три этапа проектов, пять статусов чужих изделий, вложенные списки/поиск/прямые lookup, общие и прикреплённые к чужой задаче техфайлы, эскизы/обложки. LEAD/ESTIMATE, DRAFT/PREPARATION и задачи скрытого родителя исключены. Чужие edit/execution/upload и общий проектный upload запрещены; собственные прежние права сохранены. Проба №193–194 полностью откатилась, все 77 таблиц и каталог совпали. Квитанция `C:/Users/admin/.codex/tmp/pero-crm-190-196/acceptance/local193-194.json`, digest `a5be1d2c9d2587ef46bcb438a8ed8d76fc2f950575574dc682b33f54ae1da3e5`.

Основание: согласованный план владельца и бриф `engineer-global-read-access`. Ветка `feature/194`, worktree `D:/Projects/pero_crm_worktrees/requests-194`. №193 `d6f38b3f` введена обычным merge `cb7852cc`; собственные изменения №194 не закоммичены и не опубликованы.

## Поведение

- ENGINEER читает CONTRACT/IN_WORK/DONE, включая пустой проект, и DESIGN/PRODUCTION/STORAGE/INSTALLATION/DONE при разрешённом родителе. Списки, карточки, опции, nested products, поиск и обычные технические файлы используют общие read predicates.
- Файл чужой задачи читается через проект и каждый указанный контекст изделия/задачи. Оригинал и preview проходят тот же ACL до storage. Секции GENERAL/MEASUREMENT/PRODUCTION/INSTALLATION, sketch/cover projections и retired-media guard сохранены.
- Задачи не получают глобальный read grant. Узкий RED на реальном `taskWorkspaceWhere` показал утечку собственного DESIGN task из LEAD/ESTIMATE; инженерный task read теперь дополнительно проверяет родителя и разрешённое изделие. FIELD/MANAGER union и taskExecutionWhere сохранены.
- Отдельный `productAssignmentWriteWhere` сохраняет прежнюю область создания/правки обычных работ и upload preflight. Создание ENGINEER+WORK_COORDINATOR на чужом PRODUCTION дало содержательный RED и стало GREEN после guard. Project-level upload использует прежний assigned project grant; новый общий просмотр CONTRACT не даёт загрузку GENERAL. Для ENGINEER+FIELD чтение чужого DONE не даёт новую загрузку. Sketch target по-прежнему проверяется через productEditWhere и соответствие файла изделию/проекту.
- Самостоятельного work read route без parent/product/task guards не найдено; assignedWorkVisibilityWhere не менялся. Назначение/переназначение/распределение из №192 не затронуто.
- Денежные маски и FinanceDocument policy сохранены. ENGINEER+FIELD получает доступное инженерное техописание; чужие начисления/цены не добавляются.
- Фильтр инженера показан в двух разделах. Первый bare route выбирает self, прежнее пустое скрытое состояние обновляется, явный URL имеет приоритет. Маркер в совместимом JSON V2 сохраняет осознанный All/другого инженера; CAS, разделение пользователей/разделов и сброс сохранены.

## Автоматические проверки

Команды выполнялись через `pnpm --config.verifyDepsBeforeRun=false --filter @pero/web exec ...`.

- Содержательный RED: новые engineering read/file случаи, первый self, task workspace под LEAD/ESTIMATE, прежняя граница coordinator create. Падения происходили по ожидаемому поведению.
- GREEN: 119 scoped tests чтения/фильтров/масок/кодеков, затем адресные прогоны после preservation fixes. Последний набор `engineer-access`, `engineer-global-read`, `task-reward-workspace`, `work-coordinator-role`, `file-list-view`, `file-upload-transport-handler`: 85/85 PASS. Дополнительно прошли существующие status-return/idempotency и FinanceDocument HTTP/security cases.
- `tsc --noEmit --incremental false`: PASS; ESLint всех изменённых/новых TS/TSX/MJS: PASS.
- `git diff --check`: PASS. Прежние structural assertions затронутых access tests заменены проверками поведения relational fixtures.
- `openspec validate engineer-global-read-access --strict`: PASS. `openspec validate --specs`: 5/5 PASS. Основные `engineer-product-access` и `persistent-list-state` синхронизированы, прежние сохраняющиеся сценарии сохранены.

## Браузер

Настоящие React Views, фильтры Base UI, ListParams/controller, DnD и Tailwind; только Next/actions transport заменён memory boundary. Тесты `project-filter-component` и `global-kanban-current-engineer-component`: PASS. `kanban-render-isolation`: PASS, 23 сценария, включая ENGINEER columns/filter при 1440×900, 390×844, 360×800. Скриншоты лично просмотрены; отдельные mobile filter screenshots сохранены.

Артефакты последнего прогона: `C:/Users/admin/.codex/tmp/pero-crm-190-196/requests-194/browser/07adab3c-58e6-4c9d-b906-ec081bd7f2bd/receipt.json` и соседние PNG; source manifest фиксирует фактические входы harness. Команда: `KANBAN_RENDER_ARTIFACT_DIR=<C-path> ... exec tsx --test tests/kanban-render-isolation.test.mjs`.

`kanban-search-focus-browser.mjs both` прошёл инженерный case скрытой PREPARATION и 35 сценариев, затем FAIL на прежнем raw-CDP touch в products/390 (строка 237, ожидание движения 5 с). FAIL receipt сохранён: `C:/Users/admin/.codex/tmp/pero-crm-190-196/requests-194/search-focus/receipt.json`. Повторный большой прогон не выполнялся по поручению Root; совместная проверка scrolling после обычного merge №196 остаётся Root.

## Ограничения и сохранённое состояние

Это component/DI приёмка, не полная Next/DB/staging/production приёмка. Docker/local runtime изначально был выключен; Root взял финальную реальную UI/DB проверку общего SHA на себя и запретил отдельный новый web/DB стенд. Native PostgreSQL regression обновлён в существующем `domain-postgres.test.ts`, но здесь не запускался.

Миграции, БД, инфраструктура, seed/reset/dump, restic/S3 cleanup не выполнялись. Из-за малого места D: зависимости установлены с frozen lock в отдельный C: virtual-store по поручению Root; версии/lock не менялись, следующие pnpm exec не запускали auto-install. Секреты не выводились.

Перед dependency merge сохранён stash `ae1b31b8acb14b4e59c28c2d53566c5b61b24591`, apply успешен, файлы исходного diff проверены на наличие. Stash сохранён для Root до окончательного review/commit; чужие stash не менялись. Staging/production приёмка и выпуск не заявлены.

## Уточнение существующих HTTP-проверок после CI

В `file-responses.test.ts` и `files-crud.test.ts` исправлены устаревшие ожидания: ENGINEER читает чужие DESIGN/PRODUCTION при разрешённом родителе, а снятие назначения сохраняет чтение и cached 304. Отрицательные проверки используют временные LEAD/PREPARATION с восстановлением исходных полей и `updatedAt`; запреты загрузки и проверки сохранности файлов/S3 сохранены.

ESLint двух изменённых файлов и `git diff --check` — PASS. HTTP-тесты и БД для этой правки не запускались; HTTP PASS ожидает CI.
