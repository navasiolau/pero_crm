# AGENTS.md — правила для агентов

## ЧЕКПОИНТ (сжатый контекст)

Готово: Ф1 каркас · Ф1.5 плагинное ядро · Ф2 проекты/клиенты · полировка (DataTable, SearchableSelect, FileViewer, Omnisearch, stageStyles, TaskDialog, UsersAdmin) · Ф3 (прайсы, работы со снимком цены, зависимости DAG, оценка времени из истории (задаётся и при создании), серверный таймер + «Стоп» + ручной ввод, PayrollEntry сдельно при «Выполнена») · доработка №3–5: валюта BYN отображается как «BYN» (НЕ «руб.» — явное требование владельца); загрузка фото — видимый диалог с дроп-зоной `photo-upload-button.tsx` (не системный диалог — в средах автоматизации он не рисуется; зона = label на input + drag-drop + Ctrl+V); работа ДЕЛИТСЯ между задачами по количеству (`Task.quantity`, сумма ≤ количества работы, степпер QuantityStepper «−/+/Все», начисление = priceSnapshot × quantity × executorShare, в карточке задачи сумма = цена × её количество); удаление задачи/работы/файла — единое окно `confirm-delete-dialog.tsx`; ОБЯЗАТЕЛЬНОЕ фактическое время при «Выполнена» (нет записей → `actual-time-dialog.tsx` с минутами — ТОЛЬКО офисные роли; estimateMinutes обязательна при создании — без неё и истории сервер откажет) · анти-обман времени (требование владельца): ТАЙМЕР АВТОМАТИЧЕСКИЙ — переход «В работе» сам запускает серверный таймер исполнителя (прежний активный глушится), «Выполнена» сам его останавливает и пишет факт; работнику/монтажнику ручной ввод времени ЗАКРЫТ (addManualTime отказывает, кнопки «+ мин» нет, «Выполнено» без записей → ошибка «возьмите в работу»; правки факта — менеджер через actual-time-dialog, §19); «Мои задачи» — статусы видны бейджами (Новая/В работе/Выполнена/Просрочена), вид список/канбан с dnd-перетаскиванием по статусам (те же server actions, оптимистично с откатом), выбор в UserPreference `my.view` · Ф4 зарплата (§10): 4 схемы оплаты — сдельная (из Ф3), `% от стоимости` инженеру при ПЕРВОМ переходе проекта «В работе» (Project.engineerId, запись одна на проект), `% от оборота`, `без расчёта` (директор — /payroll ему закрыт); МОДЕЛЬ МЕСЯЦЕВ (правила владельца): НАЧИСЛЯТЬ (закрытие месяца, accrueTurnover) МОЖНО ТОЛЬКО ЗА ПРОШЛЫЙ МЕСЯЦ — в текущем месяце везде показывается ПРИБЛИЗИТЕЛЬНАЯ зарплата (≈суммы), сервер отклоняет текущий/будущий месяц; автоматические записи по факту работ (сдельно при «Выполнена», % инженеру) — не закрытие, остаются и образуют приблизительную зарплату; ДОЛГ К ВЫПЛАТЕ = начислено за месяцы ДО ТЕКУЩЕГО − ВСЕ выплаты (getEmployeeDues) — выплата возможна только в пределах этого долга и баланса организации (getOrgBalance = приходы − выплаты), т.е. за работу текущего месяца деньги получить нельзя до закрытия; карточки без двусмысленности: «К выплате сейчас» (долг за прошлые месяцы) / «Приблизительная зарплата» (текущий месяц) / «Начислено за <месяц>» / «Выплачено за <месяц>» (по записям ниже); ОБОРОТ = СУММА ПРИХОДОВ (Payment) по проектам за месяц в валюте ЗП (конвертации других валют нет до Ф5); начисление % оборота СРАВНИВАЕТСЯ с текущим оборотом: вырос — доначисление разницы отдельной записью, снизился — предупреждение «больше расчётного»; приходы вносятся во вкладке «Финансы» карточки проекта (админ/директор, Payment: сумма/дата/комментарий, удаление через ConfirmDeleteDialog); валюта ЗП единая — OrgSetting `payrollCurrency` (настройка в /settings/payroll, дефолт BYN, начисления хранят валюту на момент создания); `/payroll` «Моя зарплата» — расчётник real-time (?month=ГГГГ-ММ); `/finance/payroll` — сводка по сотрудникам (колонка «Долг к выплате»), выплаты (Payout), экспорт CSV (route handler export?month=, BOM+«;» для Excel); в диалоге выплаты — «К выплате / баланс», кнопка «Вся сумма» (min долга и баланса), сервер валидирует те же потолки; «Рассчитать всех» — массовые выплаты по долгу с превью, комментарий «Выплата зарплаты от <дд.мм.гггг>», при нехватке баланса — частично/пропуск по порядку списка; уведомления payroll.accrued/payroll.payout (personal), payment.added (org), ChangeLog на выплаты/начисления/приходы; проверено e2e до копейки (5% инженеру = 500, сдельно = 450, июль — только оценка ≈7 605 без кнопки, июнь: оборот 10 000 → начислено 300 → «Рассчитать всех» платит ровно его, июльским начислениям выплата отклонена; работник: «В работу» → таймер сам, «Выполнено» → факт, без времени — отказ, канбан с драгом).
Сервер: `pnpm start` (порт 3000), postgres docker 5433, seed: 6 ролей `pero-demo-2026` + демо-проекты (П-2026-001 с инженером + его начисление и выплата).
Дальше: Ф5 финансы (кассы, платежи, курсы НБ РБ, маржа; оборот ЗП перейти на оплаты) → Ф6 склад → Ф7 миграция (ждёт экспорт legacy).
Ф7 (миграция, ПОСЛЕ основных фаз): экспорт legacy ЗАВЕРШЁН. Источник (ТОЛЬКО READ-ONLY, ничего не менять): `postgresql://pero:pero_legacy_dev@127.0.0.1:5432/pero_legacy_clean`. Структура legacy отличается от v2 — маппинг строго по ID-связям с логом, «удалённые» не импортируем, «архив» с флагом (§17 плана).

