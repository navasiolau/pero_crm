# Проверки №223

## Исходное состояние

Ветка `feature/223`, базовый staging `a391e5f1df7f307905513df7e1d46a10bee09a01`. №221/222 разрабатываются в отдельных worktree, их файлы не копируются. Изменения БД, инфраструктуры, production и restic отсутствуют.

## RED

До реализации `pnpm --filter @pero/web exec node --test tests/journal-interface.test.mjs` завершился exit 1: новый Journal ещё отсутствует (`Could not resolve @/components/journal/journal`). Тест подготовлен для настоящих React/DataTable/Dialog/SearchableSelect в Chromium, с заменой только серверного transport на управляемые ответы.

## UI GREEN

После разрешённого root fast-forward merge настоящего `origin/staging` `26f1d12ab131e673930475f30203e35797a062ce` (модель №221) выполнен `pnpm --filter @pero/web exec node --test tests/journal-interface.test.mjs`: PASS 1/1, 4,604 s. Используются реальные Journal/DataTable/Base UI/словарь №221; заменён только серверный transport. Никаких cross-worktree aliases или копирования файлов.

Подтверждены пять колонок без источника, lazy details, один detail request на row/button, Enter/Space, возврат фокуса, полные длинные тексты и вложенные массивы с русскими названиями, неизвестное прежнее значение, escaping HTML, безопасная ошибка/retry, отсутствие поздней подмены события/списка, передача фильтров и пагинации серверу, размеры 95vw/90dvh и полный мобильный экран без переполнения.

Снимки `apps/web/test-results/journal-interface/940fd877-3cf3-45b3-8300-abf74c3107ee/{desktop-event,mobile-event}.png` просмотрены визуально. Заголовок/закрытие доступны, полный текст переносится и прокручивается. Это локальная синтетическая UI-проверка, не staging-приёмка.

Целевой ESLint: exit 0, 0 warnings. Strict OpenSpec: PASS. `git diff --check`: PASS.

`journal-page-access.test.mjs`: PASS 1/1 (0,160 s), исполняется настоящая ChangelogPage и requireRole/roles, заменены только сессия и клиентское содержимое. Неавторизованный запрос направляется на вход; DIRECTOR, остальные роли и сочетания отвергаются до рендера Journal. ADMIN получает только initialQuery, без raw audit payload. Новый тест остаётся backend cohort и не требует Chromium.

## Интеграция зависимостей и финальные local проверки

По команде root выполнен штатный fast-forward до `096b258df3ece6d7f86d5003357cbe8f2b169b05` с №222 и приёмкой №221. Собственный Prisma Client сгенерирован без подключения к БД; чужие node_modules не использовались.

- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: exit0.
- `pnpm --filter @pero/web exec tsx --test tests/journal-*.test.ts tests/journal-page-access.test.mjs`: PASS 46/46, 0 skipped, 1,859 s. Включает existing global page denial и настоящие ADMIN-first actions №222.
- `pnpm --filter @pero/web exec node --test tests/journal-interface.test.mjs`: PASS 1/1, 5,972 s. Screenshots: `apps/web/test-results/journal-interface/fe643bc5-e148-4bff-bbd7-dad347228ce1/`.
- Scoped ESLint для всех изменённых TSX/test файлов: exit0, 0 warnings. OpenSpec strict и diff-check: PASS.

## Оставшаяся приёмка

Публикация №223 разрешена root только после actual staging-приёмки №222. Реальная staging-приёмка №223 остаётся задачей root и не подменяется local fixtures; checklist 3.2 не отмечен выполненным.

## Повторная проверка с исправленным №222

По явному Git GO root выполнен обычный merge `origin/staging` `6addc0c8de142da3fae92589ab91af951d01ba7c` в `feature/223`, сохранён исходный UI commit `01fae437`. Итоговый merge commit `c7f82ccc688981758e80953fc178c1f5fbe0d953`; история не переписывалась.

- Полный web `tsc --noEmit --incremental false`: exit0.
- Целевые journal TypeScript tests и page-access: PASS 49/49, 0 skipped, 2,179 s.
- `journal-interface.test.mjs`: PASS 1/1, 5,465 s. Screenshots: `apps/web/test-results/journal-interface/41fa69a6-f1d0-4d5d-80ce-e287921a8601/`.
- Scoped ESLint: exit0, 0 warnings; strict OpenSpec и diff-check: PASS.

READY для root-review и штатной публикации после его окончательного runtime №222 GO. Actual staging №223 ещё не объявляется принятым.

## Исправление узкого desktop перед окончательной приёмкой

При 1024×768 и боковой панели 256 px пятиколоночная сетка с `lg` сжимала оба поля даты до 88 px: год не помещался. Браузерная регрессия с требованием ширины даты ≥140 px сначала дала RED (`88,88`). По разрешению root breakpoint пяти колонок изменён на `xl`; ниже используется имеющаяся сетка из двух колонок.

После исправления `journal-interface.test.mjs` PASS 1/1, 4,844 s, включая узкий рабочий экран, полные даты и отсутствие горизонтального переполнения. Screenshot `apps/web/test-results/journal-interface/d3a85ce1-8cee-44f8-ad46-381d1e7af4ec/narrow-workspace.png` просмотрен: даты и фильтры читаются полностью. Целевой ESLint — exit0, 0 warnings; diff-check — PASS. Изменены только четыре responsive class и целевой браузерный сценарий; commit и публикацию выполняет root.
# Реальная приёмка root

Принято на staging `a632e1e36326c61f157d3de5d506e533fe0b3ff2`. [CI](https://github.com/navasiolau/pero_crm/actions/runs/43781019174): все7 jobs SUCCESS; web/renderer имеют эту revision, health200, DB/volume/W07 и proxy сохранены. Web image `sha256:bcf5891485f44032b71a63aa6f4322cf456255304fcf398f82551883b51eef4b`.

Root проверил реальные страницы в Chromium: пять колонок без источника, единственное окно по строке, полный сохранённый текст, источник в подробностях, кнопка перехода к сравнению, Enter/Escape и возврат фокуса. Размеры desktop95vw/90vh и mobile390×844, отсутствие горизонтального переполнения окна; даты на1024px с настоящим sidebar имеют ширину≥140px. Desktop/mobile PNG просмотрены root.

Существующие ADMIN/DIRECTOR/MANAGER/ENGINEER/ACCOUNTANT/PROCUREMENT/WORKER/MOUNTER подтверждены через фактический `/api/auth/session`. ADMIN получил данные list/detail/options, в том числе через другой существующий route `/notifications`. Остальные7 ролей не получили данных при21 прямом вызове: forwarding Next.js возвращал пустой `{}` HTTP200, это не обозначается как403. Общий route перенаправляет запрещённые роли. Необработанных JS ошибок0, непредусмотренных мутаций0.

Приватный receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/browser223-accepted/receipt.json`. Это проверка подписанных read-only сессий существующих пользователей; парольный вход/выход и отдельный HTTP-coordinator относятся к №228. Первая и вторая попытки harness уточнили транспортный ожидаемый результат (Flight/empty forwarding), не скрывают ошибки приложения.

