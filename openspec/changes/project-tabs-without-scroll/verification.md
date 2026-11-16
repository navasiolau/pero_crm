# Проверки №229

Ветка `bugfix/229`, отдельный worktree `D:/Projects/pero_crm_worktrees/ui-tabs-229`, исходная ревизия `8dac03047a543029921a17dddab1cc457e945113` от свежего `origin/staging`. Root одобрил проектную адаптивную панель до изменений кода.

## Local

- RED: новый браузерный сценарий с прежним layout воспроизвёл `Panel must not overflow at 360px, plugin=false`.
- GREEN: `pnpm --filter @pero/web exec tsx --test tests/project-tabs-layout.test.mjs tests/journal-entity-pages.test.mjs tests/journal-entity-browser.test.mjs` — **3/3 PASS**. Проверяются настоящие `ProjectTabs`, проектный список и общий Tabs с настоящим Tailwind; синтетические подписи не требуют данных или сервера CRM.
- Профильный сценарий проверяет ширины **360/390/1024/1440**, обычные восемь вкладок и длинное неразрывное название модуля; `scrollWidth <= clientWidth`, отсутствие scroll overflow и выхода кнопок за границы, отсутствие горизонтальной прокрутки документа, одну строку обычных вкладок на1440 и управление End/Enter. Журнал остаётся последним.
- После добавления fallback переменной шрифта для изолированной browser fixture профильный сценарий повторно **1/1 PASS**. В fixture используется Arial вместо отсутствующей `next/font` переменной; действующий шрифт приложения окончательно проверяет root на staging.
- SSR и прежний browser сценарий подтвердили прежнюю ролевую видимость и ленивую загрузку журнала. Действия и права не менялись.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS после штатного `pnpm db:generate`. Первый запуск до генерации клиента завершился отсутствующими Prisma exports; это подготовка собственного worktree, подключения к БД не было.
- Scoped ESLint, `openspec validate project-tabs-without-scroll --strict` и `git diff --check` — PASS.

Лично просмотрены PNG в `apps/web/test-results/project-tabs-229`: `tabs-360.png`, `tabs-390-plugin.png`, `tabs-1024.png`, `tabs-1440.png`. На1440 обычные кнопки в одной строке; на узком экране кнопки переносятся без скрытия и полосы. Вкладка с длинным словом переносит текст полностью. Клавиатурный фокус остаётся видимым.

## Scope

Production diff — только композиция списка в странице проекта и проектная обёртка в `project-tabs.tsx`. `overflow-visible!` нужен для локального переопределения существующего unlayered мобильного `overflow-x:auto`; общий `ui/tabs.tsx` и `globals.css` не меняются. Поисковые фильтры, колокольчик и sidebar принадлежат соседним задачам.

После root review новый `project-tabs-layout.test.mjs` явно включён в существующую CI-группу `components-1`, где устанавливается Chromium. Без этой строки новый файл попадал бы в backend по умолчанию; исполнение браузерного сценария не пропускается. Изменена только принадлежность одного файла, порядок jobs, guards и критерии публикации сохранены.

Повтор `tests/ci-scheduling.test.mjs` + `tests/project-tabs-layout.test.mjs` — **6/6 PASS**, diff-check — PASS. Изменение CI зафиксировано отдельным обычным follow-up коммитом по поручению root; прежний коммит не переписывался. Push и публикация остаются у root.

## Staging

На первоначальном local этапе staging оставался PENDING. Код и CI follow-up были зафиксированы в ветке задачи по поручению root; merge/push/deploy выполняет оркестратор. Исторические результаты выше не подменяют фактическую приёмку ниже.

### Фактическая приёмка — ACCEPTED

Root принял развёрнутый staging `ad2cd677d94bf866159d5081a44840be5a661dc3` после [штатного CI43934361664](https://github.com/navasiolau/pero_crm/actions/runs/43934361664): **7/7 SUCCESS**. Web image `sha256:bbae648a85d256a152998920002c6f8bf7e1100e7df53464a31ec47537ec1c69`, renderer image `sha256:fc32f41cbd7d34599a37625661574b0605b6931780d16bd18787a92befead352`; оба healthy, HTTP health200. Существующие DB identity и W07 сохранены. Ранние ограничения CI по квоте остаются историческим контекстом; они не являются текущим блокером и не заменяют результат этого run.

На реальной странице проекта обычные восемь вкладок доступны; «Журнал» последний. Панель имеет clientWidth=1128 и scrollWidth=1128, overflowX=`visible`: горизонтальной прокрутки и её стрелок нет. Root лично просмотрел актуальный screenshot проекта. На390 px панель имеет width=358 и contentWidth=358; на360 px также подтверждены перенос без overflow и отсутствие горизонтальной прокрутки документа. Проверка длинной вкладки модуля остаётся локальной browser-проверкой, реальный модуль с таким синтетическим названием на staging не создавался.

Receipts в `D:/Projects/pero_crm_v2/.playwright-mcp/ui-229-232/`: `functional-desktop-retry/receipt.json` — PASS, errors=[] (SHA-256 `63aaf65c9b8d28d316980a0afe4640929c1c38485d5d8e0ad581bf508e9c2329`); `functional-mobile390/receipt.json` — PASS (SHA-256 `dd45969897d9f5bedea4c533c943984d2265934bb93827f6a5c288045afc8e04`); `functional-mobile360-body/receipt.json` — PASS. Первый desktop-прогон сохранил React418 на странице изделия; повтор с новой сессией на неизменённом приложении прошёл без page errors. Причина первого сбоя этой записью не объявляется доказанной или исправленной.

`functional-preservation.json` подтверждает сравнение76 таблиц: изменялся только штатный polling `ApiToken.lastUsedAt`, фиксированные поля токенов неизменны. Сохранены5529 исходных ChangeLog с raw hash `64bcf0448dabe8e594a5ffa37da4aa1a`. Приёмка относится к точному staging SHA; main/production, БД и инфраструктура worker не менялись. Последующая docs-only публикация требует финальной проверки root и не подменяет этот runtime receipt.
