# Операторская стадия №190

Cutoff подготовлен, **не выполнялся**. Schema migration отсутствует. Production этим операторским модулем не поддерживается.

`apps/web/scripts/retire-task-time.ts` только экспортирует `planTaskTimeCutoff` / `applyTaskTimeCutoff`; прямой CLI печатает INERT и не создаёт соединение. Модуль не вызывается из web, API или cron. Не добавлять флаг, который выдаёт себя за проверку writers.

Root предоставляет `TaskTimeCutoffPorts` через существующий reviewed transport:

- `transaction` — настоящая единая транзакция разрешённой БД; ошибка любого guard/записи откатывает всё.
- `verifyTargetAndNoOldWriters(expected, retiredRevision)` — **живая** проверка exact runtime SHA/образа, всех процессов writers и local5433 либо существующего paired staging. На staging использовать текущий paired transport с проверкой его сетей/изоляции, а не предполагать прежний single-network состав. Проверка возвращает точную фактическую target identity или бросает ошибку. Не заменять её прочитанным когда-то JSON/булевым согласием.

В request передаются новый UUID операции, ID действующего ADMIN, прежний полный SHA `retiredRevision` и target: `kind=local5433|staging`, **новый** полный SHA `revision`, фактический `imageDigest` (обязателен staging), database `{name,schema,systemIdentifier}`. Имена разрешены только `pero_crm/public` для local5433 и `crm/public` для staging; точный Postgres systemIdentifier повторно сверяется внутри цели. Новый SHA должен отличаться от прежнего и содержать закрытые writers №190.

1. Принять новый код/образ и доказать отсутствие всех старых writers, включая старые процессы/вкладки через новый сервер. Убедиться, что root transport указывает на разрешённую БД.
2. Вызвать `planTaskTimeCutoff(ports, request)`. Сохранить полный план приватно, проверить точные ID, число открытых таймеров и `fingerprint`. Plan не меняет данные.
3. Вызвать `applyTaskTimeCutoff(ports, plan, reviewedFingerprint)` для того же проверенного плана. Нельзя пересоздавать план незаметно при snapshot mismatch.
4. Сохранить returned receipt и ChangeLog `task-time-cutoff:<operationId>`: cutoffAt и точные `closedIds`. Сверить сохранность закрытой/manual истории, Task status/estimate и payroll. Повторять при потерянном ACK только **тот же план/hash/UUID**.

Внутри применяются общий advisory lock `(18435,55001)` и `LOCK TABLE TimeEntry ... NOWAIT`; snapshot должен совпасть. Один `clock_timestamp()` задаёт cutoff всей операции. Меняются исключительно `source=timer AND stoppedAt IS NULL`, с прежней `timerStopSnapshot`: минимум 1, максимум 720 минут, capped stoppedAt/autoStopped. Каждая строка имеет точный CAS и отдельный аудит. Итоговая квитанция хранит полный список изменений. Статусы задач, оценки, назначения и зарплата не записываются.

При guard mismatch, новом writer, изменившемся snapshot, lock conflict или неоднозначном ответе — СТОП; сохранить доказательства и исходный UUID. Повтор после доказанного commit читает сохранённую квитанцию, не закрывает последующие строки и не меняет время cutoff.
