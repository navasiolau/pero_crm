# Проверки задачи №172

Дата: 17.10.2026. Ветка `bugfix/172`, базовая ревизия `2dc8e1046ef493836f967544d918a0681b1a751d`. Проверки выполнены в отдельном worktree `D:/Projects/pero_crm_worktrees/requests-172`; коммиты, merge, push и deployment этим исполнителем не выполнялись.

## Локальные результаты

- RED: новый поведенческий suite до изменения кода дал 3 успешных / 9 упавших тестов. Он подтвердил исходный доступ PROCUREMENT к маршруту, карточке, странице, salary actions/core/service, удалению и зарплатным уведомлениям.
- GREEN до исправления замечания о наследовании настроек ниже: полный `pnpm --filter @pero/web test` — **897/897**, без пропусков. Включал 13 новых поведенческих тестов и существующие проверки валют, начислений, повторов, необязательных post-commit эффектов и собственного расчётника.
- Предшествующий целевой регрессионный прогон — **75/75**; после добавления положительного сценария зарплатных actions выполнен полный suite выше.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — успешно, включая изменённые native-тесты.
- ESLint всех 18 изменённых исходников/тестовых файлов — успешно; новый тест повторно проверен после последнего дополнения.
- `openspec validate procurement-payroll-access --strict` и `git diff --check` — успешно.
- Установка зависимостей: `pnpm install --offline --frozen-lockfile --ignore-scripts`; Prisma Client сгенерирован `pnpm db:generate`. Версии и lockfile не изменены.

## Исправление замечания независимого ревью

При разделении смешанного типа новый `payroll.orgAdvance` не наследовал ранее выключенную настройку `payroll.orgPayout`. Исправлено без миграции: явное новое значение имеет приоритет, затем используется сохранённое прежнее значение, затем дефолт «включено». Отправка и страница настроек используют один resolver; настройки скрытого смешанного типа читаются для наследования у PROCUREMENT, сам тип в UI не возвращается.

- RED: два новых поведенческих теста воспроизвели повторное включение отправки и неверное отображение настройки (13 успешных / 2 упавших).
- GREEN после исправления: целевой прогон **80/80**, включая все **15** тестов `procurement-payroll-access`, регрессии авансов/зарплаты/прав и календарных настроек уведомлений.
- Проверены наследование false и true, оба направления явного override, дефолт при отсутствии обеих настроек и неизменность сохранённых строк.
- Повторные `tsc --noEmit --incremental false`, ESLint пяти затронутых этим исправлением модулей/тестов, OpenSpec strict и `git diff --check` — успешно.
- Native-ожидания адресатов также учитывают наследование старой настройки; native здесь не запускался. Полный 897-тестовый прогон выше предшествовал этому исправлению; после него выполнен указанный целевой прогон 80 тестов.

## Что доказано поведенчески

- PROCUREMENT и PROCUREMENT + MANAGER не получают зарплатную карточку, страницу, CSV или SALARY/actions/начисления/массовый расчёт. Отказ наступает до финансового чтения, включая квитанции и курсы.
- ADMIN, DIRECTOR, ACCOUNTANT и PROCUREMENT + ACCOUNTANT сохраняют зарплатные права; проверены действительные auth/require-role и прямые вызовы, без подмены проверяемого допуска.
- При удалении до допуска читается только `kind`; ADVANCE сохраняет доступ, SALARY не читает подробности и не удаляется снабженцем. Запись и аудит сохраняются в прежней общей транзакции.
- Предварительный расчёт, выдача/добавление аванса и собственная зарплата PROCUREMENT доступны; собственный расчётник выбирает ID из сессии.
- Старые смешанные `payroll.orgPayout` и `payroll.orgAccrued` скрываются у снабженца при чтении, сохранённые строки не изменяются. Новые авансы используют `payroll.orgAdvance`, ADVANCE_ROLES и ссылку `/finance/advances`; ACCOUNTANT в комбинации сохраняет оба потока.

