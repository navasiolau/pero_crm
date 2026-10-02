# Design

## Context

Feature/19 создана оркестратором отfresh24bdc21494a57877b23f64c803152b619146b360; после нового fetch выполнен ff-only до f2f529137ce8a799a7c554941591b0ed6851a1d6 без потери19правок. №18 фактически принят на24bd; app source web/prisma/bot24bd→f2 не изменился (последующие QA/документы), gate18 выполнен. №19 локально прошёл unit/native/build/compiled browser/actualzoom и cleanup, собственный staging19 принят наappSHA7e0df2afd544e9e36cc029b4af760262b7db7b56 через actualnative+двойнойnativeChromium/zoom proof. Результаты в evidence.md, local base revision не подменяет будущий release SHA19. Main/prod вне объёма; проектирование и verification не запускали DB/runtime, ими владел оркестратор.

Существуют text Product.description, nullable patch schema, обычный multiline InlineTextField и надежные №17 controller/Server Action/CAS/roles. Фактические choke points: product-inline-provider.tsx:12 raw.trim, products/core.ts:98 create trim, :233 generic patch trim, legacy updateProductCore/updateProductValues exact baseline и raw text; products-tab.tsx:426 add-product UI trim. InlineTextField multiline min-h-24 field-sizing-content; ui/textarea глобально content sizing. Keyboard уже Enter newline/Ctrl+Enter+blur save/isComposing guard, Tab не переопределён.

## Goals / Non-Goals

**Goals:** один небольшой description serializer, scoped большая Textarea и exact raw CAS/доказательства сохранности.

**Non-Goals:** universal rich text editor, JSON/schema/data migration, HTML/Markdown interpretation, замены всех Textarea проекта, layout25/файлы/денежная логика. Другие поля сохраняют свои существующие trim/null правила.

## Decisions

### Нормализация только нового description value

Small pure helper `normalizeProductDescription(value:string|null|undefined):string|null`: null/undefined/полностью whitespace→null, иначе вернуть исходную строку без trim результата. Проверка whitespace может использовать trim только как predicate, не как сохраняемое значение. Применить к client description parse и create/inline/legacy description writes. Title/kind/phone/address/money serializers не менять.

`expectedValue` не проходит этот helper: canonical comparison description — точный string/null. Current description также raw; старую whitespace-only/пустую строку не воспринимать как новый null при чтении. Обновление raw nonblank/whitespace связано с явным изменением, без backfill. Legacy full-input schema уже требует genuine baseline; нормализовать лишь изменённый description value, не соседние поля/expected fields. Create consumer передаёт raw строку; не терять форматирование в products-tab до server core.

Альтернатива CSS-only fix оставляет потери текста на клиенте/сервере, поэтому недостаточна. HTML/Markdown/JSON/editor library противоречат существующему источнику и не нужны.

### No-op и browser newline

Действующий controller сравнивает parsed value с baseline. Для старого whitespace-only raw baseline новая canonicalization даст null даже без ввода: не допустить записи только от focus/blur. Узкий description-only serializer/no-op seam учитывает равенство raw draft и formatted raw baseline до канонизации; общие phone/money/Project semantics не менять. настоящая очистка/замена отличается raw вводом и сохраняет null. Сохранять uncertain retry с тем же UUID и exact request; не делать сравнение через trim. На сервере после точного CAS также проверить raw равенство нового description текущему/baseline до нормализации: прямой RPC/legacy full-input с неизменённой whitespace строкой — no-op, а не скрытый cleanup. Нормализуется лишь действительно новый description value.

Textarea DOM может представлять CRLF как LF. Сервер сохраняет точно полученную строку и CAS использует исходный raw DB baseline; первоначальный render/чтение DOM не должны сами переписывать старые CRLF значения. Unit/native RPC проверяют LF/CRLF отдельно, compiled browser — строки/отступы/пустые строки/завершение реального ввода. Не выполнять replace переводов строк или migration существующего текста.

### Scoped большое поле

Для description предоставить scoped textarea props/classes у InlineTextField либо узкий ProductDescriptionField с reuse контроллера/SaveState. Начальная высота 20rem/порядка 12 строк, width/max-width100%, min-width0, native resize-y, wrapping/overflow по контейнеру. Scoped fixed field sizing/rows предотвращают content autosize, мешающий ручному resize; глобальный ui/textarea и другие forms не менять. Пустое поле всегда render-ится, readonly роли видят прежние разрешённые данные в такой же области.

Keyboard существующий: bare Enter newline, Ctrl+Enter save, blur save, Tab focus, IME composition не прерывается; не перехватывать Tab для вставки tab. Вставленные/полученные табуляции сохраняются. Plain React textarea/value/text interpolation, без dangerous HTML/Markdown renderer. Ошибки у поля, raw drafts не теряются, нет full field refresh.

### Прежние domain guards

Reuse products/core, patch contract, Product lock, current actor/DESIGN policy, receipt+transactional audit №17. Изменяется только description value rule; quantity/status/pay/initialPrice guards не трогать. Stale engineering запрос запрещён; MANAGER+ENGINEER full edit сохраняется. При exception после data write транзакция откатывает exact raw row/receipt.

## Risks / Trade-offs

- [Trim остаётся в addProduct/legacy path] → source inventory точных consumers + create/update/patch tests одного helper; UI-only proof недостаточно.
- [Baseline нормализован вместе с value] → whitespace-only difference CAS tests и raw expectedValue в network payload.
- [Старые строки изменяются focus/blur] → zero request/audit no-op test для raw whitespace/CRLF, не mass clean.
- [Большое поле выходит за sidebar/zoom] → scoped responsive width/native resize и фактические шесть размеров/actual200%.
- [Browser LF отличается от CRLF storage] → no-op не пишет; server/native сохраняют точно полученные строки, без искусственной конверсии старых данных.

## Migration Plan

Схема и данные не мигрируются. Official CLI и feature19 готовы отfresh24bd после root local-start сигнала с завершённым18кодом; integration вstaging только после accepted18. RED→GREEN helper/controller/core/create/legacy/roles; guarded existing local native exact text/rollback и compiled browser reload/network/keyboard/resize. Сохранить/восстановить только разрешённые own QA изменения с exact raw CAS/evidence, без дампов/reset/seed/restic. После атомарного коммита обычный merge staging и фактические image/SHA/health/scenarios. Main/production не входят.

## Open Questions

Перед official authoring сверить final accepted18 line numbers и actual scoped textarea API; это техническая актуализация, не новая продуктовая неопределённость.
