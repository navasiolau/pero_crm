# Staging-приёмка №212 — 10.11.2026

## Принятая техническая ревизия

- Функциональный коммит: `4983cf70691ac9f667d52f9220221ccde85330d0`.
- Дополнение CI: `edb006a7971c55969f0f1bacfc6ff4e0f74215c2` — новый browser regression включён в Chromium cohort; локальные CI-scheduling tests 3/3 PASS.
- Staging merge: **`efe1607ffa14384d07ea8638222c6eee3d66dfda`**.
- [CI 42872052393](https://github.com/navasiolau/pero_crm/actions/runs/42872052393): **7/7 success**, включая обе browser cohorts, backend, native runtime, renderer и публикации. Ранний запуск `7139a265` отменён как заменённый исправленным CI-распределением теста.
- Реальный web image: `sha256:8cccb82ee2f49b028bc1532e0b8a15369167191a15b57c354064fe20c9dab05f`, контейнер `3236cd6eb7f28dd66d59dff7bf906a728674444b1781717a2185561552d0b0bd`, healthy.
- Renderer image: `sha256:ee2eafd59c1ddb511323d301e631422f77e99886c4087875fb7658490bf1b555`; связанная пара имеет тот же revision и healthy.
- Штатный внешний W07 entrypoint выполнил deployment. Публичный [staging](https://staging-crm.peromebel.by) и `/api/health` отвечают HTTP 200, база `ok`.

## Реальные сценарии

**40/40 PASS** в Chromium через настоящий публичный HTTPS/App Router и существующие данные staging:

- Проекты и изделия: Back, Forward→Back, ссылка из карточки, пункт меню.
- Размеры 1440×900, 390×844 и 360×800.
- Клавиатура, Shift+wheel и нативный touch после возврата.
- Обе координаты прокрутки, нижняя полоса и положение открытой карточки восстановлены; максимальное отклонение — **0 CSS-px**.
- 0 page errors, 0 неожиданных запросов, 0 потерянных подтверждений сохранения настроек.
- Сохранены и лично просмотрены 12 скриншотов до/после. На холодном удалённом маршруте ожидание завершения навигации в QA увеличено с локальных 5 до 30 секунд; допуск координат не менялся.

Авторизация использовала краткоживущую подписанную сессию существующего пользователя и действующий Basic Auth; пароль/роли/аккаунт не менялись. В тесте разрешены GET, существующие read-actions и только две list-preferences; прочие POST блокировались. ACK настройки сохранялся из единственного upstream-ответа **до** передачи ответа браузеру.

После теста настройки возвращены точным CAS по сохранённому ACK. Count/hash всех **14 контролируемых таблиц** совпали с исходными. Дополнительно совпали с baseline, снятым до проблемы с диском и до deployment. Новые бизнес-записи, seed/reset, миграции и дампы не выполнялись.

## Проблема диска и восстановление staging

До выкладки на CT101 накопилось **269 образов / 4 используемых**, Docker показывал 13,38 GB reclaimable. Квота rootfs 32 GiB оказалась заполнена. Первые pull завершались `pull-timeout`, затем прямое скачивание показало `disk quota exceeded` для metadata containerd. Заполнение также остановило PostgreSQL staging; публичный health временно отвечал 503.

Устранено в пределах staging:

1. Все действия привязаны к hostname `crm-staging`, конкретным container/image IDs, существующему volume и W07 lock.
2. Для разблокирования записи metadata удалены только два проверенных восстанавливаемых индекса `/var/cache/apt/pkgcache.bin` и `/var/cache/apt/srcpkgcache.bin`; пакеты не менялись.
3. Через Docker API без force/prune удалены **34** старых неиспользуемых web-образа CRM по двум точным спискам; их revisions предварительно проверены в Git. Текущие образы, ссылки всех контейнеров и свежие rollback-версии сохранены. После выкладки и второй ограниченной уборки свободно **1808 MiB**.
4. После сбоя Docker оставил orphan endpoint старого остановленного DB-контейнера. Восстановлено только это подключение, с возвратом исходных имени, сети и aliases; остальные endpoints совпали. Контейнер, образ и volume БД сохранены. Удаление/пересоздание БД или сети не выполнялось.
5. БД снова healthy. Её прежний ID `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a` и volume `crm-staging_pgdata` сохранены; новый StartedAt после восстановления — **`2026-11-10T18:42:15.758341834Z`**. Временный QA guard обновлён на этот доказанный restart; host watcher/W07/cron не переписывались.
6. До продолжения deployment отдельная read-only проверка подтвердила исходные count/hash 14 таблиц. После deployment и UI-проверки сверка повторена успешно.

Для диагностики использовались [официальная справка disconnect](https://docs.docker.com/reference/cli/docker/network/disconnect/) и [обсуждение orphan endpoints в Moby](https://github.com/moby/moby/issues/33156); конкретный результат подтверждён собственными before/after metadata, а не предположением о версии Docker.

## Evidence и дальнейшая работа

Приватные evidence: `.playwright-mcp/task-212/release/` — `ci-current.json`, `deployment-trigger.json`, `staging-current.json`, `runtime-receipt.json`, `stage-restored.json`, `incident-data-preservation.json`, `final-data-preservation.json`, точные image allowlists/cleanup receipts, `database-recovery.json`, `network-before.json`, screenshots. Секреты и cookies не коммитятся.

Техническая приёмка staging завершена. Следующая проверка — владельцем на staging. **Main/production не выпускались**; remote main остался `f5c0cdb1a6c9549b8ab999330d7169de86d22117`.

Причина накопления образов: в действующем watcher нет retention и проверки запаса до pull. Подготовлен отдельный план №213 `crm-image-retention`: текущая + две предыдущие успешные версии, сохранение всех используемых образов, проверка свободного места перед pull и ограниченная очистка только собственных image IDs. Автоматический механизм пока не установлен; ручная уборка в этой задаче его не подменяет.
