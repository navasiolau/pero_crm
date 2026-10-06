# Evidence

## Локальная проверка текущей ревизии (feature/82, без коммитов)

- База: worktree `C:\Users\admin\.codex\worktrees\crm-82-percent-visibility\pero_crm_v2`, ветка `feature/82` от `origin/staging`. Работа только внутри каталога. SAFETY-RULES прочитан (`D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`), guard mismatch не было — СТОП не требовался.
- Запреты соблюдены: restic/E:/PVE/CT/VPS/production-БД/seed/HANDOVER-NEXT-AGENT.md не трогались, коммиты/пуши/мержи не выполнялись, только pnpm, UI и комментарии по-русски, TS strict.
- Зависимость feature/81: enum DELIVERY→STORAGE делает параллельная ветка; новый код не вводит DELIVERY, в `queries.ts` добавлен комментарий с литералом "STORAGE", мерж идёт после feature/81.

## Автоматические проверки

- `pnpm lint`: 0 errors, 5 warnings (предсуществующие: `cleanup-uploads.ts`, `product-attachments.tsx`, `product-percentage-pay/core.ts`, `income-form-native.mjs`). Новый тест без `any`.
- `pnpm db:generate`: Prisma Client v6.19.3 сгенерирован (требовался после fresh worktree, иначе `Cannot find module '.prisma/client/default'`).
- `pnpm --filter @pero/web test`: 1249/1249 PASS.
- Фокус: `product-percentage-default-settings`, `percentage-rate-input`, `single-product-percentage-ui`, `product-percentage-ceil`, `product-percentage-pay`, `product-percentage-ui`, `global-percentage-defaults-ux`, `product-percentage-default-create`, `single-percentage-controller`, `product-percentage-visibility` — 72/72 PASS (включая 3 новых кейса видимости).
- `openspec validate product-percentage-visibility --type change --strict`: valid; `openspec status`: 4/4 artifacts complete.

## Ручные кейсы (утверждённая матрица)

- Сумма до назначения (прогноз по ставке): мок без `assigneeId`, BYN, ставки 5/4/1.25, цена 1000, количество 3 → менеджер `total` ["50.00","120.00","38.00"] (v4 ceil: 37.5→38.00). Раньше без исполнителя было null. Ноль и отсутствие ставки: 0→"0.00", null→null.
- Ввод 1.25 сохраняется и считается: `defaultsPatchSchema` принимает "1.25", `saveProductPercentageDefaults` сохраняет "1.25"; старый "5.1" читается как "5.10", "0" как "0.00". Новое изделие из дефолтов 5.10/0.00/null получает 3 конфига ревизии 1.
- Стрелки дают x.0/x.5: общий `PercentageRateInput` (`stepPercentageDraft` +50 сотых): 5.05→5.55→5.05, 99.95→15, 0.05→0, ""→0.5; форма настроек теперь использует тот же компонент, подсказка «От 0 до 15, стрелки меняют на 0.5, можно ввести вручную до 2 знаков (например 1.25)».
- Поле не видит %: `SinglePercentageRow` с `canViewAll:false` — HTML содержит «Сумма:» и «120», не содержит «Процент»; сервер для WORKER отдаёт `ratePercent:null`, `unitPrice:null`, `productTotal:null`, `members` только своя строка с суммой, `assignee` с именем оставлен.
- Менеджер видит всё: с `canViewAll:true` — HTML содержит «Процент» и «Сумма:»; сервер для MANAGER отдаёт ставку/цену/базу/итог/всех участников как раньше; при `rate==null` видна подсветка «Ставка не задана — проверьте стандартные проценты», сумма «—».

## Изменённые файлы

- `apps/web/src/server/product-percentage-defaults/contracts.ts`: 2 знака, `toFixed(2)`, старые с 1 знаком валидны.
- `apps/web/src/app/(app)/settings/product-percentages/percentage-defaults-form.tsx`: plain `Input`→`PercentageRateInput`, подсказка обновлена.
- `apps/web/src/server/product-percentage-pay/queries.ts`: `draftTotal` без требования получателя, `total` виден всем, не-финансу только своя строка, ставки/база занулены, имена оставлены, комментарий STORAGE.
- `apps/web/src/app/(app)/products/[id]/product-percentage-panel.tsx`: строка суммы всегда в DRAFT, `%` только при `canViewAll`, подсветка null менеджеру.
- `apps/web/src/server/products/core.ts`: комментарий о ставке из настроек и подсветке (логика создания 3 конфигов без изменений).
- `apps/web/tests/product-percentage-default-settings.test.ts`, `product-percentage-default-create.test.ts`: ожидания 5.10/0.00, кейсы 1.25 и старого снапшота.
- Новый `apps/web/tests/product-percentage-visibility.test.ts`: прогноз без назначенного, поле/менеджер, карточка.
- OpenSpec: `openspec/changes/product-percentage-visibility/` (proposal/spec/design/tasks/evidence).

## Блокеры

- Нет. Требуется мерж после feature/81 (STORAGE) и staging-приёмка по GitFlow владельцем; коммиты/пуши не выполнялись по задаче.
