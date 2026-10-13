# Историческая приёмка первой группы изменений CRM

Проверенная ревизия приложения: `a1123c5f8a498dc916a67e609a4a550720367fc2`.
Локальная и staging-приёмка предшествовали push в main; затем подтверждены CI и
фактический production image. Код каждой фичи, её тесты и OpenSpec находятся в
отдельном функциональном коммите. Этот комплект сохраняет полученные после
публикации результаты и архивирование спецификаций.

## Результаты

- Локально: 102 web tests, 9 bot tests, TypeScript, ESLint и production build;
  существующая БД `127.0.0.1:5433/pero_crm`. Интеграционный browser suite фильтров:
  8/8, четыре настройки восстановлены CAS, бизнес-счётчики прежние.
- Staging: 13 групп read-only проверок PASS; один профиль MANAGER+ENGINEER
  отсутствует и обозначен NOT_AVAILABLE. Он проверен локально и модульно.
  Семь существующих чистых ролей, 184 проекта и 1325 изделий проверены; хэши
  13 бизнес-таблиц, ChangeLog и TimeEntry не изменились.
- Браузер staging: 12 сценариев на 360×800, 390×844 и 1440×900 пройдены в двух
  прогонах. Root просмотрел все 21 PNG. После каждого из этих двух прогонов
  четыре настройки точно восстановлены к принятому baseline, 15 таблиц сохранены.
- Первый browser run выявил потерю ответов в QA capture. Guard остановил cleanup;
  две созданные canonical-настройки `view=kanban` оставлены как baseline. Прежде
  list/legacy-view строк не было, что также означало «Канбан». Непроверенная
  ревизия не удалялась и не объявлялась доказанно своей. Побайтовое восстановление
  этого первого прогона не утверждается. Capture теперь сохраняет фактический
  ответ одного upstream запроса до передачи неизменённых байтов браузеру.
- HTTPS и Basic Auth staging проверены; роли проверялись подписанными сессиями
  существующих пользователей. Это не проверка парольного входа. Фото/таймеры
  проверены отдельно на разрешённых локальных QA-записях, не на staging.
- Production: только Docker metadata и штатный HTTP health. Прямых SQL, фикстур
  или новых миграций в production в этой группе не было.

Deployment receipts: [staging](../evidence/2026-09-28-first-wave-stage-deployment.json),
[production](../evidence/2026-09-28-first-wave-production.json).
История TDD и подробная приёмка находятся в `openspec/changes/archive/2026-09-28-*`.

## Вывод одноразовых helpers из эксплуатации — №168

Закреплённые на `a1123c5` wrapper `staging-first-wave.py`, координатор
`staging-first-wave-runner.mjs`, его read-only/browser helpers и
`staging-browser-session.mjs` удалены после завершённой приёмки. Их команды
`readonly`, `browser`, `inspect` и `restore` больше не поддерживаются.
Результаты выше, deployment receipts и архивные OpenSpec evidence сохраняют
историческое значение; они не подтверждают приёмку новой ревизии.

Для действующей приёмки используются согласованный change и существующие
qaTransport/crm-modernization wrappers с W07, DB/S3 и image identity guards.
Точный SHA и сценарии подтверждаются отдельно; общий порядок описан в
[действующих инструкциях проверки](../../docs/testing/README.md).

В продолжении №168 закрыты старые cash staging seal/FX и engineering
backup/window/QA/metadata/preflight операторы, а также завершённый quantity
staging/CI комплект. Они привязаны к прежним выпуску, worktree и QA-графу;
их повторный запуск больше не поддерживается. Закрытый `staging-work-shares.py`
выведен из эксплуатации; текущий `crm-modernization-staging.py` сохраняет защиту цели и W07. Одноразовый
percentage backup/release-контур закрыт; чистые проверки сохранности его
legacy markers и строк остаются в web tests. Исторические receipts и архивные результаты
не изменяются и не доказывают проверку нового SHA.

Приватные checkpoints, ответы, JWT, PII, traces и PNG исторической приёмки
остаются вне Git в `.playwright-mcp/staging-first-wave/`. Этот архив не даёт
разрешения на повторные записи в БД. По AGENTS.md local/staging дампы для
задач не создаются; nightly refresh и W07 сохраняются.
