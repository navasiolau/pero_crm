# Verification

## Local working tree

Базовый staging SHA `d918ab860ec5aab029c466a3b3c3b1ce06f0ec98`, ветка `feature/180`. Проверялось рабочее дерево до коммита, а не новая развёрнутая ревизия.

- Prisma 6.19.3: `validate` и `generate` прошли.
- Полная строгая типизация web прошла: `pnpm --filter @pero/web exec tsc --noEmit --incremental false`.
- Контракт хранения: RED → GREEN; финальный прогон `tests/kp-storage-contract.test.ts` — 11/11.
- ESLint затронутых TypeScript-файлов и `openspec validate kp-document-storage --strict` прошли.
- Независимое review обнаружило три дефекта: подменяемую идентичность артефакта, несовпадающий алфавит ключей TS/SQL, NUL/одиночные суррогаты в JSON. Все исправлены; повторное review — без замечаний.

## Native PostgreSQL rollback

Существующий `pero_crm_pg`, PostgreSQL 16.14, local `127.0.0.1:5433`, БД `pero_crm`, пользователь `pero`. Docker Desktop запущен по прямому указанию владельца. Guard проверил контейнер `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`.

Финальный rollback-прогон: runId `2c81ffaa-4343-474c-a0c4-def184ae8ed4`, 71/71 сценарий. Миграция `20261018000100_kp_document_storage`, SHA-256 `1dd319ff01ca341bac362a576f7ed298e2facff08c54791156a72bf7877560fe`.

Проверены свои/чужие принятые версии, PDF, DOCX, current/version-ссылки изображений, фиксированный курс, JSON, активный порядок, аренды, dedupe, неизменяемость выпусков и идентичности связанных файлов, сохранение договора и общего изображения при удалении старой версии. После `ROLLBACK` полностью совпали 65 исходных таблиц и 785 объектов public-каталога. Baseline digest `018ad637e244ff0a919ce2971a4f2714cded567c07bce5c03671340221f0f5e8`.

Read-only preflight по именам: ожидается только новая миграция №180; неуспешных и отсутствующих в checkout миграций нет.

## Local deployment hold

Явный запуск `--apply-local`, runId `7e45f22a-8001-436b-81d0-b261a316fe0f`, остановлен до Prisma CLI: `KP_NATIVE_APPLIED_MIGRATION_CHECKSUM_HOLD`. Дополнительная read-only диагностика выявила четыре прежних несовпадения SHA-256; это не LF/CRLF и не BOM.

| Migration | Database checksum | Checkout checksum |
|---|---|---|
| `20261002130000_product_assembly_percentage` | `cddc5d9cf9f1d83d7215b55459dd4d1e7234f618a5c1d14bdeb0be32b84933d0` | `bf06ced2f16a659fbe89cf96b41145b8e3f2bf2c15d2bbaaae42626391daadf2` |
| `20261002140000_product_assembly_payroll_fields` | `79d5c4bdd6861331e6b972054abb07ea6290379c0c5e2091cada11ec29719ed4` | `8a1cd9c9a404ef2da7b4ea64e2227cec7eab4575b6de4c805900cc488b1988ef` |
| `20261004120000_simplify_product_percentage_accrual` | `a8250b813ce60d5c3f4e93e9fc60c1223ff8494b925f6c515a4500a32708aed6` | `d2f05a628dba6346e47ca4f62dde6e234d48dae758f5ff89a80655682063d32d` |
| `20261006180000_product_percentage_nonempty_rates` | `dbfbd1d09b344740c2671ff7193fe055e5e53fbcfc4f39a242fdf4cf149c9480` | `da5ce2d394834177476cb5a0dbff4286c093f4bdf904795b5820abcdd3474e4f` |

После отказа подтверждено: записей №180 в `_prisma_migrations` — 0; `CommercialProposal` отсутствует. Старые файлы миграций, история БД и бизнес-данные не исправлялись. Самостоятельный обход guard не выполнялся.

Read-only `--inspect-history`, runId `219e95dd-ee87-47c5-b2ea-3e71bb32b9de`, подтвердил 79 применённых миграций из 80 директорий; единственная ожидающая — №180. Digest точного исключения, привязанный к local-контейнеру, SQL №180 и четырём тройкам checksum: `a6f2ecdb9267b05207e2a02bd18bee4d97a225f32a6687c0329ae176da0e75c4`.

Владелец отдельно разрешил «Применить только №180», сохраняя четыре старые записи и существующие данные без исправлений. Исключение реализовано явным `--accept-history=<digest>`; любое иное расхождение отклоняется. Найденная review гонка между чтением каталога миграций и Prisma CLI устранена: исполняется отдельный снимок ровно проверенного набора файлов. Поведенческий тест изменения/добавления исходников после захвата — 1/1, повторное review исправления — без замечаний.

## Local migration applied

Guarded запуск с `--apply-local --accept-history=a6f2ecdb9267b05207e2a02bd18bee4d97a225f32a6687c0329ae176da0e75c4` выполнен: runId `4e3b279b-b1de-4860-a03c-a9983862250d`, `applied=true`, `historyComplete=true`, `permanentMigrationPreservationVerified=true`. Старая история и строки 65 прежних таблиц сохранены; 785 прежних объектов каталога не изменены. Всего стало 76 таблиц и 944 объекта public-каталога, применённых миграций — 80/80. Все 71 native-сценарий на постоянно применённой схеме прошли с полным откатом fixtures.

Execution manifest SHA-256 `aefbb0b2df6a07b93008087dd32defb18067bbb1dfcd4a5e129ea6827caefd5b`; снимок оставлен в ignored `.playwright-mcp/kp-180/migration-bundles/01b7943d-eb03-4727-93c7-4eb658a062ef`. После миграции baseline digest `aead300a6d8f82454ea96a270db758f59af323ca55635f34eedb700ed6831692`.

Отдельный readback через сгенерированный Prisma Client подтвердил: все 11 новых таблиц пустые; receipt №180 успешен и содержит SHA-256 `1dd319ff01ca341bac362a576f7ed298e2facff08c54791156a72bf7877560fe`; запрос КП с вложенными позициями, версиями/PDF, изображениями и договором компилируется и выполняется. Новые бизнес-сущности не создавались.

## Pending

Владелец явно разрешил «Коммит №180 и staging». Фактическая staging-приёмка пока не заявлена; выполняются фиксация №180 и обычный merge/push по GitFlow. SQL №180 закреплён в `.gitattributes` с LF для неизменной контрольной суммы на Windows/Linux. UI, синхронизация, рендер, API/MCP, workers, очистка и импорт относятся к следующим задачам. Production и исходные R2-данные не менялись.
