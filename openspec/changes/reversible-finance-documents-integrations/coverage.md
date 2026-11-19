# Карта операций №262

Проверены штатные HTTP-методы и экспорты Next Server Actions, общие транзакционные ядра и ветки задач №238–261. JSON-fixture фиксирует пары «модуль / экспорт». В таблице команды сгруппированы по корню журнала.

| Операция / вход | Корень журнала | Обработчик или причина отказа |
| --- | --- | --- |
| Web / Telegram upload финансового документа | `finance-document:<id>`, переход в READY | `financeDocumentUploadReversal` №262. Действующий платёж блокирует отмену. Скрытый платёж сохраняет оба FK и порядок. Перед реактивацией PostgreSQL проверяет исходный комплект. |
| Web настройки модуля | Смена enabled / settings | `pluginMutationReversal` №262. Публичные поля текущего demo-манифеста и ревизия сохраняются. Для несовместимого манифеста и секретов откат недоступен. |
| Web / service API команда модуля | `demo.ping` и запись вызова | Доступен только технический ping. Записи аудита и отправленное событие сохраняются. Scope `write` и проверка плагина обязательны. |
| Прочитать уведомление / все уведомления, включая веб-сеанс Telegram | `notification.read` по владельцу | `notificationReadReversal` №262 повторно проверяет точный набор и ревизии. Личные напоминания остаются в приватной области №255. Исходящие и доставленные сообщения являются фактами. |
| Login/logout, Telegram link/request/unlink, user settings, API token issue/revoke, UI-предпочтения | User / TelegramLink / ApiToken / UserPreference / NotificationPreference | №255. Отозванные секреты, версии сессии, одноразовые коды и токены назад не выдаются. Регистрация бота, выпуск сеанса и подтверждение доставки служебные. |
| Создание / мягкое удаление проекта или изделия, web и bot create | Проект / изделие и связанный набор | `cardVisibilityReversal` №253, проверяет поздние зависимости и номер. |
| Web / Telegram правки проекта, изделия, контакта и спецификации | Корень соответствующей карточки | `projectFieldReversals`, `productFieldReversals`, `productSpecificationReversal` №257. API смены клиента КП вызывает то же ядро контакта. |
| Web/Bot переход этапа проекта, статус изделия, процентное поле/дефолт, повтор начисления | Корень перехода / настройки / расчёта | `projectStageReversal`, `productStatusReversal`, `productPercentageSettingsReversal`, `productPercentageDefaultsReversal`, `payrollAccrualReversal` №261/251. Старые методы фонда, передачи процентных долей, таймеров отключены. |
| Web / Telegram платежи, перенос проекта, выплата, аванс, сводная выдача, начисление | Payment / Payout / корень начисления | `paymentVisibilityReversal`, `ordinaryExpenseProjectReversal`, `payoutVisibilityReversal`, `payrollAccrualReversal` №241/245/251. Старая валюта зарплаты вне BYN противоречит действующему денежному инварианту. |
| Задачи и работы, граф зависимостей, изменение исполнителя / долей, самоназначение | Task / Work / TaskAllocationGroup | №250. Обычные операции `workTaskLifecycleReversal`, `taskEditReversal`, `workEditReversal`. Пробелы независимых распределений и переназначения переданы владельцу №250. Старый split endpoint читает квитанцию существующей операции. |
| Каталоги клиентов/контрагентов, расценки, кассы, статьи, касса по умолчанию | Организация / строка справочника | `officeDirectoryReversal` №258. Блокирует поздние зависимости и конфликты справочника. |
| Каталоги склада и нормы материалов | Material / MaterialCategory / MaterialUnit / ProjectMaterial | `warehouseCatalogReversal` №256. |
| Приход, закупка, выдача, возврат, удаление, чек и выдача по чеку | Складская операция с проводками и снимками | `warehouseMovementReversal` №259, `expenseReceiptReversal`, `expenseReceiptIssueReversal` №242/247. REST quote только рассчитывает. |
| Рейс, состав, ТТН, проведение, корректировка, перераспределение | Рейс и его дерево / Posting | `logisticsTripLifecycleReversal`, `logisticsDocumentVisibilityReversal` №260, `logisticsReallocationReversal` №246. |
| Обычные файлы, замена эскиза/обложки и удаление | Корень загрузки/привязки/снятия | `retainedFileReversal` и сценарии №240. Оригиналы хранятся. |
| Web / scoped КП API, документ, медиа, PDF, черновик договора, DOCX, публикация | КП / заявка выпуска / артефакт / договор | №254: `proposalEditReversal`, `proposalCreationReversal`, `proposalMediaUploadReversal`, `proposalExportRequestReversal`, `issuedProposalPdfReversal`, `issuedContractDocxReversal`, `createdContractDraftReversal`, `savedContractDraftReversal`, `contractPublicationReversal`. Реквизиты подписи переданы владельцу №254. |
| Приватный план, настройки личного напоминания и отметки личного уведомления | Приватные данные | Политика №255 исключает их из общего журнала. |
| Очередь, cron, техподтверждения, телеметрия и архивный оператор | Служебные факты / квитанции | Пользовательского действия нет. Модель Communication доступна в схеме, текущий штатный writer не найден. |

Кнопка отката только у действующего администратора/директора в CRM. Новые HTTP writers и экспортируемые Server Actions требуют добавления в инвентарь после проверки корня. Проверка AST ловит прямые и вложенные удаления Prisma и SQL в runtime web. Привилегии №252 ограничивают runtime, включая выполнение через другое имя или raw SQL.