## Проект

PERO CRM v2 — CRM для производства корпусной мебели на заказ (русскоязычный UI).
Полный план: `PERO CRM v2 — План реализации базовой CRM.md` в корне (роли — §4, модель — §8, интерфейс — §15, архитектура — §16, фазы — §18).

## Жёсткие правила

- **НЕ трогать `legacy_export/`** — там работает другой агент (отдельный docker-проект `pero_legacy_pg`).
- Наш PostgreSQL — на порту **5433** (5432 может быть занят legacy).
- Менеджер пакетов — **pnpm 11** (workspaces), единый lockfile в корне. npm/yarn не использовать.
- Весь пользовательский UI-текст — **по-русски**. Код и комментарии к неочевидным решениям — по-русски/по существу.
- **TypeScript strict**, без `any` без необходимости.
- **Коммиты не делать** без явного указания владельца.

## Команды (из корня)

- `pnpm install` — установка зависимостей
- `docker compose up -d postgres` — БД
- `pnpm db:migrate` / `pnpm db:seed` — миграции / демо-данные
- `pnpm dev` — dev-сервер; `pnpm build` — prod-сборка (webpack, нужен Serwist)
- `pnpm lint` — ESLint

## Структура

- `apps/web` (`@pero/web`) — приложение Next.js 15 (App Router, `src/`, алиас `@/*`)
  - `src/auth.ts` + `src/auth.config.ts` — Auth.js v5 (credentials + JWT); `src/middleware.ts` — защита роутов и ролевые ограничения (`/finance`, `/changelog`, `/settings` — только ADMIN/DIRECTOR)
  - `src/app/(app)/` — защищённые разделы с app shell; `src/app/login/` — вход
  - `src/lib/nav.ts` — навигация: видимость пунктов по ролям + группы сайдбара (`main`/`manage`)
  - `src/components/` — оболочка на официальных блоках shadcn (`dashboard-01`, `login-03`, стиль base-nova): `app-shell.tsx` (SidebarProvider), `app-sidebar.tsx`, `nav-main.tsx`, `site-header.tsx`, `nav-user.tsx`, `theme-toggle.tsx` (бинарный light/dark), `logo.tsx` (фирменное перо v1, currentColor, без подложки), виджеты дашборда `section-cards.tsx`, `chart-area-interactive.tsx` (recharts), `recent-projects.tsx`, `login-form.tsx`, `stub-page.tsx` (empty-state заглушек)
  - `src/components/ui/` — примитивы shadcn (sidebar, card, table, chart, field и т.д.), ставить через `pnpm dlx shadcn@latest add <name>` из `apps/web`
  - `src/server/plugins/` — плагинное ядро (§14): `registry.ts` (статический реестр манифестов — ручная установка), `sync.ts` (upsert Plugin при старте, вызов из `src/instrumentation.ts`), `slots.ts` + `src/components/plugins/plugin-slot.tsx` (UI-слоты через next/dynamic, ErrorBoundary на вклад), `events.ts` (шина DomainEvent — outbox, синхронная доставка + `dispatchPendingEvents` для cron), `context.ts` (PluginContext: db, logger, audit, emit, requirePermission), `changelog.ts` (журнал изменений §5), `tokens.ts` (Bearer-токены API), `actions.ts` (server actions: toggle/settings/command/token)
  - `src/app/api/v1/` — публичный REST API (Bearer pero_…, scope read/write/admin): `/`, `/plugins`, `/plugins/:id/commands/:cmd` (POST), `/events`, `/events/dispatch` (POST), `/openapi.json`. **Исключён из middleware-матчера** — при добавлении роутов не забывать проверять scope.
  - `src/app/(app)/settings/` — настройки (ADMIN/DIRECTOR): `modules/` (список + `[id]` детальная: автоформа настроек, команды, журнал запусков), `api/` (токены + документация), `payroll/` (валюта зарплаты §10)
  - `src/app/(app)/changelog/` — журнал изменений с фильтрами (ADMIN/DIRECTOR)
  - `src/app/(app)/projects/` — проекты (фаза 2): канбан (`kanban-board.tsx`, dnd-kit, оптимистично с откатом) / таблица, вид в UserPreference; `[id]/` — карточка со вкладками (Общее, Работы и задачи, Файлы, Коммуникации, Финансы*, История + project.tab-слоты); `stage-form-dialog.tsx` — мини-формы Отказа/Рекламации при dnd (§6); у проекта есть `engineerId` (выбор в форме создания и на вкладке «Общее») — на него % от стоимости при «В работе» (§10); `finance-tab.tsx` — приходы проекта (Payment, админ/директор)
  - `src/app/(app)/clients/` — клиенты; `my/` — «Мои задачи»: список/канбан (dnd по статусам, вид в `my.view`), бейджи статусов, авто-таймер; `notifications/` — лента + настройка типов (§6.1)
  - `src/app/(app)/payroll/` — «Моя зарплата» (расчётник §10, всем кроме DIRECTOR); `src/app/(app)/finance/` — лендинг + `payroll/` (сводка, выплаты, % оборота, `export/route.ts` — CSV с BOM и «;» для Excel); переключатель месяца — `src/components/month-switcher.tsx` (?month=ГГГГ-ММ)
  - `src/server/` — доменные действия: `projects/`, `clients/`, `tasks/`, `files/`, `communications/`, `notifications/` (notify.ts — фан-аут по §6.1), `payroll/` (queries.ts — расчётник/сводка/оборот/валюта ЗП; actions.ts — выплаты, начисление % оборота, валюта), `payments/` (приходы по проектам — основа оборота), `preferences.ts` (UserPreference §7), `require-role.ts`, `plugins/` (ядро §14)
  - `src/app/api/files/` — загрузка (upload, sharp-превью) и отдача ([id], проверка прав); хранилище `apps/web/uploads/<projectId>/` (§13, gitignored)
  - `src/lib/stages.ts` — этапы воронки §6 + «дней на этапе» + `stageStyles` (цветовая дифференциация: служебные состояния — Рекламация amber, Пауза slate, Отказ red — вне нормального воркфлоу, выделяются всегда); `src/lib/format.ts` — суммы; `src/lib/uploads.ts` — корень хранилища
  - `src/components/ui/searchable-select.tsx` — комбобокс с поиском (поле фильтра над списком) — ОБЯЗАТЕЛЕН для длинных списков (клиенты, сотрудники); у селектов должны быть дефолты
  - `src/components/ui/data-table.tsx` — универсальная таблица: поиск, сортировка по клику на заголовок, пагинация (10/20/50/100 + стрелки). Применять для ВСЕХ табличных списков сущностей
  - `src/components/omnisearch.tsx` — глобальный поиск (Ctrl+K, палитра как в IDE) по `/api/search`: проекты, задачи, клиенты с учётом видимости §4
  - `src/components/file-viewer.tsx` — просмотрщик вложений: изображения/видео — лайтбокс, PDF — новая вкладка, прочие форматы (b3d и т.п.) — только скачивание; хук `useFileViewer()`
  - `src/components/task-dialog.tsx` — карточка задачи (max-w-2xl, подписанные поля: тип, срок, исполнитель, создатель, создана; файлы кликабельны через FileViewer; просмотр/правка для ADMIN/DIRECTOR/MANAGER; выполненная — только просмотр); задачи кликабельны везде; без исполнителя = «Черновик» со значком, тип и срок обязательны
  - `src/app/(app)/settings/users/` — управление сотрудниками (ФИО, должность, телефон, telegram — действия и журнал привязываются к ЧЕЛОВЕКУ, не к роли)
  - Клиент: `name` = Имя (или «ООО Альфа» для юрлица), `lastName`, `middleName`; поля «Компания» НЕТ; отображение через `displayClientName` из `src/lib/labels.ts` («Фамилия Имя Отчество»); окно просмотра по клику на строку — обязательно для всех сущностей
  - «use server»-файлы экспортируют ТОЛЬКО async-функции — подписи/константы выносить в `src/lib/labels.ts` и подобные
  - `prisma/` — схема (User, Plugin-ядро, Client, Project(+engineerId), ProjectStageHistory, Task, File, Communication, Notification(+Preference), UserPreference, ChangeLog, PayrollEntry, Payout, Payment, OrgSetting), миграции, seed (6 ролей + демо-проекты + демо-начисление/выплата инженеру + демо-приходы)
- `packages/plugin-sdk` (`@pero/plugin-sdk`) — SDK плагинов: манифест `definePlugin`, слоты (`dashboard.widget`, `project.tab`, `project.action`, `task.action`, `settings.page`), PluginContext, CURRENT_API_VERSION (совместимость N и N-1)
- `packages/plugins/<id>` — плагины; сейчас `demo` (виджет, вкладка в проекте, команда «Пинг», хуки). Новый плагин: пакет с `plugin.ts` → workspace-зависимость в apps/web → `transpilePackages` → реестр `src/server/plugins/registry.ts`

## Конвенции

- UI: shadcn/ui (стиль `base-nova`, Base UI) + Tailwind v4, тема dark/light через `next-themes`, mobile-first. Шрифт — Onest (next/font, subsets latin+cyrillic, переменная `--font-onest` на `<html>`; Inter НЕ использовать).
- Версии пакетов pinned (Next 15.5.20, Prisma 6.19.3 — НЕ 7.x, next-auth 5.0.0-beta.31, @serwist/next 9.5.11); не обновлять без необходимости.
- Секреты — только в `.env` (gitignored); примеры — в `.env.example`.
- Деньги — `Decimal`; сущности из legacy несут `legacyId` + `legacyTable` (§8).
