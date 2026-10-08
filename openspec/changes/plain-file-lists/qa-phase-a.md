# Phase A Local QA — 08.10.2026

Feature/115 от staging 8f48aafc39e7db98be03421df20bc2b5466ae978. Выполнена независимая Phase A: только новые helpers/tests/OpenSpec. Existing adapters и задача 113 не копировались и не изменялись. Полное подключение списков ожидает принятого staging113 и указания основного агента.

- RED: contract tests до реализации не находили общий компонент FileList. GREEN: `pnpm --filter @pero/web exec tsx --test tests/plain-file-list.test.ts` — PASS 4/4; actual rows показывают исходные имена/урну, без метаданных/миниатюр, защищённые ordinary/finance download routes и disabled permissions.
- `pnpm --filter @pero/web exec node tests/plain-file-list-browser.mjs` — PASS 15 групп на 1440×900, 390×844 и 360×800. Реальные React, Base UI, Tailwind и FileViewer; synthetic protected HTTP transport без обращений к БД. Проверены PDF/video/CAD downloads с точными исходными именами, source finance/project, fullscreen image originals contain, мышь/Enter без активации родительской строки, disabled own-file/linked restrictions, anchored confirmation/focus cancel, отмена без запроса, двойной submit с одной отправкой, pending Escape/outside не закрывают popover, success callback обновляет список, отказ/исключение сохраняют строку.
- `pnpm db:generate` и `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS. Prisma generation только создала private ignored client; подключений к БД не было.
- `pnpm --filter @pero/web exec eslint src/components/file-list.tsx src/components/file-delete-popover.tsx tests/plain-file-list.test.ts tests/plain-file-list-browser.mjs` — PASS.
- `openspec validate plain-file-lists --strict` — PASS.
- Визуально проверены mobile list/confirmation и desktop confirmation: длинное полное имя переносится, расширение видно, урна справа, popover небольшой и помещается в viewport.

Ignored evidence: `.playwright-mcp/files115/receipt.json`, `list-{1440,390,360}.png`, `confirm-{1440,390,360}.png`.

Коммиты/push/merge/deploy, migrations и data mutations не выполнялись. Печать задачи 116 не добавлялась. Phase B, полный suite/build/adapters review/native и staging acceptance остаются pending; этот receipt не является приёмкой всей задачи 115.