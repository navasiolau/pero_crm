# Матрица покрытия №225

Проверены действующие общие cores и их web/API/Telegram callers. Отсутствие локального вызова в transport не считалось пропуском, если событие сохраняет вызываемый core. Raw-квитанции и их идентичность сохранены; `presentation` не участвует в проверке доступа или replay.

| Операция / общий путь | Исходное покрытие | Изменение №225 | Проверка |
|---|---|---|---|
| Клиент: создание, редактирование (`clients/core`) | Создание сохраняло часть реквизитов; правки сохраняли изменённые поля | Полный снимок создания, имя клиента; обновление остаётся с точным CAS-baseline | client-passport, КП snapshots |
| Телефон/адрес клиента из проекта (`projects/contact-core`) | Client audit без связи с проектом | Прямая project связь от вызывающего пути; без привязки к остальным проектам клиента | project-inline-actions, native |
| Проект: создание (`projects/core`) | Только номер и название | Полный бизнес-снимок, ссылки на клиента/менеджера; создание из КП — System | journal-business, kp-proposal-core |
| Проект: inline/legacy поля (`project-field-core`) | Частичные receipts; контактный путь дублировал бизнес-событие | Снимки услуг целиком, значения ссылок, точный project контекст; только доказанный дубликат — receipt | kp-project-money, project-inline-actions |
| Смена этапа (`stage-core`) | Сохранялся этап, не причины отказа | Снимок дополнительных полей; системный исполнитель отдельно от raw actor для выпуска договора | project-stage-core |
| Удаление проекта (`delete-core`) | Только общий receipt проекта | Снимок проекта и отдельный System event каждого реально скрытого изделия | native225, domain-postgres |
| Создание изделия (`products/core`) | Пропущены часть полей и исполнитель автоматизации | Полные свойства и ставки; собственный product контекст; создание из КП — System | journal-business, kp-proposal-core |
| Изменение изделия / технических характеристик (`products/core`) | Inline receipts смешивали ответ и сравнение | Полные реальные before/after, инженерские ссылки, технические дубли отдельно | product-inline-domain, technical-specifications-domain |
| Автоматический пересчёт при количестве (`products/quantity-core`) | Work/ProjectMaterial изменялись без собственного audit | System + инициатор, точные quantity/norm/total до/после только реально изменённых строк; product-only контекст и номер из caller snapshot, включая окончательный номер при перестановке КП | journal-business quantity regression, native225 quantity/norm/fault cases |
| Ручной статус изделия (`products/status-core`) | Старый/новый статус | Product контекст, номер, комментарий; исполнитель остаётся пользователем | stage/core tests, native |
| Автопродвижение DRAFT → PREPARATION (`draft-core`) | Статус от имени пользователя | System + инициатор + причина, исключительно product контекст | journal-business, native225 |
| Последовательная нумерация (`numbering`) | Событие приписано пользователю | System + инициатор, стабильный ID, прежний/новый номер | product-sequential-numbering |
| Удаление изделия (`products/delete-core`) | Receipt с номером/названием | Полный снимок до удаления; формат receipt не изменён | domain-postgres, native |
| Обложки проекта/изделия (`cover-core`) | Файлы и обложки уже журналировались, receipts дублировали UI | Контексты, имена файлов и полные метаданные; exact receipts скрыты | project-cover-core, product-cover-backend, sketch-cleanup |
| Создание/сохранение КП (`proposal-core`) | Только revision и item IDs | Полный state, клиент, валюта/курс; raw baseline и result сохранены | journal-business, kp-proposal-core, native225 |
| Синхронизация клиента КП (`proposal-client`, `client-binding`) | Client / proposal audit без полной связи и System | Отдельный инициатор, подтверждённый project контекст и полный изменённый снимок | kp-proposal-core, contact tests |
| Синхронизация изделий (`proposal-item-sync`) | Частично полные значения, user вместо System | System + инициатор, product контекст; неизменившийся duplicate скрыт | kp-proposal-core |
| Цены из КП (`pricing-persistence`) | Изделия только внутри общего project payload | Собственное событие каждой реально изменившейся цены; проектная лента не включает product diff | journal-business no-op, native225 |
| Изображения КП → изделия (`media-product-sync`) | User, без точного контекста, неполный before | System; метаданные файла, before/after обложки, отдельное очищение снятой обложки | kp-private-media / native helpers |
| Загрузка изображения КП (`media-repository`) | Хэши без имени файла/контекста | Полное имя/тип/размер, user snapshot, project контекст | private-media tests/native |
| Запрос и выпуск PDF (`lifecycle-store`) | Job/version без событий выпуска | Самостоятельные запрос user и успешный выпуск System; результат replay не дублируется | lifecycle tests, native helpers |
| Принятая версия КП при смене этапа (`stage-gate`/`lifecycle-store`) | Менялась без отдельного события | Before/after acceptedVersion/acceptedAt/epoch; System с инициатором | lifecycle/stage tests |
| Восстановление версии КП | Save плюс restore receipt | Save имеет полный снимок и System причину; restore сохраняет исходную user-квитанцию | lifecycle / proposal tests |
| Договор: сохранение (`contract-workflow`/`contract-store`) | Только fingerprint/result | Полный снимок видимых условий отдельно от receipt; все подтверждённые project связи | journal-business, contract-workflow, native225 |
| Договор: запрос и успешный выпуск | Запрос имел receipt, успех — только DomainEvent | Запрос с полным снимком; отдельное System событие успешного выпуска, без повтора | contract-workflow |
| Подпись/условия КП (`signature-settings`) | Receipt | Before/after значений; no-op остаётся технической квитанцией | signature tests |
| API wrappers (`api-operation`, `api-documents`) | Дополнительные transport receipts | Exact технические записи остаются в БД и не дублируют бизнес-события | API tests |
| Физическая очистка по существующей retention policy | Имеется audit и file delete intent | Writer №221, безопасные метаданные и снимок принадлежности до удаления | retention tests; сами задания не запускались |
| Операторская коррекция нумерации №211 | Guarded system receipt | Читаемые before/after без изменения repair/replay guards | numbering repair tests; операторский запуск не выполнялся |
| Offline archive import/recovery/normalize | Собственные raw SQL audit/receipts; не достижимы из обычных app routes | По согласованию root протоколы, hashes и counts не меняются; исходные события читаются legacy adapter №222 | Наличие writes/callers проверено; import/recovery не запускались |

