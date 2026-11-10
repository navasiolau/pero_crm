# Приёмка автоматической уборки №213 — 10–11.11.2026

## Ревизии и установка

- Ветка `feature/213`: `82105197` — реализация, `a34f1221` — корректное распознавание managed digest refs в RepoTags Docker/containerd.
- Принятый staging: **`30473e7f8bca76e843f1ec34580bcb5ca7133f5b`**.
- [CI 42897663688](https://github.com/navasiolau/pero_crm/actions/runs/42897663688): **7/7 success**, стандартный workflow не менялся. Предыдущий запуск `b3829d75` отменён после выявленного дополнения обработки immutable refs.
- Установленный `/opt/crm-staging/watch-crm.py`: SHA256 **`4b69eebb8b9ab51947ec75a81eeb1464aedcb3c8570995524c3fd5700175e241`**. Это точные канонические bytes Git-файла принятой ревизии, 53 237 bytes.
- Backup/receipt только заменённого helper: `/root/pero-213-image-retention-4800637b-2d58-4f04-9ae9-782606360448`. До замены SHA helper был `287700d3ed51167531b8e79b5cf03acf3dd23f750dec2df6cc38e4258c81a78b`.
- Установка под существующими W07 и watcher locks не меняла контейнеры, compose, startup command, внутренний/внешний entrypoint и `watcher.json`. SHA всех остальных защищённых файлов до/после совпали; прежний W07 entrypoint вызывает обновлённый helper.

## Проверки до установки

- 83 локальных deploy-теста: 81 PASS и 2 ожидаемых Windows skips для Linux process groups; CI выполнил стандартные проверки на Linux.
- Read-only staging preview: 173 кандидата и 41 защищённый ID в первоначальной версии, metadata четырёх контейнеров до/после совпали.
- Обнаружено, что Docker/containerd помещает immutable `repo@digest` в RepoTags. RED→GREEN regression устранил ошибочную вечную защиту старых renderer; именованные/custom tags остаются защищёнными.
- После backend/native CI на staging проверен ограниченный подготовительный проход: 16 неиспользуемых старых web-образов удалены, свободное место выросло с 1 895 563 264 до 3 583 377 408 bytes; приложение и установленный тогда helper не менялись.
- Отдельно реальным Docker API без force удалён один подтверждённый старый renderer с managed digest ref. Текущая пара и metadata контейнеров совпали до/после.

## Штатный цикл

1. После установки обычный W07/watcher развернул приложение `30473e7f`, web и renderer healthy. Пост-уборка после длительного pull завершилась `image-history-deadline`; здоровое приложение не откатилось, БД сохранилась, продолжение осталось следующему проходу.
2. Следующий штатный проход по расписанию (результат **2026-11-10 20:56:01 UTC**, после слота 20:55) дал `status: unchanged`, `health: healthy` и выполнил уборку:
   - preflight удалил 12 образов и поднял запас с 2 841 247 744 до 3 846 176 768 bytes до pull;
   - после проверки текущего образа удалены ещё 20 образов; сработал предусмотренный предел прохода `bounded-pass`;
   - защищённые версии: `30473e7f`, `efe1607f`, `f5c0cdb1`;
   - после завершения GC наблюдалось **5 561 778 176 bytes** свободного места.
3. Оставшиеся старые кандидаты обрабатываются последующими штатными проходами. Неопознанные образы, именованные pins, текущая/две предыдущие пары и ссылки любых контейнеров не удаляются.

DB container ID `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, image, mounts, volume и StartedAt `2026-11-10T18:42:15.758341834Z` до/после установки и автоматической уборки совпали. SQL, действия с DB-контейнером/томом, S3, restic, user files, cron и миграции не выполнялись. Проверки БД здесь — только Docker metadata и штатный HTTP health, не запросы к таблицам.

## Production

№212 выпущен на production `efe1607f`; стандартный CI/мигратор сохранён. №213 на production пока **не установлен**.

Read-only preview №213 на production показал 34 старых кандидата и 25 защищённых IDs, версии `efe1607f` / `f5c0cdb1` / `38899d64`, свободно 12 605 063 168 bytes. Проверка не выполняла pull/up/rm, не записывала журнал и не меняла контейнеры; candidate исполнялся в памяти, установленный helper оставался прежним. Для установки запрошено отдельное решение владельца.

## Evidence

Локальный ignored каталог `.playwright-mcp/retention213/`: `ci.json`, `candidate.json`, `preview.json`, `bootstrap.json`, `digest-probe.json`, `install-receipt.json`, `host-before.json`, `host-after.json`, `scheduled-run.json`, `production-preview.json`, reviewed scripts. Приватные входные данные не включены в Git. Коммиты приложения в production в этой фазе не выполнялись; main остаётся `efe1607f`.
