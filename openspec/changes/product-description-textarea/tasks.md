# Tasks

## 1. База и RED

- [x] 1.1 Оркестратор создал feature/19 от fresh origin/staging24bdc21494a57877b23f64c803152b619146b360 после localcomplete18; затем оркестратор выполнил fresh fetch и ff-only до f2f529137ce8a799a7c554941591b0ed6851a1d6 с сохранением всех19правок; CLI root/context/status/apply/strict validation сверены, чужие изменения сохранены. Local start19 разрешён; №18 фактически принят на24bd; app source diff24bd→f2 пуст, gate accepted18 выполнен. Собственная staging-приёмка19 остаётся4.5.
- [x] 1.2 Зафиксировать RED actual trim losses в client parse/server create/patch/addProduct, exact strings "  A\n\tB\n\nC  \n\n", CRLF, whitespace-only/null и no-op rawbaseline; tests падают до implementation без DB.

## 2. Текстовый домен

- [x] 2.1 Ввести pure description value canonicalizer и подключить create/patch/legacy, оставив raw expectedValue; GREEN exact string/null/leading/trailing/tab/newline/raw-unchanged-server-no-op tests и source inventory показывают отсутствие остаточного trim результата description.
- [x] 2.2 AddProduct consumer передаёт raw text, legacy baseline остаётся genuine/raw; tests создания/partial/full update сохраняют точный текст, stale baseline с разницей только whitespace даёт conflict и не меняет соседние поля.
- [x] 2.3 Проверить raw no-op в контроллере до value canonicalization: focus/blur неизменённой legacy whitespace/CRLF не создаёт запрос/audit; явная очистка сохраняет null. Retry/late response не обрезают новый draft и не дублируют receipt.
- [x] 2.4 Tests ролей: assigned ENGINEER DESIGN, после PRODUCTION отказ, MANAGER+ENGINEER full write, ACCOUNTANT/field роли readonly; mutation/audit failure сохраняет точный прежний row через rollback, другие qty/status/pay/initial rules unchanged.

## 3. Scoped Textarea

- [x] 3.1 Сделать description field minheight около20rem/12строк, width100/minwidth0/nativeverticalresize/fixed sizing scoped; CSS/DOM тест подтверждает другие Textarea неизменны и null поле видно.
- [x] 3.2 Сохранить Enter newline, Tabfocus, blur/CtrlEnter save и IME guard; browser/network keyboard тест подтверждает отсутствие промежуточного save/full card Flight, ошибки/drafts отображаются у поля.
- [x] 3.3 Literal HTML/Markdown-like text и длинные строки отображаются только как текст; unit/DOM проверка no execution/no new format, server serialized description совпадает с input.

## 4. Проверка и staging

- [x] 4.1 Targeted/full tests, lint/typecheck/build и diff проходят; RED→GREEN записан, нет dependencies/schema/data migration/несвязанных layout или денежных изменений.
- [x] 4.2 Root native QA на existing guarded local DB проверяет exact strings/null/CAS/roles/audit и exact rollback/hashes, без новых DB/dump/reset/seed; authoritative target proof и результаты сохранены.
- [x] 4.3 Compiled browser save→reload показывает исходные leading/trailing/tabs/blanklines/newlines; delayed/failing POST, raw no-op, conflicts/roles и snapshot-safe restoration проверены; root QA edits толькоточно разрешённые и restored по receipt.
- [x] 4.4 Лично проверить 320×800,360×800,390×844,768×1024,1024×768,1440×900, sidebar/actual200% zoom, вертикальный resize и достижимость errors/actions; screenshots не заменять build.
- [x] 4.5 Один атомарный19commit+обычныйmerge staging только после accepted18 по выданному разрешению, CI и actualSHA/image/health/text/roles/browser acceptance; nightrefresh/W07 сохранить, root владеет выпуском. Main/prod исключены.



## Evidence

Фактический local evidence: [evidence.md](evidence.md). Root native6groups/43tablesrollbackPASS; final compiled browser60checks/skips0/failures0 и actualChrome200%zoom5 PASS, root лично просмотрел6sizes/native-resize/errorzoom; cleanup CLEANED/prefs RESTORED. Три прежние QA попытки FAIL0/5/6checks и успешные cleanups сохранены отдельно. Полный web722PASS, последующие14 QA guard/codec/matcher tests PASS; root выполнит finalfullrerun перед commit. 4.5 actualstaging19 принят на7e0df2afd544e9e36cc029b4af760262b7db7b56: native6/43rollback, два nativeChromium59checks/zeroerrors иtruezoom5/cleanup/prefs. CIlogsнепрочитаны, workflowtestdependencyфиксируется безвыдуманногогreenCI. Main/prodнеизменялись.
