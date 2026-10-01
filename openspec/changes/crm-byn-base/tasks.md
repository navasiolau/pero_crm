# Tasks

## 1. Согласование и база

- [x] 1.1 Зафиксировать явное разрешение владельца 02.10.2026 «все...без согласований...tested staging» на OpenSpec/реализацию/коммит/merge/staging и создание feature/16 от свежего origin/staging f036823; main/production исключены, чужие изменения сохранены.
- [x] 1.2 Зафиксировать RED контрактных тестов: create/update/payroll setting с не-BYN, веб/API/бот и старый callback; проверить реальные отказы tests до реализации.
- [x] 1.3 Зафиксировать RED денежных тестов: bynAmount против projectAmount, foreign payroll, legacy Payout без currency, PriceItem/Work без доказанной единицы, frozen/allocations и двойной учёт; проверить падение на текущем поведении без обращения к production.

## 2. Серверные writers

- [x] 2.1 Ввести общую BYN policy в projects/core и payroll setting; проверить GREEN создания без валюты, отказа явной не-BYN, сохранности существующих frozen guards и ролей.
- [x] 2.2 Применить policy к products/actions.ts, works/actions.ts, tasks/completion-core.ts, tasks/share-core.ts, product-stage-pay/core.ts и product-percentage-pay/core.ts без изменения их формул; проверить новые BYN-записи и локальный отказ неоднозначной старой валютной базы, сохранность незавершённых allocation snapshots.
- [x] 2.3 Применить BYN payroll side к начислениям/выплатам/авансам/массовому расчёту и payments/core.ts, payroll/cash-core.ts (включая service/actions); проверить Decimal, копейки, лимиты, отсутствие дублей и сохранение USD/RUB/EUR кассовых сумм/курса/даты.
- [x] 2.4 Проверить все действующие /api/v1 и Telegram денежные входы вызывают те же правила; подтвердить tests запрета без успешных audit/денежных побочных записей при старом payload и прежние Bearer/scopes.

## 3. История и достоверные проекции

- [x] 3.1 Перевести оплату/расходы BYN-проекта и оборот/баланс на фиксированные BYN-эквиваленты Decimal; проверить 100 USD × 3 = 300 BYN при старом projectAmount=100 и неизменность после смены текущего курса.
- [x] 3.2 Ввести типизированную недоступность только затронутых payroll/economics/dues/balance итогов без достоверного эквивалента; проверить legacy Payout без currency не угадывается по нынешней orgSetting, unknown не становится нулём, выплата/settleAll блокируется при зависимости от unknown.
- [x] 3.3 Обновить связанные DTO/CSV/dashboard/ботовые проекции и исторические строки; проверить сохранение исходных валют/snapshots, отсутствие двойного учёта settlement payroll и доступность прочих карточек при неизвестном итоге.

- [x] 3.4 Проверить retry frozen PENDING_FX как продолжение исторического снимка: RED→GREEN сохранности исходных валют/базы/получателей, корректного bynAmount и отсутствия дублей при повторных/параллельных запросах; новая BYN policy не переопределяет старую попытку.

## 4. Интерфейсы и локальная приёмка

- [x] 4.1 Убрать проектный currency select/state/payload из создания/overview и Telegram currency step/npc; зарплатная настройка read-only BYN. Проверить браузер/бот и stale callbacks; физический cur/cash selector сохраняет реальные валюты.
- [x] 4.2 Обновить денежные подписи, ошибки и недоступные итоги без расширения прав; проверить MANAGER+ENGINEER, ENGINEER+ACCOUNTANT, чистые ENGINEER/WORKER/MOUNTER, прямые запросы и собственную историю расчётника.
- [x] 4.3 Запустить целевые RED→GREEN tests, lint/typecheck/build по существующим scripts; сохранить результаты и diff без initialPrice, миграции цен, новых зависимостей, env/данных и чужих файлов.
- [x] 4.4 Пройти разрешённые локальные runtime-сценарии на существующем окружении и лично проверить 320×800, 360×800, 390×844, 768×1024, 1024×768, 1440×900, sidebar/200% zoom; зафиксировать отсутствие выхода страницы и понятные ошибки, отдельно отметить недоступные проверки. Новые QA-данные — только по отдельному точному разрешению, без seed/reset/дампов/restic.

## 5. Gate и staging

- [x] 5.1 Выполнить safe staging read-only preflight под W07 identity: payrollCurrency BYN, сохранённые payroll/payout BYN-эквиваленты, состав 174 BYN/8 RUB/2 USD проектов и 221 PriceItem/6449 Work без конвертации. Локальные native/DI сценарии подтверждают отказ новых денежных writes non-BYN и сохранность history/guards; фактический staging runtime этих сценариев ещё принимается в 5.3. Production manual gate остаётся будущим.
- [ ] 5.2 Только после явного разрешения коммита включить код и этот OpenSpec в один атомарный коммит, обычным merge интегрировать feature/16 в staging; проверить историю merge и CI без cherry-pick/squash.
- [ ] 5.3 Принять фактически развёрнутые staging SHA/образ/здоровье, все денежные/ролевые/stale-form/ботовые сценарии и визуальные экраны; сохранить evidence точной ревизии, учитывая ночной refresh/W07 без изменения их работы.

## Evidence

Локальные результаты и их границы: [evidence.md](evidence.md). 5.2/5.3 остаются незавершёнными до фактических commit/merge/CI и staging-приёмки.

## Future Scope

Main/production-выпуск не входит в текущую staging-задачу и не является её обязательным checkbox. После отдельного прямого указания владельца понадобится ручная подготовка production-данных и принятого SHA, ff-only всего принятого staging в main, сверка удалённых refs и реального deployment. Сохранение исторических non-BYN проектов при staging-приёмке не подтверждает выполнение этого будущего gate.
