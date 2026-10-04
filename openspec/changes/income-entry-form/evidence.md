# Приёмка формы прихода61

## Source и локальные проверки

- Fresh base origin/staging `6f98a0fd11ce9f6601b4b65e6d6802e030acc700`, ветка `bugfix/61`.
- Backend RED11 tests/5 PASS/6 FAIL:5 поведенческих ошибок потерянной FK/invalid/inactive/race/mismatch/missing loader articles; одна ошибка test encoding не считается behavioral RED. После исправления harness и кода focused18/18 PASS, scoped lint0/0.
- Component RED: первая actual подпись Project вместо Article. GREEN1/1 с настоящими React/BaseUI Dialog/Select, подменены только actions/router/toast. Проверены порядок, number-only options, точный placeholder, ручной выбор/no auto-first Income, outgoing selected FK/null project и прежний auto-first Expense. Минимальная stacking CSS не является layout proof.
- Общий набор **1188/1188 PASS**, TypeScript PASS, scoped ESLint0errors/0warnings, diff check PASS, production build PASS с build-only DSN; strict OpenSpec PASS. Independent source review ACK, конкретных P1/P2 нет.
- Реальный browser component test требует Chromium: CI test runner устанавливает официальный browser через существующий Playwright package перед test; роли/деплой/permissions workflow не меняются.

## Existing local native

- Первоначальный readonly/local native STOP до записи: нет активных ExpenseArticle/CashAccount, реальный ADMIN и BYN Project есть. Это не application failure; исходный STOP сохранён.
- Только2 недостающие owned references созданы внутри OUTERROLLBACK, без новых users/projects/seed/DB и без persisted fixtures.
- `income61-local-native-9606853a-ac53-4b20-9e0a-7437c6ff1163/receipt.private.json`: actual createPaymentInTransaction сохраняет выбранную FK для INCOME с NULL/linked project; currency/amount/rate/BYN/projectAmount/cash snapshot правильны. Original tables/schema MATCH после forced rollback, persisted0/outbound0; afterCommit NOT_EXECUTED.

## Staging

- Implementation commit c20d6f6, ordinarymerge staging `8479b29b5fa0ec82e5ef2438e9f833641607b4b3`; CI117SUCCESS https://github.com/navasiolau/pero_crm/actions/runs/37197438303. Actual deployment2eddebaa: source8479/publichealth200,46tables/прежнийDBvolume/W07; новой миграции нет.
- Stage activeExpenseArticle0: первоначальный native STOP до первого Payment сохранён. Для native создана толькоoneArticle внутриouterROLLBACK, для browser толькоone signedlongQAarticle с exactcleanup; существующиеinactive/деньги/пользователи не менялись.
- `income61-stage-native-5b872545-482e-40e0-898b-bbdb052d7563/receipt.private.json`, SHA `015870b8fc784c13ab98f1c51563353d4c0584566815e87dfcf14376aa0fdac7`: actual selectedFK/INCOME/projectNULL+linked/cashcurrency/amount/rate/BYN/projectAmount, original46/schemaMATCH послеforcedrollback, persisted0/outbound0/afterCommit NOT_EXECUTED.
- Actual browser `income61-layout-7c88db97-4eae-4d45-b15b-c16c7223cfdb`: observations1440/390/360 записаны ДОasserts. Dialog scrollWidth=clientWidth576/358/328; dropdown544/326/296; bboxes внутриviewport, footerreachabletrue, mobileverticalscroll корректен. Article→optionalproject, noautoarticle, actualmanualselectionlongname, projectNUMBERonly, commentplaceholder exact подтверждены. Root просмотрел все3PNG.
- ПервыйUIattempt6633 остановлен private selector:unscoped option захватывал nativeprojectoptions; cleanupполная. Исправлен только selector кactualselect-content. Wholefinalprotocol честноSTOP по3automaticPOST/finance/income, deniedbeforeupstream; formsubmit0/provider0. Повторныйverify послеужеуспешнойcleanup получил OWN_ARTICLE_CAS_STOP на намеренно удалённой строке; он не отменяет prior cleanup receipt. ПрежниеSTOP не переименовываютсяPASS.
- Cleanup SHA `e8b9e9b17e1def1dfdc2013d6d12faee5aaaf2af3f7bbadcf7759caa1f8955a3`: INCOME61_OWN_ARTICLE_CLEANED, original46/schema/preferencesMATCH, ownArticleAbsent. Independentfile reviewer подтвердилbothSHA и реальныеperviewportmilestones; after-submit browser/delivery не заявляются.
- Все6пунктов выполнены; функционально принят8479. Subsequentwarehouse58fix/документирование не меняет income executable behavior; источник сравнивается отдельно. Нет новой схемы учёта/миграции/backfill/ledger columns. Restic/dumps/seed/reset/newDB/prod/main/W07/refresh не менялись.

## Корректировка по прямому указанию владельца04.10.2026

Предыдущая связь ExpenseArticle с INCOME отменена. Предыдущие6пунктов и receipts выше подтверждают историческую реализацию, но не являются текущим требованием. Текущая форма и сервер не допускают расходной статьи у нового прихода; новый справочник доходов не создаётся.

- bugfix/61 обновлена fast-forward доfresh origin/staging221eaeec. Shared paymentSchema отклоняет INCOME с непустой статьёй до DB/FX; прямой transaction seam использует тот же parse/input-prepared guard. Income loader не читает/не отдаёт ExpenseArticle. UI общего и проектного прихода не показывает статью и полностью исключает поле из payload даже при старом состоянии. EXPENSE required/active/FK unchanged.
- Backend meaningful RED9/12: три нужных server/tx/loader checks падали; GREEN19/19. Настоящий PaymentDialog RED: три INCOME UI checks и stale payload check падали, расходы проходили; GREEN5/5. Scopedlint PASS, full1194/1194 PASS, TSC/build/OpenSpec strict PASS, independent source review ACK безP1/P2.
- Existing local native income61-local-native-8c2adbc4-edbd-4912-be33-1e50daf9a5f3/receipt.private.json SHA256 d310f68ced76d2a220ebea5a24a164d486f290ffcee74392051eb83b8029cc93: INCOME NULL common/project-linked, malicious income article core+tx rejected с0DBcalls/0rows, расход без статьи отклонён, настоящий расход со статьёй успешен. Все исходные таблицы/схема MATCH, forced outerROLLBACK, persisted/provider0.
- Local Docker Desktop был остановлен; оркестратор проверил существующий officialinstalleddaemon/context/service и запустил только Desktop hidden. Прежняя localDB/volume identity подтверждена; новых контейнеров/БД, reset/seed/дампов не было. Stage native и краткая readonly форма ожидают фактического нового образа. SQL/history/data backfill/main/production/restic/W07/refresh не меняются.
