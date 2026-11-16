# Заполнение истории журнала №222

Runner: `pnpm --filter @pero/web exec tsx scripts/journal-backfill.ts`.

Запускает только оркестратор после проверки target/revision и, для staging, штатной W07-защиты. Скрипт не читает env-файлы автоматически, не меняет infrastructure и не обращается к S3. Production запрещён.

Обязательные переменные (секретный DATABASE_URL задаётся вне логов):

| Переменная | Local | Staging |
|---|---|---|
| `PERO_JOURNAL_BACKFILL_TARGET` | `local` | `staging` |
| `PERO_JOURNAL_BACKFILL_HOST` | `local` | `crm-staging` |
| `PERO_JOURNAL_BACKFILL_SYSTEM_ID` | `7663912963695341602` | `7680344238676262945` |
| `PERO_JOURNAL_BACKFILL_REVISION` | reviewed SHA, 40 hex | deployed reviewed SHA, 40 hex |
| `S3_BUCKET` | не используется | `pero-crm-staging` |
| URL target | loopback:5433 / pero_crm, role pero | db:5432 или guarded loopback tunnel / crm, role crm |

`PERO_JOURNAL_BACKFILL_INPUT` — JSON вида `{"mode":"check","batchSize":100,"maxBatches":100}`; после проверки заменить mode на `apply`. Предел 500 записей в одной транзакции. `afterId` позволяет продолжить известный проход; повтор с `afterId:null` безопасен и также подхватывает новые записи, оказавшиеся раньше прежнего cursor.

Каждый пакет повторно сверяет реальную identity PostgreSQL. При apply блокируются только выбранные ChangeLog строки. Меняются только presentation/searchText, CAS не позволяет затереть параллельные изменения этих колонок; raw digest проверяется в той же транзакции. Ошибка откатывает весь пакет. Любой guard mismatch означает STOP; не подменять ожидаемые значения без отдельной проверки цели.

`technical.referenceResolutionVersion=1` отмечает обработанные записи, в том числе те, для которых достоверных дополнительных связей не найдено. Полные существующие hints сохраняются. Новые версии presentation этот runner не переписывает. Результаты stdout содержат только счётчики и ID cursor, без пользовательских значений и секретов.

После первого прохода проверить remaining=0, повтор apply (updated=0), scoped search и raw integrity. Повторить проход после внедрения №225–228. Native/actual staging evidence записывает root; local tests сами по себе не являются приёмкой staging.

## Финальное обновление производных подписей

После внедрения №225–228 выполнить отдельный проход с `refreshAll:true`, например `{"mode":"apply","batchSize":100,"maxBatches":100,"refreshAll":true}`. Этот режим обходит все поддерживаемые события, включая `referenceResolutionVersion=1`, и обновляет переводы действий/источников/полей и формат отображаемых значений действующим formatter. Имена, полные business snapshots, known-flags, исходный actor и raw payload не подменяются текущим состоянием.

`afterId` — курсор явно начатого refresh-прохода; remaining в этом режиме означает ещё не просмотренные поддерживаемые строки после курсора. Режим не зацикливается на уже обработанных строках. Повтор полного refresh не пишет равные presentation/searchText. Неизвестные будущие версии presentation остаются нетронутыми.

После №228 известный ошибочный legacy формат `apiToken` с целым объектом, превращённым в единственный `[скрыто]`, восстанавливается только из исходного raw JSON с прежними actor/entity/links. Новые явные снимки API-токенов не пересобираются; секретные значения остаются скрытыми. До исправленного formatter такой repair не заявляется выполненным.
