# Проверка автодеплоя CRM — 28.09.2026

Ветка: `codex/restore-crm-autodeploy`. Среда: Windows, Python 3.12.10.
В описанных ниже локальных тестах Docker-операции watcher заменены fake adapter либо mock subprocess;
серверы и SQL не использовались. Последующая фактическая приёмка основным агентом
на staging/production зафиксирована отдельно в конце документа.

## RED

До создания нового watcher написан один regression contract для двух состояний.
Старый source-алгоритм подтверждён чтением основным агентом live watcher: inspect
локального tag → compose pull web → inspect того же tag → up только при смене tag.
В тесте выполнена модель этого алгоритма, а не сам серверный shell.

```text
python deploy/tests/test_watch_crm.py --legacy-baseline ImageRegressionTests -v

test_pre_pulled_image_already_running_is_unchanged ... ok
test_pre_pulled_image_still_replaces_old_running_web ... FAIL
AssertionError: sha256:111... != sha256:222...
Cached tag already changed, but the running web is still old
Ran 2 tests
FAILED (failures=1)
Exit code: 1
```

Далее до доработки написаны проверки безопасного error context и передачи только
оставшегося timeout между двумя Docker-командами: получены ожидаемые ошибки
отсутствующих `image` и аргумента `timeout`; после реализации они зелёные.

Независимое review нашло конфликт с внешним W07 timeout 240 секунд и потерю
перехваченного stdout. До исправления новые тесты дали RED: сценарий после 181
секунды всё ещё делал up, отсутствовали общий deadline и защищённый журнал.

## GREEN

```text
python -m unittest discover -s deploy/tests -v
Ran 29 tests
OK (skipped=2)

openspec validate restore-crm-autodeploy --strict
Change 'restore-crm-autodeploy' is valid

git diff --check
Exit code: 0
```

Покрыты stale cached tag, текущий образ, новый registry image, неправильные
host/cwd/compose/labels/mounts, остановленные контейнеры, lock contention, ошибка
pull/up, drift compose/DB/tag, неверный итоговый image, bounded health, ограничение
команд только web, включение override, локальный socket и отсутствие секретов в
ошибках. Linux `flock` не исполнялся этими fake-тестами.

Две POSIX-проверки дополнительно реально выполнены в локальном Docker Desktop
контексте `desktop-linux` (endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`):
образ `python:3.12-alpine`, network none, worktree read-only, без Docker socket,
портов и подключения БД, контейнер удаляется штатным `--rm` после тестов.

```text
docker --context desktop-linux run --rm --network none --mount <worktree:/work:readonly> --workdir /work python:3.12-alpine python -B -m unittest discover -s deploy/tests -v
Ran 29 tests in 1.053s
OK
```

Linux доказал завершение дерева CLI (потомок игнорирует SIGTERM) после 1-секундного
timeout и отказ добавления записи в journal с mode 644. Journal сохраняется при
captured stdout; fake clock доказал min(per-command timeout, remaining total budget)
с резервом cleanup. Это локальные проверки subprocess/файлов, не server deployment.

CI сохраняет `needs: test` у `build-push` и `build-push-bot`; новый Python test step
находится в job `test`. Обоим образам добавлен `org.opencontainers.image.revision`.
Локальный разбор workflow через PyYAML и проверки обеих зависимостей и наличия
unittest step завершились успешно. Собственные `__pycache__` после проверки удалены.
Этот локальный результат не является проверкой выполнения изменённого workflow
на GitHub. Полный Node CI и server deployment выполняет основной агент.

## Приёмка основным агентом

### Независимая локальная проверка

- Пройдены `pnpm lint` (0 ошибок, прежнее предупреждение cleanup-uploads),
  TypeScript web/bot, `pnpm -r --if-present test`, production `pnpm build`.
- Reviewer закрыл P1/P2 watcher после исправления общего deadline и независимого
  журнала; root повторил Windows unit suite.
- Добавлен one-shot installer с exact-manifest guards, сохранением heartbeat и
  healthchecks. Reviewer нашёл ошибку отчёта после фактической активации cron.
  Regression RED: отсутствие durable intent, ошибки до/после replace cron и
  финальной записи receipt. GREEN: durable activation-intent и отдельный
  activation-unknown с readback; независимый повтор 7/7 installer tests PASS.
- Общий Python suite после installer: 36 тестов, Windows 34 PASS и 2 POSIX skip.
  Root отдельно повторил Linux suite: 36/36 PASS, network none, без Docker socket
  и подключения к БД. На этом локальном этапе live-файлы ещё не менялись;
  последующая серверная приёмка приведена ниже.

### Фактические CI и scheduled deployment

Основной агент подтвердил следующие результаты live-приёмки; эта актуализация
документации не сопровождалась новым запуском watcher, CI или проверками серверов/БД.
Обе среды получили ревизию `f535d5f7f0c9cd4b855e37cd5a0c784f532d519a`.

| Среда | Успешный CI | Штатный cron deployment (UTC) | Повторный результат |
|---|---|---|---|
| staging | [CI #44](https://github.com/navasiolau/pero_crm/actions/runs/36414902350) | 11:26:01.462050, `deployed` | 11:30:05.464290, `unchanged`, healthy, HTTP 200 |
| production | [CI #45](https://github.com/navasiolau/pero_crm/actions/runs/36416583485) | 11:45:15.451, `deployed`; web started 11:45:08.953114865 | 11:55:06.015262, `unchanged`; root повторно подтвердил `unchanged`/healthy/HTTP 200 в 12:20 |

Снимки: [staging](../../../../deploy/evidence/2026-09-28-autodeploy-staging.json),
[production](../../../../deploy/evidence/2026-09-28-autodeploy-production.json).
Image IDs: staging `sha256:d07edbbf17717614dd1f79d35a7f72a00226a8b03aa0d36969af5f47974fbb61`,
production `sha256:a6adca052b10a4d333107dbbc5aea856dfbf5eb0108ce57c4400ef063d34063d`.

- Обновление инициировал штатный cron каждые 5 минут, не ручной вызов watcher.
  Ветки `staging` и `main` публикуют соответствующий образ только после job `test`;
  `needs: test` сохранён у обоих publish jobs, упавшие тесты блокируют публикацию.
- Внешний W07 wrapper сохранён с SHA256
  `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139`;
  его lock/active-run guard и механизм refresh этим выпуском не менялись.
- DB container IDs, mounts и время старта сохранились. Проверка ограничена Docker
  metadata и штатным HTTP health; прямой SQL к production после запрета владельца
  не выполнялся. Это не заявляется как SQL-сверка строк или полное восстановление БД.
- Старые паузы CRM watcher и image pins ниже в исторических инфраструктурных
  документах больше не описывают текущее состояние CRM. CMS и прочие инфраструктурные
  паузы этим изменением не затрагивались.

Задачи 3.2 и 3.3 закрыты по этой приёмке. Основной агент 28.09.2026 перенёс
требования в `openspec/specs/crm-autodeploy/spec.md`, проверил точное соответствие
всех требований и сценариев и архивировал завершённый change.
