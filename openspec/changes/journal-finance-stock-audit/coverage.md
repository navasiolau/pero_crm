# Матрица покрытия №227

Проверяются живые пути выполнения, а не совпадение имени файла с `changeLog`. UI и Telegram/API входят в общие cores. `presentation` добавляет полные снимки; raw квитанции не используются как пользовательский diff и не меняются.

| Операции / вход | Общая запись | Полные данные и контекст | Проверка |
|---|---|---|---|
| Приход/расход из web и `/api/v1/bot/payments` | `payments/transaction.ts` → create + техническая request | Дата, комментарий, сумма/валюта/курс, касса, статья, полный комплект документов; прямой project или global | native probe + payment/paid-stock tests |
| Удаление платежа web | `payments/delete-core.ts` | Полный снимок до удаления; исходный project; source автора | cash/finance regression, native root |
| Составной расход оплаченного прихода/рейса | тот же payment core | Система с инициатором и причиной; исходный raw actor остаётся | paid-stock и logistics tests |
| Создание/отключение/включение кассы | `finance/actions.ts`, `default-cash-core.ts` | Название, валюта, комментарий/активность; аудит в одной tx | RED касса остаётся после audit failure → GREEN |
| Назначение кассы по умолчанию | `default-cash-core.ts` | Прежнее/новое имя кассы, ревизия; автоматическое снятие — Система | existing CAS/rollback cases |
| Создание/активность статьи | `finance/article-core.ts` | Код, название, комментарий/активность; global | native article + existing directory tests |
| Создание/правка/активность расценки | `prices/actions.ts` | Название, единица, цена, категория, активность; tx; точный no-op без ложного события | action rollback/full-field test |
| Аванс/зарплата, в том числе пакетная выдача | `payroll/cash-core.ts` | Получатель, период, комментарий, физическая/расчётная суммы, валюты, курсы/даты, касса; global | payout replay / cash tests |
| Удаление выплаты | `payroll/actions.ts` | Полный снимок выдачи до удаления | existing payroll/cash tests |
| Процент от оборота / доначисление | `payroll/turnover-core.ts` | Система/инициатор, получатель, период, ставка, база, ранее начисленное, дельта, комментарий | existing turnover atomic tests |
| Валюта зарплаты | `payroll/actions.ts` | Прежняя/новая валюта; обязательный аудит перенесён внутрь tx | existing currency guards + audit rollback |
| Стандартные процентные ставки | `product-percentage-defaults/core.ts` | Ставки и ревизия вместо fingerprint/result; global | RED/GREEN receipt equality/replay |
| Ставка/исполнитель процентной оплаты | `product-percentage-pay/patch-core.ts` | kind и фактическое поле с именами исполнителей; product-only | single percentage patch tests |
| Первое/позднее завершение процентного этапа | `direct-completion.ts` | Система/инициатор, состояние, причина, цена, количество, ставка, получатель, сумма; product-only | existing completion tests |
| Попытка SKIPPED_ONCE → LEGACY_PROTECTED при защищённом инженерном фонде | `direct-completion.ts` через `captureProductPercentageCompletion` | Текущий PostgreSQL immutable trigger запрещает переход, включая случай неизменной причины. Успешного изменения нет; отсутствие события не является пропуском аудита. Бизнес-правило и trigger не меняются | own native fixture: обе причины, точный P0001/immutable, rollback/no audit/no data change |
| Корректировка уже начисленного процента | `direct-completion.ts` | Система/инициатор, прежняя/новая ставка и сумма, получатель, дельта; product-only | rate-adjust tests |
| Закрытие исторического PENDING_FX | `product-percentage-pay/core.ts` | Новый audit фактического успешного начисления с курсами, долями и инициатором; повтор не пишет | bounded injected-rate test |
| Категория/номенклатура склада | `warehouse/actions.ts`, `material-core.ts` | Имя, артикул, единица, категория, минимальный остаток, комментарий и активность; атомарно | RED/GREEN material snapshot, native material |
| Единицы измерения | `warehouse/unit-core.ts` | Название до/после и удалённая метка; ADMIN policy сохраняется | warehouse-units tests |
| Создание/увеличение/правка/удаление потребности | `warehouse/actions.ts` + `norm-core.ts` | Количество партии/на единицу, комментарий, выданное; product-only; увеличение существующей строки — Изменение | quantity and norm tests |
| Инвентарный приход, выдача, возврат web/Telegram | `warehouse/accounting.ts` | Материал, количество, цены/стоимость, основание возврата, комментарий, остаток/стоимость до/после, факт выдачи; product-only для изделия | warehouse-average + native root |
| Оплаченный приход web/Telegram | `stock-purchase-core.ts` → движение + платёж | Дополнительно исходная цена/валюта покупки, сумма, касса, курс/дата, документы; общий receipt без отдельного дубликата | paid-stock-contract tests |
| Каскадная отмена складских движений/оплаты | `warehouse/deletion-core.ts` | Снимок каждого движения/платежа, собственные contexts; зависимые отмены — Система; корень отражает остаток и связанные последствия | warehouse deletion native root |
| Создание/изменение рейса | `logistics/core.ts` | Полный manifest: дата, комментарий, ТТН, доли и состав; точные проекты и изделия | native manifest and logistics tests |
| Оплата/исправление рейса | `logistics/posting-core.ts` | Прежняя/новая стоимость, курсы, касса, документы, доли и manifest; проекты и изделия до/после | logistics-cash-allocation tests |
| Мягкое удаление рейса | `logistics/delete-core.ts` | Полный состав, общие поля, документы и действующее распределение до удаления | logistics delete native root |
| Загрузка ТТН / второй печати | `logistics/documents.ts` | Один audit только после READY; полный файл/стадия/номер/контекст рейса; retry без дубля | existing upload fault/retry tests |
| Загрузка финансового документа web/Telegram | `finance-documents/core.ts` | Один audit после READY; имя, MIME, размер, hash, загрузивший; пока не привязан — global | finance-document upload tests |

Не создают дополнительные business events: чтение/preview/quote, технические payment request receipts, StockPurchase receipt, retry уже подтверждённой команды, доставка outbox. Устаревшие configure/transfer/no-model функции процентного модуля отклоняют изменения и не записывают выдуманные события. Личный календарь и состояние интерфейса вне задачи.

Native helper `tests/helpers/journal-227-native.ts` получает проверенный caller-owned tx, создаёт только собственный QA cohort, возвращает проверенные результаты и откатывает свой SAVEPOINT. Он не подключается к БД, не трогает settings/gate, не вызывает storage/dispatch/уведомления. Полная runtime-приёмка — root после обычного CI.

Проверка точных action codes writers №227: 19 кодов, все имеют русский label. `softDelete` отображается «Удаление», `correct` — «Изменение»; labels проверяются в существующих native сценариях реального удаления склада и исправления рейса. Неиспользуемый `percentage.legacyProtection` удалён после уточнения SQL guard.
