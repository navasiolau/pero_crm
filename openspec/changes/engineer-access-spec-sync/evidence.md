# Проверка задачи 127

Дата: 11.10.2026. База рабочей ветки `bugfix/127`: `3819f175dca3f69f40da92760cf746bad430f4bc`.

Изменены только OpenSpec и эта матрица. Runtime-код, UI, схема Prisma, SQL-миграции, зависимости и исходные финансовые данные не изменялись. Документное исправление соответствует прямому решению владельца и принятым `engineer-production-return`, `procurement-finance-access`, действующей производственной матрице.

## Матрица действующих контрактов

| Актор / контекст | Требуемый результат | Существующая локальная проверка | Уровень доказательства |
|---|---|---|---|
| Текущий ENGINEER, своё DESIGN/PRODUCTION, participant=false | Чтение карточки, списка, опций; фильтр не расширяет выборку | engineer-access, engineer-production-return | Unit/DI настоящих query/policy |
| Текущий ENGINEER, своё PRODUCTION | Техническая правка, удаление/загрузка и исполнение не открываются одним read-grant | engineer-access-actions, engineer-access | Unit/DI настоящих actions/handler; доступ originals/thumb отдельно |
| Текущий ENGINEER, PRODUCTION → DESIGN → PRODUCTION, без файлов/задач | Возврат разрешён, зафиксированное начисление не дублируется | engineer-production-return, single-product-percentage-core | Реальный status core с подставным transaction adapter |
| Прежний participant, без текущего назначения | Участие не даёт право возврата/PRODUCTION; самостоятельный DESIGN-grant сохраняется | engineer-production-return, product-engineering-access | Unit policy/query, без SQL-подключения |
| Чужой ENGINEER | Чужие карточки, task/file/time mutations закрыты; ответ не раскрывает данные | engineer-access, engineer-access-actions | Unit/DI настоящих read/write boundaries |
| MANAGER+ENGINEER | Управленческие grants сохраняются независимо от назначения | engineer-access, engineer-production-return | Unit/DI |
| ACCOUNTANT+ENGINEER / чистый ACCOUNTANT | Finance самостоятельный; общего операционного read от ACCOUNTANT нет | engineer-access, procurement-access | Unit query/auth/action contracts |
| PROCUREMENT без MANAGER | Операционное чтение и склад/Finance, без управленческого изменения статуса/полей | procurement-access | Unit/DI |
| ENGINEER+WORKER/MOUNTER | Объединены самостоятельные role grants; матрица этапов не обходит file/edit guards | engineer-access, field-product-status-visibility | Unit/DI |
| Смешанный проект | Оба своих DESIGN/PRODUCTION доступны, скрытые связи и денежные суммы маскируются отдельно | engineer-access | Unit relational fixture настоящего query |
| Историческое уведомление / свой расчётник | Текущее собственное PRODUCTION доступно; недоступные операционные детали редактируются только при чтении; финансовая история сохраняется | engineer-access | Unit настоящего notification/payslip reader |
| Фильтр инженеров | Набор доступных фильтров сохраняется | engineer-filter-visibility | Rendered HTML |

## Выполнено локально

Подготовлены отдельные `node_modules` через `pnpm install --offline --frozen-lockfile --ignore-scripts`: 724 пакета из cache, 0 скачиваний, lockfile без изменений. `pnpm --filter @pero/web exec prisma generate` создал только ignored Prisma Client, без подключения к БД.

```text
pnpm --filter @pero/web exec tsx --test --test-concurrency=1 tests/engineer-access.test.ts tests/engineer-access-actions.test.ts tests/engineer-production-return.test.ts tests/engineer-filter-visibility.test.ts tests/single-product-percentage-core.test.ts tests/procurement-access.test.ts tests/product-engineering-access.test.ts tests/field-product-status-visibility.test.ts
56 tests, 56 pass, 0 fail, 0 skipped

openspec validate engineer-access-spec-sync --strict
PASS

openspec validate engineer-product-access --type spec --strict
PASS

git diff --check
PASS
```

Проверки использовали реальные функции приложения с изолированными adapters; БД, сеть и storage в regression suites не использовались. Новый тест буквального текста OpenSpec не добавлялся. Проверка `git diff --name-only -- apps packages .github pnpm-lock.yaml` не показывает изменений runtime/SQL/dependencies.

## Независимое ревью и staging

- Независимое ревью реализации: **PASS**; оркестратор передал CODE_REVIEW_GO127, замечаний, блокирующих синхронизацию принятой политики, нет.
- Принятый staging SHA/образ/здоровье после интеграции: **NOT_RUN**.
- Реальный браузер: список, карточка, поиск, прямая ссылка, запрет чужого изделия: **NOT_RUN**.
- Реальный PostgreSQL: возврат и повтор без изменения frozen completion / PayrollEntry: **NOT_RUN**. Unit/DI не заменяет эту проверку.
- Глобальный канбан: обнаруженный assignment/participation дефект остаётся отдельной задачей 128 и не закрыт синхронизацией спецификации.
- iMac 2017 недоступен по ответу владельца: задача 141 **BLOCKED_DEVICE_UNAVAILABLE**, причина и исправление инцидента не подтверждены.

Устаревший `engineer-production-return-native.mjs` содержит ожидание calculationVersion2 и 150 BYN для quantity3×unit1000×5%. Действующий v4 использует единичную цену с новым округлением; старое условие нельзя обходить или выдавать за текущую приёмку. Для следующей кодовой задачи требуется reviewed native сценарий актуального контракта и сверка неизменности сохранённого денежного снимка.
