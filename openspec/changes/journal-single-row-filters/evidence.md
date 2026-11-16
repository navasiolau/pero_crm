# Проверки №230

Ветка `bugfix/230`, worktree `D:/Projects/pero_crm_worktrees/ui-journal-filters-230`, исходный SHA `8dac03047a543029921a17dddab1cc457e945113`. Зависимости установлены `pnpm install --offline --frozen-lockfile`; версии и lockfile не менялись. БД и инфраструктура не использовались.

## Local RED → GREEN

Расширена существующая browser-проверка `journal-interface.test.mjs`: реальный `Journal`, Base UI, DataTable и скомпилированный Tailwind; заменён только транспорт запросов. Проверки сравнивают фактические границы пяти полей и двух кнопок, читаемую ширину дат и отсутствие переполнения документа. Прежние сценарии Apply/Reset, late responses, полного окна и возврата фокуса сохранены.

RED на прежней компоновке: на viewport1440 с боковой областью256 px поля располагались с y54,5, а обе кнопки — с y98,5. Поиск занимал366,5 px против183,3 px у выпадающих списков. Новый геометрический assertion воспроизвёл дефект. Лог `.playwright-mcp/ui230/red-browser.log`.

GREEN после обновления общего компонента:

- `pnpm --filter @pero/web exec node --test tests/journal-interface.test.mjs tests/journal-entity-browser.test.mjs`: **2/2 PASS**, 0 ошибок страницы.
- Одна строка подтверждена на viewport1440 и1280, для боковой области256 и48 px; поиск соразмерен двум соседним спискам, даты не уже140 px.
- На viewport1024 с боковой областью256 px форма переносится; даты остаются читаемыми, переполнения страницы нет.
- На390 и360 px форма адаптивно переносится, заполненные даты полностью помещаются; переполнения документа нет.
- Сброс сохраняет project/product scope; отложенная загрузка журналов сущностей сохраняется. Серверные ACL и данные этими локальными browser fixtures не проверяются и не меняются.
- `pnpm db:generate`, полный `tsc --noEmit --incremental false`, scoped ESLint, `openspec validate journal-single-row-filters --strict`, `git diff --check`: **PASS**.

Лог GREEN `.playwright-mcp/ui230/green-browser.log`. PNG находятся в `apps/web/test-results/journal-interface/e4e85183-392b-40d2-ab95-8fe98838fd6b`. Worker визуально просмотрел `filters-1440-256.png`, `filters-1280-256.png`, `filters-mobile-360.png`, `narrow-workspace.png`.

## Staging

На первоначальном local этапе staging оставался PENDING. Реализация была зафиксирована в ветке задачи; merge/push/deploy выполняет root. Локальные результаты выше не заменяют фактическую приёмку ниже.

### Фактическая приёмка — ACCEPTED

Root принял развёрнутый staging `ad2cd677d94bf866159d5081a44840be5a661dc3` после [штатного CI43934361664](https://github.com/navasiolau/pero_crm/actions/runs/43934361664): **7/7 SUCCESS**. Web image `sha256:bbae648a85d256a152998920002c6f8bf7e1100e7df53464a31ec47537ec1c69`, renderer image `sha256:fc32f41cbd7d34599a37625661574b0605b6931780d16bd18787a92befead352`; оба healthy, HTTP health200. Существующие DB identity и W07 сохранены. Ранние ограничения CI по квоте остаются историческим контекстом, текущий run прошёл полностью.

На viewport1440 в общем журнале, журнале проекта и нижнем журнале изделия все семь элементов — поиск, пользователь, сущность, обе даты, «Применить» и «Сбросить» — имеют одинаковую координату Y. При раскрытом меню ширина контейнера1128 px, поиск194,83 px (около195 вместо прежних357), даты по140 px; кнопки остаются в той же строке. При свёрнутом меню контейнер1328 px, поиск261,5 px и кнопки также в одной строке. В общем журнале на1280 px семь элементов остаются одной строкой: поиск141,5 px, даты140 px. Root лично просмотрел актуальные screenshot проекта и свёрнутого меню.

На390 и360 px поля доступны с адаптивным переносом; ширина документа совпадает с viewport (390 и360 соответственно), горизонтального overflow нет. Однострочное расположение на телефоне не заявляется. Общий компонент фильтров и сохранение Apply/Reset/scope подтверждены локальными сценариями; runtime receipt фиксирует фактическую геометрию во всех трёх журналах.

Receipts в `D:/Projects/pero_crm_v2/.playwright-mcp/ui-229-232/`: `functional-desktop-retry/receipt.json` — PASS, errors=[] (SHA-256 `63aaf65c9b8d28d316980a0afe4640929c1c38485d5d8e0ad581bf508e9c2329`); `functional-mobile390/receipt.json` — PASS (SHA-256 `dd45969897d9f5bedea4c533c943984d2265934bb93827f6a5c288045afc8e04`); `functional-mobile360-body/receipt.json` — PASS. Дополнительное изображение установившегося мобильного меню хранится в `functional-menu390-settled`. Первый desktop-прогон сохранил React418 на странице изделия; повтор с новой сессией на неизменённом приложении прошёл без page errors. Причина первого сбоя не объявляется доказанной или исправленной.

`functional-preservation.json` подтверждает сравнение76 таблиц: единственное изменение — штатный polling `ApiToken.lastUsedAt`, фиксированные поля токенов неизменны. Сохранены5529 исходных ChangeLog с raw hash `64bcf0448dabe8e594a5ffa37da4aa1a`. Эта запись docs-only фиксирует приёмку точного staging SHA; UI-код, БД, infra и main/production не менялись. Последующая публикация итоговых документов проверяется root отдельно.
