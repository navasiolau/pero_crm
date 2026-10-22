# Проверки №193

Ветка feature/193, база3def4f0c76e4a1756aa4dabfbb3871b2112dd927. БД/инфраструктура не читались и не изменялись.

- Существующие server/list/percentage suites:40 уникальных cases PASS. Первый прогон39/40: добавленный historical receipt fixture считал fingerprint до Zod; fixture исправлен на исходный server contract, повтор только project-stage-core8/8 PASS. В том числе новый retired target отвергается, exact старый receipt читается, перенос через DI сохраняет скрытые строки/историю/денежный fixture, отменяет prune при LEAD, replay не пишет повторно.
- Затронутая existing product-quantity-input suite19/19 PASS: управленческие target-ожидания обновлены, новый RECLAMATION запрещён, сохранение начисления при DESIGN↔PRODUCTION осталось прежним. Вместе с project-stage-core последний прогон27/27 PASS; общей новой матрицы нет.
- Telegram: existing engine10/10 PASS, `pnpm --filter @pero/telegram-bot run build` PASS; старая callback-кнопка retired этапа не вызывает stage API.
- Существующий Chromium component case `partial stages…` PASS после обновления прежнего ожидания8→6: retired строки отсутствуют, действующий мультивыбор/сброс/scroll сохраняются. Новые browser сценарии не добавлялись.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false` PASS. Ранний запуск до Prisma generate завершился отсутствием generated client; клиент сгенерирован без подключения к БД. Два ранних auto-install столкнулись EBUSY; один последовательный frozen install завершился успешно, lockfile не менялся.
- Scoped ESLint изменённых runtime/test файлов PASS. `openspec validate retire-paused-and-reclamation-stages --strict` PASS; `git diff --check` PASS.
- Прямой запуск scripts/retire-stages.ts подтвердил INERT, без подключения к БД.

Исторические enum, причины, immutable денежные снимки и KP frozen parser не менялись. Прежние integration fixtures, которые создавали новые RECLAMATION переходы, используют действующие DESIGN/IN_WORK для прежней проверки rollback/repeat. DB integration здесь не запускался. Прежние component fixture generators переведены на действующие этапы без новой тестовой матрицы.

Native/runtime/staging plan/apply: NOT_RUN, отдельное действие Root после проверки нового SHA/образа и отсутствия старых writers. DI не заменяет PostgreSQL/данные/runtime.

После Root review удалён blanket запрет других DB clients: idle pools нового web/бота допустимы. Отсутствие старых writers остаётся обязательным live callback Root, target binding и транзакционные блокировки/CAS сохранены. Убран соответствующий устаревший fixture assertion; по поручению Root59+10+1 cases не повторяются, выполнены только TypeScript и diff-check.
