# Локальная проверка 28.09.2026

Ветка: `codex/restore-crm-autodeploy`. Среда: Windows, Python 3.12.10.
Все Docker-операции watcher в тестах заменены fake adapter либо mock subprocess. Серверы,
SQL, production/staging/local DB не использовались и не менялись.

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

## Оставшиеся проверки

### Независимая проверка основным агентом

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
  и подключения к БД. Это не приёмка серверной установки; live-файлы пока не менялись.

GitHub CI, реальный staging deployment с сохранением W07, повторный unchanged и production
deployment остаются незавершёнными. Их результаты заполняются после фактического
выполнения; наличие исходников не означает снятия server pause или установки cron.