## Native и фактическая staging-приёмка

17.10.2026: повторное независимое ревью подтвердило исправление P2 наследования уведомлений и отсутствие новых замечаний. Владелец разрешил сохранение отдельных веток и staging-тестирование; main и production-БД не изменялись.

Оркестратор отревьюил и выполнил `.playwright-mcp/native-172.ts` через guarded local runner на существующей `localhost:5433/pero_crm/public`: **PASS**. Внутри actual DB identity guard, outer Serializable, advisory lock `(18435,55001)` и обязательный rollback marker. Использован существующий active user для recipient/createdBy без создания или изменения профилей; собственные cash/income/debt/payout/audit/event записи полностью отменены откатом транзакции.

- PROCUREMENT и PROCUREMENT + MANAGER: SALARY отклонён до первого SQL/delegate обращения.
- PROCUREMENT: ADVANCE 4 BYN разрешён; точный повтор от PROCUREMENT и PROCUREMENT + MANAGER возвращает прежнюю выплату без новых payout/audit/event строк.
- PROCUREMENT + ACCOUNTANT: SALARY 2 BYN разрешён. ADMIN, DIRECTOR и ACCOUNTANT: SALARY по 2 BYN разрешена.
- Ещё 7 наборов других ролей отклонены до SQL для SALARY и ADVANCE.
- Пять distinct payouts дают ровно 12 BYN расхода из единственного собственного прихода 1000 BYN; дополнительных Payment на выдачи нет. Исходные BYN-снимки прочитаны без подмены неизвестных значений.
- После rollback собственных cash/income/debt/payout/audit/event строк нет; существующий пользователь не изменён. Оркестратор подтвердил **точное совпадение fingerprints всех 65 таблиц** с baseline после интеграции девяти задач.

Receipts: [local-native172.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-native172.json), [local-after172-native.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-after172-native.json).

На реально развёрнутом staging подтверждены ревизия `e742e2e18014191ac03551ff2730f112749b38bb` и web image `sha256:a884efc14c37ce948b022c9ac3952b0895c3ef7f12280ea096dd9e1f4e94232e`; outer guard подтвердил `crm-staging`, прежний DB container и `crm-staging_pgdata`. Проверены **четыре существующих профиля**: PROCUREMENT, ACCOUNTANT, ADMIN, DIRECTOR. Receipt: [staging172/receipt.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/staging172/run-9981b985-cd56-4a21-890d-37dcba262ca0/receipt.json).

- PROCUREMENT: зарплатной карточки в финансах нет, прямой маршрут и CSV закрыты; собственный расчётник и авансы доступны.
- ADMIN/DIRECTOR/ACCOUNTANT: зарплатная карточка, прямой маршрут и CSV доступны.
- Оркестратор просмотрел фактические finance PNG, в том числе отсутствие зарплатной карточки у PROCUREMENT.
- Существующий combined профиль PROCUREMENT + ACCOUNTANT на staging отсутствует. Объединение прав доказано локальным native/core и unit-тестами; **actual combined browser-приёмка не заявляется**.

Staging-прогон ограничен authenticated SSR/GET страницами и CSV с отключённым JavaScript: денежных мутаций, загрузки документов и сохранения payroll не было. Изменяющие SALARY/ADVANCE и idempotency проверены реальным ядром на PostgreSQL только в локальной rollback-транзакции выше. Это границы доказательств, а не заявление о денежных операциях в staging.

CI [38993731208](https://github.com/navasiolau/pero_crm/actions/runs/38993731208) на этой staging-ревизии: **все 6 jobs SUCCESS** (native, backend, components-0/1, web/bot publish); receipt [ci-e742.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/ci-e742.json). CI/build дополнены фактическими image/DB/browser receipts выше, не используются вместо deployment-приёмки. Пункт 2.2 закрыт с указанными границами.
