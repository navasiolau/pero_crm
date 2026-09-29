# Backend evidence, 29.09.2026

Область: только модель, подготовленная SQL-миграция, чистая арифметика дерева и server composition core/query/actions в отдельном worktree. SQL не применялся ни к одной БД; Docker, SSH, Next runtime, браузер, commit и push не запускались. UI задач 3.x остаётся за root.

## RED → GREEN

- Pure tree suite сначала завершился `MODULE_NOT_FOUND`, так как implementation отсутствовала. Поздний точечный RED обнаружил, что две самостоятельные строки разных ревизий ошибочно принимались как одно дерево (`Missing expected exception`); после проверки `REVISION_MISMATCH` suite стал GREEN 7/7.
- Core DI suite сначала завершился `MODULE_NOT_FOUND`; после реализации 7/7. Сценарии проверяют клон с новым row ID и прежним lineage ID, один подтверждённый номер, повтор UUID, optimistic version, явное удаление дочерних строк перед ревизией, rollback при сбое ChangeLog и сериализованные конкурентные подтверждения.
- Статический SQL-тест дал RED: ветка `CHECK` для CONFIRMED принимала `revisionNo=NULL` по PostgreSQL UNKNOWN. Добавлено явное `IS NOT NULL`, затем GREEN 2/2. Trigger строки блокирует INSERT/UPDATE/DELETE после подтверждения и смену MODULE на PART/HARDWARE с детьми; native PostgreSQL это ещё не доказывает.

## Проверено локально без БД

- `pnpm --dir apps/web exec prisma validate --schema prisma/schema.prisma` и `prisma generate` с фиктивным DSN `127.0.0.1:1`: pass; генерация затронула только собственный `node_modules` worktree.
- `pnpm --dir apps/web exec tsx --test tests/product-composition-*.test.ts`: 19/19 pass (pure tree, DI core, ACL query, static SQL и безопасный русский каталог ошибок).
- `pnpm --dir apps/web exec tsc --noEmit --pretty false`, targeted ESLint и `openspec validate product-composition --strict`: pass.
- ACL regression tests были добавлены **после** реализации query/core и стали GREEN; prior RED для них не наблюдался. Это отклонение от предпочтительного порядка TDD, а не доказательство RED. Задача 1.3 в `tasks.md` описывает проверенное поведение без такого исторического утверждения.
- После первого review исправлен SQL `CHECK`: `revisionNo IS NOT NULL` для CONFIRMED; item trigger отклоняет превращение MODULE с детьми в другой тип. Server action отделяет post-commit revalidate от результата записи: ошибка инвалидации кэша не сообщает ложный отказ после commit. Коды ошибок имеют отдельные русские сообщения.
- Клонирование и удаление черновых строк выполняются пачками по глубине (до 16 уровней), сохраняя порядок родитель→дети при создании и дети→родитель при удалении.

Native FK/trigger/rollback, фактическая многопользовательская гонка и browser/mobile/staging остаются pending и не должны считаться выполненными.
