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

PENDING: обычный merge/CI и приёмка оркестратором фактически развёрнутого SHA/образа/здоровья во всех трёх журналах. Локальный browser fixture не заменяет этот этап. Commit/push, main/production, DB и инфраструктуру worker не выполнял.
