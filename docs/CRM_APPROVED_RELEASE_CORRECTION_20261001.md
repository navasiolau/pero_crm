# Pre-push frozen manifest — корректировка релиза CRM, 01.10.2026

> Frozen pre-push состояние. Root завершил локальные проверки кандидата; main push ожидается. Доставка будет подтверждена по Git `main` ref и итоговому receipt. Production результат не проверен и остаётся за владельцем.

## Состав

Сохранить без изменений уже выпущенные `universal-work-shares` и `manager-cash-advances`. Manifest первого трёхфункционального кандидата сохранён отдельно как исторический pre-push документ и superseded этой корректировкой. На момент того manifest main push не был выполнен; он не подтверждает доставку того candidate. Исходные hero receipts остаются provenance; correction UI задаёт новая feature `product-cover-layout`. Добавить три source-approved изменения из OpenSpec:

1. `product-engineering-pay` — только совместимость схемы/истории для чтения прежних начислений. Это не новая ручная настройка фонда и не новый Work/Task/весовой слой. Сохранять прежние суммы и историю без повторного начисления.
2. `product-percentage-pay` — фактические новые ставки для обеих фаз, инженерной и монтажной, задаются непосредственно как доли `Product.expectedPrice`; Work/Task для этих прямых долей не требуется, а доля передаётся только участнику той же роли. Исторические начисления, выплаты и распределения задач не пересчитываются.
3. `product-cover-layout` — без видимых caption/file name; крупная обложка справа у верхней строки изделия на desktop и сразу под заголовком на mobile; fullscreen и замена через две icon-кнопки для существующих ADMIN/DIRECTOR/MANAGER/ENGINEER permissions. Preview использует оптимизированный WebP. Схема и storage не меняются.

Точные цели cover-layout: [proposal](../openspec/changes/product-cover-layout/proposal.md), [design](../openspec/changes/product-cover-layout/design.md), [acceptance](../openspec/changes/product-cover-layout/acceptance.md). Инженерная история и расчёты: [product-engineering-pay](../openspec/changes/product-engineering-pay/). Прямые доли инженеров/монтажников: [product-percentage-pay](../openspec/changes/product-percentage-pay/).

## Дополнительные миграции

К уже учтённым в первом manifest миграциям работы и кассовых авансов добавить ровно три миграции из принятого correction-кандидата:

| Миграция | SHA-256 source SQL | Назначение |
| --- | --- | --- |
| `20260928220000_product_engineering_pay` | `0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266` | Инженерный фонд изделия и защита совместимости с историей |
| `20260930145000_product_percentage_enum_values` | `2d5ea9ef028cf9c38dff0bd4030846a8bca5f39d197e473cc7731ee73d017f17` | Значения enum для прямого процентного участия |
| `20260930150000_product_percentage_pay` | `7c0b2bf77c10418a534fca63a4d7b7c4d77c4c3ac7033aa69ff433bf14a42a6a` | Модели/ограничения прямого процентного начисления |

Итого для совместного релиза: пять миграций — две прежние аддитивные миграции shares/cash и три указанные выше. Cover-layout миграции не имеет. Хеши выше сняты с исходных принятых migration-файлов; они не доказывают применение миграций на production. Не переписывать старые суммы `PayrollEntry`/`Payout`, их сохранённые финансовые снимки или прошлые факты работ. Менеджмент может задавать новые product процентные ставки; миграция не запрещает такое изменение. Исторические защитные ссылки нужны для корректного чтения/совместимости, а не для ручного фонда или выдуманной разбивки старых начислений.

## История проверок и границы доказательств

