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

Повтор `tests/ci-scheduling.test.mjs` + `tests/project-tabs-layout.test.mjs` — **6/6 PASS**, diff-check — PASS. Изменение CI опубликовано отдельным обычным follow-up коммитом после собственного review root; прежний коммит не переписывался.

## Staging

PENDING: root выполняет normal merge, штатный CI и проверяет фактические SHA/image/health и интерфейс. Локальные результаты не являются приёмкой deployment. Коммиты и push worker пока не выполнял; БД, infra и restic не затронуты.
