# Операторская процедура задачи 94

Команды выполняются только из reviewed файла с проверенным SHA256. Обязательны [SAFETY-RULES.md](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md), hostname/контейнер/volume/revision guards. Никаких inline SSH с кавычками, restic, local/staging dump или полного restore рабочей БД.

## Production

1. До push main создать `pre-migration-backup` с текущей production-ревизией и новым UUID run. Архив и receipt хранятся в `/root/pero-warehouse94-<run>/`, root 700/600. Скопировать в приватный `.playwright-mcp/warehouse94/recovery-<run>/` на Windows и выполнить `verify-archive` для `pre-migration.dump`. Успешное настоящее восстановление всех строк/схемы/FK — обязательный checkpoint.
2. После отдельного разрешения на main выпустить весь staging, проверить новую production-ревизию и добавочную миграцию. Складские изменения до завершения инициализации заблокированы.
3. Выполнить `freeze` с тем же UUID, но новой фактически развёрнутой ревизией. Он сохраняет исходные цены и технические позиции, не обнуляя ничего.
4. Выполнить `pre-zero-backup`. Свежий полный archive сохраняет FK-контекст Material, StockMovement, ProjectMaterial и новых таблиц. Скопировать archive/receipt на Windows. Выполнить `verify-archive` для `pre-zero.dump`: восстановление на изолированном PG17, пробный zero и настоящее точечное restore, сравнение защищённых данных.
5. Перенести полученный `pre-zero-proof.json` обратно в закрытый каталог run. `attach-proof` проверяет actual SHA archive, run, revision, SHA инструмента и все результаты репетиции. Перед attach/zero сравниваются архивные строки Material, StockMovement, ProjectMaterial, WarehouseBalance, WarehouseMovementValuation и исходные снимки цен/балансов. Проверка и обнуление держат одну exclusive-блокировку в одной транзакции.
6. `zero` выполняется одной транзакцией REPEATABLE READ: нули в текущем складе и Material.purchasePrice; защита всех старых строк кроме целевого поля. Фаза VERIFYING ещё не разрешает записи.
7. Проверить через приложение нули, доступность, защищённые поля и старые расходы. Только затем `activate`. Повтор zero/activate не стирает инвентаризацию.

Синтаксис: `python3 <reviewed-file> --target production --revision <40-hex> --run <UUID> --action <action>`. Windows recovery: `python deploy/warehouse94-operator.py --revision <40-hex> --run <UUID> --action verify-archive --archive <private-path/pre-zero.dump>`.

## Восстановление

До новых движений команда `restore` с теми же параметрами и verified archive/proof возвращает только исходные цены и технический баланс, не трогает updatedAt, журнал, проекты, требования или выдачи. Новые движения приводят к отказу `WAREHOUSE_NEW_MOVEMENTS_REQUIRE_SELECTIVE_RECOVERY`; их нельзя перезаписывать старой копией. Для этого случая сначала составляется отчёт и согласуется выборочная коррекция.

После восстановления фаза RESTORED показывает прежний журнал и цены, сохраняя складские движения закрытыми. Следующий запуск требует нового UUID и свежего архива. Метаданные и нормы работают до начала заморозки; в FROZEN/VERIFYING блокируются также категории, номенклатура, потребности и изменение количества изделия. Обычные правки карточек продолжают работать.

Архивы не удаляются автоматически. До приёмки владельцем остаются обе серверные копии и необходимые приватные локальные копии. После приёмки удаляются только точные файлы этой задачи с проверкой SHA и абсолютного пути; при ошибке/неясности ничего не удалять. Не переносить копии в restic.

## Local / staging

Обычная разработка — существующий PostgreSQL 5433. Native тесты используют rollback и удаляют только собственные bounded fixtures. Staging — тот же W07-guarded native transport, без дампов и production-proof. Они не заменяют обязательные настоящие production-архивы/репетицию.
