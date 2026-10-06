# Tasks

## 1. Артефакты
- [x] 1.1 Создать change `field-work-task-self-assign` (proposal/spec/design/tasks на русском).
- [ ] 1.2 Согласовать артефакты с владельцем до приёмки.

## 2. Сервер
- [x] 2.1 `server/works/access.ts` canAddProductWork: разрешить MOUNTER то же, что WORKER (только PRODUCTION).
- [x] 2.2 `server/works/core.ts` addWorkCore: актор WORKER|MOUNTER, обязательный productId, проверки статуса/прайса/снимка без изменений.
- [x] 2.3 `server/works/queries.ts` listWorkPriceOptions: picker для WORKER|MOUNTER в PRODUCTION.
- [x] 2.4 `server/tasks/worker-allocation-core.ts` createWorkerTaskAllocationCore: актор WORKER|MOUNTER, получатель активный WORKER|MOUNTER (кросс разрешён), остаток и clientMutationId без изменений.
- [x] 2.5 `server/tasks/worker-allocation-queries.ts` listWorkerAllocationData: гейт актора и workerOptions для обеих ролей.
- [x] 2.6 Не трогать: createTask/updateTask/deleteTask, completion-core.ts (PIECE), nav.ts, tasks/page.tsx.

## 3. Интерфейс
- [x] 3.1 `products/[id]/page.tsx`: canAllocateWork для WORKER|MOUNTER в PRODUCTION (не менеджер).
- [x] 3.2 `projects/[id]/tasks-tab.tsx`: кнопки «+ Работа»/«Назначить задачу» и секция «Мои назначения работникам» работают для MOUNTER; подсказка пустого прайса «обратитесь к менеджеру».

## 4. Проверка
- [x] 4.1 Обновить тесты WORKER→FIELD (создание работ, назначения, UI) и добавить evidence-кейсы: монтажник создал работу в PRODUCTION; раздача 5 работ двум сотрудникам; DONE начислил PIECE; в DESIGN кнопок нет; сайдбар без Работ/Задач.
- [x] 4.2 `pnpm lint`, `pnpm --filter @pero/web test`, результаты в evidence ниже.
- [x] 4.3 Не коммитить/пушить/мержить (статус: только worktree, без коммитов).

## Evidence (06.10.2026, ветка feature/84, коммитов нет)
- git diff --stat: 7 файлов, 20 вставок, 15 удалений —
  products/[id]/page.tsx (4), tasks-tab.tsx (5),
  worker-allocation-core.ts (6), worker-allocation-queries.ts (6),
  works/access.ts (4), works/core.ts (6), works/queries.ts (4).
  Новые без коммита: openspec/changes/field-work-task-self-assign/
  (proposal.md, design.md, specs/field-work-task-self-assign/spec.md,
  tasks.md) и apps/web/tests/field-work-task-self-assign.test.ts.
- pnpm lint: 0 ошибок, 5 предупреждений в нетронутых файлах
  (cleanup-uploads.ts, product-attachments.tsx, product-percentage-pay/core.ts,
  income-form-native.mjs).
- pnpm --filter @pero/web test: 1253/1253 PASS, 0 FAIL —
  в том числе новый field-work-task-self-assign.test.ts 6/6
  (создание MOUNTER в PRODUCTION; 5 назначений двум сотрудникам +
  конфликт перерасхода + идемпотентный повтор; PIECE-математика DONE;
  кнопки и «Мои назначения работникам» для MOUNTER; DESIGN без кнопок +
  подсказка «обратитесь к менеджеру»; сайдбар без Работ/Задач).
- tsc --noEmit (@pero/web): чисто, без ошибок.
- Нетронутое подтверждено: nav.ts, tasks/page.tsx redirect,
  completion-core.ts, классические createTask/updateTask/deleteTask.
- Блокеры: нет. Требуется приёмка владельцем (staging/браузер) и
  согласование артефактов (п. 1.2).
