# Design

## Context

SearchableSelect монтирует Input с React autoFocus в портале Popover. Обычный Select использует Base UI Root (modal=true) и alignItemWithTrigger=true. Изолированный Chromium sandbox на original React/Base UI 1.6.0 и compiled CSS измерил 12 случаев с window-scroll и nested-scroll.

## Goals / Non-Goals

**Goals:** устранить доказанный ранний focus-scroll через общий SearchableSelect, сохранив поиск, возврат фокуса и обычный Select.
**Non-Goals:** изменение Base UI/dependencies, глобальные scrollTo/overflow hacks, отключение доступного фокуса, изменения данных/CAS/ролей.

## Decisions

- Baseline SearchableSelect: window 1450→0; nested window 80→0 при неизменном scrollTop=1450. Focus trace: React autoFocus на Input с viewport y=-1443,15 до позиционирования, preventScroll=false. Контроль с preventScroll сохранил обе координаты.
- Обычный Select во всех вариантах modal/align и обоих scroll-контекстах сохранил координаты. Не менять его defaults без причинного подтверждения.
- Убрать React autoFocus с Input. Передать ref поля поиска в штатный Popover initialFocus: Base UI планирует фокус через следующий animation frame после layout/позиционирования и сохраняет свой returnFocus/Escape.
- GREEN проверен без диагностического preventScroll override: 4 scroll-контекста, 12 повторных keyboard/search/selection циклов, реальные focus/query/value/Escape/returnFocus и координаты сохранены. Прямой callback фокуса и scrollTo не потребовались.

## Risks / Trade-offs

- [Поиск остаётся без фокуса] → браузер проверяет activeElement, реальный ввод, фильтрацию и выбор.
- [Повторное открытие сохраняет query] → Escape/click selection и reset query повторяются.
- [Особенности приложения вне sandbox] → общая CRM/staging проверка root после интеграции №33–38; sandbox не объявляется CRM acceptance.

## Migration Plan

Без миграций и DB. Авторизован только sandbox 127.0.0.1:3028 с оригинальными контролами и CSS; контексты и собственный сервер обязательно закрываются. Дальше root integration/build/actual acceptance.

## Verification

Baseline и GREEN receipts находятся в ignored `.playwright-mcp/corrections/dropdown-sandbox`. Регрессионный sandbox запускается `node apps/web/tests/dropdown-scroll-stability-sandbox.mjs green`; он жёстко ограничен correction-38/127.0.0.1:3028, не импортирует auth/API/Prisma, а после проверки закрывает собственный browser/server. TypeScript PASS, ESLint 0 errors/0 warnings. Actual CRM/staging acceptance остаётся отдельно у root.