Личный план, просмотры и состояние интерфейса не входят в журнал по решению владельца. Новых денежных расчётов, изменений ролей или транспортных разрешений нет. Старые отсутствующие значения не восстанавливаются из текущего состояния. Отсутствующий legacy-признак автоматизации не заменяется предположением.

## Фактическая staging-проверка

На `e3f99ff05b97f3999fc8fbf74472e9077d769a3b` root получил PASS сценария `journal-225`; [receipt и идентичность runtime](evidence.md#staging-приёмка-dbcore--16112026) зафиксированы в evidence.

- Полные сравнения КП/договора, System/инициатор, точный product context, сохранность raw receipts и отсутствие повторных событий.
- Автоматический пересчёт работ/материалов при изменении количества: точные значения и суммы, неизменные физические факты, окончательный номер после перестановки КП и rollback при отказе аудита.
- Каскадное скрытие изделий и общий audit-fault rollback.

Эти пункты подтверждены на фактической staging БД с `SET CONSTRAINTS ALL IMMEDIATE` и последующим rollback. Остальные строки матрицы сохраняют свой указанный вид проверки; retention, operator repair и offline import/recovery не объявляются выполненными. QA import alias имел ноль вызовов и не проверяет Next cache invalidation. Общая браузерная и auth-приёмка ведётся root отдельно.