- `product-engineering-pay`: source OpenSpec и прошлые проверки сохранены как история. Для этой корректировки миграция нужна только ради schema/history compatibility; source исторические начисления не являются новым интерфейсом фонда или основанием заявлять новое positive earning/split acceptance.
- `product-percentage-pay`: unit/DI и read-only staging UI на source `080d9d9` описаны в исходном OpenSpec. Положительное live earning/accrual и прямой live split **NOT VERIFIED**. Старострочная preservation-сверка staging не прошла из-за отдельно выполненного изменения существующей учётной записью; строки не восстанавливали и не исключали. Не выводить начисление из UI или unit-тестов.
- `product-cover-layout`: локальная и qualified read-only staging UI-приёмка на source `a899e8e` пройдена на существующих изображениях. Receipt допускает только подтверждённый штатный `ApiToken.lastUsedAt` timestamp и точное восстановление прежней preference. Picker проверяли на open/cancel; live cover replacement и upload **не выполнялись**. Не считать их проверенными.
- Публичный cover staging receipt: [`product-cover-layout-staging-20261001.json`](../deploy/evidence/product-cover-layout-staging-20261001.json), attempt `d70cc541-8f08-4b9e-abe4-dcd9389896aa`. Baseline SHA: `c0418204aa0c495817f86d17a1f503ad2d92d7e1b597b3d6bed8669f8c379383`; SHA-256 скопированного JSON файла с qualified proof: `6f0c998b323fc9bf358848863ac70d53bf0b7ed5dd74c50dec9983494a516056`.
- Для нового correction-кандидата пока не заявлены новые QA records, positive percentage earning/split, live cover replacement/upload или новый staging acceptance. Не проводить SQL, SSH или native write tests в рамках этого документа.

## Полные локальные проверки correction-кандидата

Root завершил локальный suite: `pnpm-rtests` web **525/525 PASS**, bot **9/9 PASS**; deploy unittest **66 всего** (64 PASS, 2 Windows POSIX-only skip); lint **0 ошибок** и одно прежнее предупреждение `existsSync`; Next production build PASS на dummy DSN без подключения к живой БД; post-build web TypeScript и bot TypeScript PASS; Prisma generate/validate в worker — PASS на dummy DSN; `openspec validate --all --strict` **11/11 PASS**.

Независимое побайтовое сравнение root (`git diff --cached --exit-code`, exit 0) подтвердило совпадение выбранного кода со стадийно принятой ревизией `a899` во всех `apps/web/src`, Prisma schema/migrations, `package.json`, `.gitattributes`, `.github`, watcher и installer. Текущая UI-реализация соответствует уже принятому staging UI. Это сравнение исходников, не новый staging прогон и не проверка production runtime. Подтверждённые SHA прежних shares/cash migrations остаются `65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6` и `bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd`; correction по-прежнему добавляет ровно три migration выше.

Полная исходная история сохранена в [product-engineering-pay](../openspec/changes/product-engineering-pay/), [product-percentage-pay](../openspec/changes/product-percentage-pay/) и [product-cover-layout](../openspec/changes/product-cover-layout/). Текущий task/spec статус этих source-изменений не заменяет проверку интегрированного correction-кандидата.

## Базовая ревизия и откат

Root сообщил о опубликованном source tag `codex/pre-crm-approved-correction-20261001` на ревизии `5b7685e301936dbacded50bf0d2a67677560d014`. Это Git source checkpoint, не DB/storage backup и не свидетельство production-состояния.

После появления новых инженерных settlement или direct percentage records возвращение на `5b7685e3` нельзя считать безопасным: старый код может не понимать новые состояния/защитные маркеры и неверно рассчитывать доступную к выплате сумму. Сохранять совместимые readers/calculations; при необходимости готовить совместимый forward-fix. Не выполнять blind rollback, drop/downgrade миграций, удаление или восстановление бизнес-данных. Безопасность полного отката БД не обещается.

## Доставка

Все описанные здесь checks локальные. Новых QA records, staging runs, production SQL/SSH или production checks для correction-кандидата не выполняли; source acceptance остаётся отдельной историей выше. Main push ожидает root; затем test-only CI gate на main должен пройти до публикации образа штатному watcher. Root/владелец подтверждают фактическую доставку по `main` ref и итоговому receipt. Production result acceptance явно принадлежит владельцу и ещё не выполнен.
