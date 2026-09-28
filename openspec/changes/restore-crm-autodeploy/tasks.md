# Tasks

## 1. Контракт и RED

- [x] 1.1 Зафиксировать согласованный контракт и изученный source-алгоритм; OpenSpec proposal/specs/design существуют.
- [x] 1.2 Написать регрессионный сценарий cached desired image + running old image; получить ожидаемый RED на модели старого source-алгоритма и сохранить результат.

## 2. Watcher и CI

- [x] 2.1 Реализовать проверку целевой среды, compose/container guards, lock и сравнение фактического web image; unittest покрывает обновление/noop/ошибки без серверов.
- [x] 2.2 Реализовать bounded health и проверку неизменности DB identity/mounts; unittest подтверждает отказ при drift и отсутствии побочных команд к БД.
- [x] 2.3 Добавить тесты в CI и OCI revision labels, сохранив needs:test; локальная проверка workflow и unittest проходят.
- [x] 2.4 Обновить инструкцию восстановления cron/W07 и записать локальное evidence; openspec validate --strict и git diff --check проходят.
- [x] 2.5 Устранить найденный review конфликт с W07 timeout: общий deadline и kill process group; fake-clock regression и Linux-тест реального дерева процессов проходят.
- [x] 2.6 Сохранить результат при перехваченном W07 stdout: защищённые snapshot/append journal; локальный тест записи и Linux-тест прав проходят.

## 3. Отдельная приёмка основным агентом

- [x] 3.1 Независимое ревью diff и повторная локальная проверка пройдены; замечания устранены.
- [ ] 3.2 Staging после зелёного CI реально обновляется, повторный запуск даёт unchanged, проверены web image/revision/health, неизменность db ID/mounts и W07 guard; evidence записано.
- [ ] 3.3 Только после staging-приёмки production проходит тот же цикл; ветка main публикует образ только при зелёных тестах, live evidence записано.
