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
