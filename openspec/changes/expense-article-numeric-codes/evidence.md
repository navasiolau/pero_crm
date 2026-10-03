# Evidence — №62: числовые коды статей

Feature62 от fresh927. CLI ff/apply прочитаны, proposal/design/spec/tasks strict valid до реализации. Изолированные зависимости установлены offline/frozen/ignore-scripts, downloaded0; Prisma с новой схемой генерирован только в development62, не в shared26. DB migration не выполнялась.

ExpenseArticle.code — Int UNIQUE с positive CHECK. Migration20261003020000 назначает только missing codes детерминированно поcreatedAt,id начиная после existingMAX, включая inactive. Payment id/FK/amounts не изменяются. Код после создания не редактируется; toggle active его сохраняет.

Real action regression RED3fail/1permissionpass → GREEN4/4. Parser/migration-preservation2 также PASS: итог focused6/6. Проверены automaticMAXinactive/custom/duplicate/zero/sign/fraction/overflow, centralFinance readonly refusal, audit failure rollback и отсутствие изменения старого payment identity/amount. Первый запуск из неправильного cwd дал module-resolution failure; это не behavioural RED, затем actual tests выполнены из apps/web.

Полный TypeScript PASS. Scoped ESLint0errors/0warnings, NODE_PATH только own isolated pnpm hoist для existing plugin resolution; новые deps/config не добавлялись. Private logs `.playwright-mcp/round2/article-red.private.log`, `article-green.private.log`, `install.private.log`, `generate.private.log`.

Articles query/view показывают readonly код и сортировку, новая форма принимает ASCII digits и предлагает max всех статей +1; duplicate возвращает понятный текст, draft не теряется. Article write/audit внутри existing global transaction lock. Only central requireFinance/FINANCE_ROLES; PROCURE/PROCUREMENT не hardcoded, role58 подключит доступ при интеграции. CashAccount функции не менялись.

Task3.2 pending: root applies migration и принимает actual local/staging/code-generation integration/native/browser. NoGit/DBapply/seed/reset/runtime/SSH/restic/dumps/production operations by worker.
