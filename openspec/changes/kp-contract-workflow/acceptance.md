# №186 — реализация и приёмка 18.10.2026

Worktree `D:/Projects/pero_crm_worktrees/kp-186`, ветка `feature/186`, исходная база свежего staging `d918ab86` по брифу оркестратора. Выполнены обычный FF merge принятой `feature/183` до `0b788bf9bc9f2ff43768b0a6e788a60c1c446d66`, включая №180/181/182, и последующая интеграция №184/185 оркестратором до `44cbee18d7248bf22c92e80151fdd123019ea110`. Собственные source/tests/OpenSpec №186 проверены до локальной атомарной фиксации; исходный `pero_kp`, другие ветки и рабочие данные сохранены. Push, команды БД, Docker, S3, SSH и облачные операции этим исполнителем не выполнялись. Prisma generate менял только собственный локальный generated client с фиктивным schema-only URL, без подключения.

## Реализовано

- Свежие defaults клиента из CP.clientId, полное ФИО, контакты, адрес, паспорт; адрес объекта из Project. Предсуществующее отличие Project.clientId допустимо. Служебный клиент не заполняет заказчика автоматически; корпоративные/manual-поля не угадываются и не пишутся в Client.
- Явные исправления autofill-полей хранятся отдельно и привязаны к выбранному клиенту. Baseline включает текущие клиентские сведения всех выбранных КП и обе связи. Смена данных после формы/во время рендера даёт 409.
- Draft CAS и повторяемые receipts в ChangeLog, атомарная замена источников с положительными position=index+1. Открытие/сохранение не меняют этапы. Договор доступен для редактирования вне «Лида»; архивный несвязанный КП — только чтение.
- Закрытый запрос генерации без raw state/settings, исходная ContractModel через adapter, замороженный CONTRACT job с общим форматом №185 и точной привязкой к actor/contract.
- Свежий PDF и исходные DPR2 PNG из одного Chromium-render либо принятый PDF → PNG через Poppler; затем исходный DOCX через обязательные порты вне транзакций. Digest/size/binding сверяются; ключи неизменяемы и привязаны к job/attempt. PENDING DOCX и durable orphan-cleanup регистрируются до upload.
- Одна финальная транзакция: lease/actor/token/revision/client/stage checks, все новые PDF и версии КП, READY DOCX, самостоятельный ContractVersion, переходы только LEAD/ESTIMATE через общий примитив и успешный job/outbox. Поздние/PAUSED/REFUSED этапы не возвращаются назад. Исключение откатывает публикацию.
- История DOCX доступна отдельно от нормализации текущего draft: архивный неполный draft не блокирует чтение семи старых DOCX. История отдаёт только id/date/artifactId/fileName. Снимки договора не создают FK или живую retention-ссылку на старые версии/файлы КП.

## Фактические проверки

- Собственные поведенческие/security тесты: **19/19**.
- Вместе с существующими project-inline-actions, project-inline-bot-route и project-contact-controllers: **44/44**, 0 failures.
- Полная web-типизация, ESLint затронутых файлов, OpenSpec strict: **exit 0**. Новые файлы проверены `git diff --no-index --check` отдельно, поскольку обычный git diff не включает untracked.
- Read-only вызов adapter с фактической исходной ContractModel: **6/6** — печатное округление 100.75−10%=90.68, смешанная валюта, подтверждение заказчика, график платежей и индивидуальные сроки. Runtime/CI не импортируют внешний D:/-проект.
- `runContractDatabaseNativeCases` фактически выполнен оркестратором на существующей local5433: имя БД/адрес/порт/schema guards до записи, собственные savepoints и обязательный rollback, **8/8 SQL-сценариев** (CAS/replay, 1-based источники/замена, ошибка второго перехода, общая успешная публикация/продвижение, принятие версии, неизменяемость снимка, повтор результата). Dispatch отключён. Metadata-only PDF/DOCX фикстуры не являются доказательством рендера/S3; точная квитанция ниже.

Native PostgreSQL-проверка задачи 3.2 завершена. Реальный renderer/S3, сравнение страниц DOCX/PDF, браузер и staging SHA/образ остаются незавершёнными в 3.3. DI-транзакция доказывает границу вызовов координатора; отдельный фактический SQL-run ниже подтверждает PostgreSQL rollback.

## Уточнение guards native helper — 18.10.2026

В `kp-contract-native-cases.ts` исправлены два препятствия будущему настоящему запуску: advisory lock возвращает поддерживаемый Prisma скаляр через `SELECT 1 AS locked FROM pg_advisory_xact_lock(...)`; SQL listener внутри Docker проверяется на внутреннем порту **5432**, отдельно от разрешённого host URL `127.0.0.1:5433`. Адрес сервера PostgreSQL не используется как доказательство адреса подключения клиента.

`NativeProof` теперь требует `{databaseUrl,expectedDatabase:"pero_crm",rollbackOnly:true,declaration:{target:"local",revision,runId,scenarioId}}`. До первого SQL выполняется чистая проверка формы URL/declaration, затем настоящий существующий `nativeAcceptanceBinding(declaration)`: точный `CRM_LOCAL_CONTAINER_ID`, running container, loopback port mapping, имя БД и пользователь. Полный URL доказательства обязан совпасть с полученной private binding; текст отказа не выводит credentials. SQL затем требует единственную identity-строку `database=pero_crm`, `schema=public`, `user=pero`, `serverPort=5432` и существующую public-таблицу договора. Отсутствие/неверный declaration, иной target, legacy host5432, другое имя и отсутствие явного rollback запрещены. Caller обязан открыть внешнюю транзакцию именно через этот guarded URL; все собственные изменения helper по-прежнему откатывает через savepoint.

Чистые guard-функции не выполняют Docker/SQL. Три новые DI-регрессии проверяют отказ до DB-вызова при неверном declaration/rollback, полное сравнение URL без раскрытия credentials и различие host5433/internal5432 с отдельной проверкой БД/схемы/пользователя/tableReady. До исправления зафиксирован RED (3 failures), после — **25/25 targeted contract tests PASS**, полный web TypeScript и ESLint двух затронутых test-файлов PASS. Проверка guards не является native-приёмкой. Этот исполнитель не запускал Git, Docker, БД, S3, SSH, сеть либо actual native; production logic не менялась. Предыдущие 22/22, related44/44 и sourceModel6/6 — отдельные исторические результаты выше.

## Независимое review и изменения root

Исправлены оба замечания: advisory lock читает `SELECT 1 ... FROM`, а tracked autofill-поля без ручного исключения принимают актуальные defaults даже при очистке CRM-поля. Для legacy raw settings сохранён прежний отдельный fallback. Добавлен сценарий очистки паспорта/email/адреса и повторного сохранения без превращения старых данных в ручной override.

Свежий `io.renderPdf` теперь возвращает `{bytes,pages}` из одного bounded Chromium-render №184: DOCX получает исходные DPR2 screenshots без повторного сглаживания через PDF. Для retained источников остаётся чтение PDF и Poppler. Совокупные приложения ограничены 128 МиБ/1000 страниц, каждая страница — 16 МиБ. Добавлены проверки точных байтов свежих приложений и отказа без публикации/переходов при превышении лимита. Финальные собственные targeted проверки — 22/22, full base TypeScript, ESLint, OpenSpec strict и diff check PASS. Прежний related44/44 и sourceModel6/6 относятся к исходной проверке выше.

## Интерфейсы для обычного merge и №187

`createContractWorkflow(ports)` экспортирует `form(actor,documentId)`, `history(actor,documentId)`, `saveDraft(actor,input)`, `requestExport(actor,input)`, `runClaim(claim)`, `finalize(claim,prepared)`.

Actor: `{id,source,tokenId?,sessionVersion?}`. API требует активного ключа этого пользователя и точного scope; web — текущего sessionVersion. Scopes: `kp:contracts:read`, `kp:contracts:write`, `kp:contracts:generate`.

- Draft input: `{documentId,expectedRevision,operationId,clientBaseline,sourceRefs:[{proposalId,expectedRevision}],settings}`. Export — та же форма без settings.
- Form: `{contractId|null,revision,settings,profiles,sourceRefs,clientDefaults,clientBaseline,canEdit,versions}`.
- Draft ACK: `{contractId,revision,sourceRefs,clientBaseline}`. При изменении списка baseline проверяется против прежнего подтверждённого выбора и возвращается для нового; UI сохраняет новый ACK-baseline.
- История: `[{id,createdAt,docxArtifactId,fileName}]`; отдельный endpoint работает даже при невалидных текущих настройках архива.
- Export ACK: `{id:jobId,state:'PENDING'}`. Receipt `ChangeLog.id=kp-contract-operation:<operationId>`, `newValue={fingerprint,actorId,tokenId,result}` сохраняется в той же транзакции. Нет post-commit перечитывания формы для создания receipt.

`createPostgresContractStore(transaction=withTaskTransaction)` принимает общий transaction wrapper, в котором №187 может записывать дополнительный per-key audit. Внутри callback доступен `createPostgresContractTransaction(nativeTx)`. Общий mutex `(18435,55001)`, затем проекты по ID, договор и клиенты. Блокировки клиентов/User/ApiToken удерживают прочитанный baseline и доступ до commit.

## Привязка портов к №184/185/187

- Model: `createContractModelPort(package.ContractModel)`; profiles из того же пакета. `templateVersion=String(package.contractTemplateVersion)`, templateSnapshot из pinned identity; filename через `package.contractFileName`.
- `lifecycle.parsePayload` → №185 parseRenderJobPayload. `freezeSources` → freezeSourcesInTransaction(nativeTx,actor,refs,ports185).
- `assertClaim` → assertRenderJobClaimInTransaction. `registerPendingPdf` → recordPendingPdfArtifactInTransaction; использовать возвращённые id/key, не создавать второй artifact.
- `registerPendingDocxCleanup` → registerPendingArtifactCleanupInTransaction с artifactId и primarySourceId. PDF-регистрация делает это сама.
- `publishSourcePdf` → publishSourcePdfInTransaction; преобразовать полученный VersionRecord в `{versionId:id,artifactId:pdfArtifactId}`. Этот шаг не завершает job.
- `advanceToContract` → patchProjectStageTransaction с expectedStage из замороженного источника, toStage CONTRACT, UUID операции. Если result.ok=false — бросить исключение. Вернуть eventIds; прямой UPDATE статуса запрещён.
- `io.renderPdf/rasterizePdf/generateDocx` → bounded RPC №184 с приватными bytes/assets и pinned templateHash. Исходный generateDocx не запускается в web-процессе.
- `io.retainedPdf/uploadAndVerify` → общий artifact-storage №187 с обязательной повторной авторизацией; fresh images читаются через №183. Договорный key использует contracts:generate, без дополнительного требования kp:export.
- `dispatchAfterCommit` → существующий durable outbox dispatcher. ContractVersion сохраняет metadata/state и self-contained DOCX; old quote PDF не удерживается ради исторического договора.

Mandatory ports не подменены заглушками в production, публичные routes здесь не добавлялись. Настоящие SQL/lifecycle/model зависимости теперь проверены через native composition; физические IO порты подключает и принимает №187.

## Проверка после обычного merge №183

`feature/186` переведена обычным `git merge --ff-only` с foundation `aff6c105bbf17c39036ff2b3d123eb5fdbba6233` на принятый SHA `0b788bf9bc9f2ff43768b0a6e788a60c1c446d66`. Stash, cherry-pick, squash, reset или перенос features файлами не применялись. Все 18 существовавших untracked-файлов №186 проверены SHA-256 до/после merge и сохранены побайтно, включая свежие native guards и NativeProof.declaration. Конфликтов и необходимых правок contract production-кода не возникло.

После merge фактически выполнены:

- Prisma 6.19.3 `validate` и `generate`: PASS. DSN заведомо schema-only `127.0.0.1:1/schema_only`, update-check отключён; соединение с БД не открывалось. Схема/client получены обычным merge и собственной генерацией.
- Полная строгая web-типизация `tsc --noEmit --incremental false`: PASS.
- Три contract test-файла `kp-contract-model`, `kp-contract-store`, `kp-contract-workflow`: **25/25 PASS**, включая три свежих проверки native guards.
- ESLint семи contract source-файлов, fixture, трёх test-файлов и native helper: PASS. `openspec validate kp-contract-workflow --strict`: PASS.

Это подтвердило совместимость №186 с фактически интегрированными №180–183. Последующие обычные merge №184/185 и SQL-native результат приведены ниже. Физический PDF/DOCX/S3, визуальная, browser и staging-приёмка не заявляются выполненными.

## Точная конфигурация следующего native DB запуска

Сигнатура: `runContractDatabaseNativeCases(tx, proof, configuration: Omit<ContractWorkflowPorts,"store">)`. Caller открывает внешнюю rollback-транзакцию на полученном `nativeAcceptanceBinding` URL и передаёт `proof={databaseUrl,expectedDatabase:"pero_crm",rollbackOnly:true,declaration:{target:"local",revision:<40-char SHA>,runId:<UUID>,scenarioId:<safe identifier>}}`. Host URL — loopback5433, SQL listener — 5432; полный URL и credentials не выводятся.

Helper сам создаёт `ContractStore` через `createPostgresContractTransaction(tx)` с savepoint на каждую команду и всегда откатывает все собственные fixtures. Нельзя передавать память из `contractWorkflowFixture` вместо настоящего DB lifecycle. Конфигурация требует все следующие поля:

- `enabled:true`, `temporaryClientId` — явный ID служебного клиента, отличный от синтетического клиента helper; это локальный порт, глобальный флаг продукта не включается.
- `model:createContractModelPort(ContractModel)` и `profiles:ContractObject[]` — согласованные исходные Model/profiles №184. Выбранный profile должен присутствовать после normalizeSettings; самостоятельных формул нет.
- `templateVersion:string`, `templateSnapshot:ContractObject` — одни и те же pinned значения на request/finalize. `storageBinding:ContractObject` — валидный дескриптор для metadata-only PDF/DOCX, без обращения к хранилищу. `fileNameForContract(number):string` — прежний helper имени.
- `lifecycle:ContractLifecyclePort` — настоящие parse/freeze/claim/PDF reservation/PDF publication/orphan cleanup №185 на `contractTx.native`; точные семь методов перечислены в разделе «Привязка портов». `publishSourcePdf` возвращает `{versionId,artifactId}`.
- `lifecycle.advanceToContract(contractTx,actor,source,operationId)` вызывает `patchProjectStageTransaction(actor,{projectId:source.projectId,expectedStage:source.projectStage,toStage:"CONTRACT",clientMutationId:operationId},contractTx.native)` из `projects/stage-core.ts`. При `mutation.result.ok=false` бросает исключение; возвращает `mutation.eventIds`. Здесь `operationId` явно переводится в существующее имя поля stage-примитива `clientMutationId`. Прямой UPDATE или забытый stage acceptance hook №185 не заменяют этот вызов.
- `io` обязан иметь `renderPdf`, `retainedPdf`, `rasterizePdf`, `generateDocx`, `uploadAndVerify`; данный native DB helper не вызывает `runClaim` и эти пять методов. Для этого отдельного metadata-only сценария их можно задать функциями, бросающими `QA186_RENDER_IO_FORBIDDEN`, чтобы исключить renderer/S3. Это не production composition и не физическая приёмка документов.
- `dispatchAfterCommit(eventIds)` присутствует в типе конфигурации, но helper заменяет его безопасным async noop, поскольку внешняя транзакция ещё не завершена. Настоящие outbox-записи проверяются внутри rollback; отправки нет.

Обычные merge №184/185 выполнены оркестратором, описанная SQL composition проверена настоящим native-run ниже. Прохождение DI-тестов и tsc само по себе не подменяет этот результат и не подтверждает физические IO порты.

По текущим интерфейсам владельца №185 security-порт имеет ровно форму `{authorizeSource(nativeTx,binding):Promise<void>}`, где binding — `{id,source,tokenId?,sessionVersion?}`. В нативной web-фикстуре это строгая проверка активного пользователя/роли/сессии, например делегирование `createPostgresContractTransaction(nativeTx).authorize(binding,"kp:contracts:generate")` с отбрасыванием результата; не noop. Общие LifecyclePorts №185 дополнительно требуют `enabled`, `templateIdentity():{templateHash,fontManifestHash,sourceManifestHash,chromium,puppeteer}`, `pricingSnapshot(proposal):JSON-object` с Decimal-строками и `mediaIds(state):string[]`. Внешнего clock/accessPolicy порта нет; store получает SQL clock сам.

Точные адаптеры №185 (все на `contractTx.native`, без второй транзакции):

- `parsePayload(value)` → `parseRenderJobPayload(value)` из `lifecycle-contract.ts`.
- `freezeSources(tx,actor,refs)` → `freezeSourcesInTransaction(tx.native,actor,refs,ports185)`.
- `assertClaim(tx,claim)` → `assertRenderJobClaimInTransaction(tx.native,claim,security185)`.
- `registerPendingPdf(tx,claim,source,descriptor)` → `recordPendingPdfArtifactInTransaction(tx.native,{claim,proposalId:source.proposalId,artifact:descriptor},ports185)`; используется возвращённый artifact, второй не создаётся.
- `registerPendingDocxCleanup(tx,claim,artifactId,primaryProposalId)` → `registerPendingArtifactCleanupInTransaction(tx.native,{claim,artifactId,proposalId:primaryProposalId},security185)`.
- `publishSourcePdf(tx,claim,proposalId,verified)` → `publishSourcePdfInTransaction(tx.native,{claim,proposalId,artifactId:verified.id,verified},ports185)`; возвращённый VersionRecord преобразуется в `{versionId:record.id,artifactId:record.pdfArtifactId}`. Завершать job здесь нельзя: общий CONTRACT job завершает финализация №186.

CONTRACT job имеет `proposalId=null`, заполненный `contractId`, `createdById=payload.actor.id`, `payload.extra.contractId=job.contractId`, `claim.kind="CONTRACT"`. PDF reservation самостоятельно создаёт orphan intent; DOCX cleanup регистрируется явно. LEAD-источник использует mode render, retained-источник не публикует вторую версию. Принятие КП выполняется общим stage-hook №185 при переходе, а не отдельным UPDATE в адаптере.

## Фактический native-run после интеграции №184/185

Оркестратор выполнил root-only native на integrated HEAD `44cbee18d7248bf22c92e80151fdd123019ea110` с собственными файлами №186. Reviewed source plan SHA-256 `e9fda8165509a0a5b224507e1f949128bf934d4234fffdf2fdd255330363ef54`, runId `816c4180-eda6-42b7-8fca-31181a9dcd76`. Квитанция: `.playwright-mcp/kp-186/native186-root-12166fae-c4b0-4e7e-93a3-b5d828521f92.jsonl`; итог **PASS, 8/8 SQL cases**. Независимое read-only review портов/guards выполнено без замечаний.

В одной SERIALIZABLE rollback-транзакции проверены настоящие create/full-save №181, pricing №182 с количеством/ценами единицы/поправкой и пустой media composition №183. ContractModel/profiles/identity №184 использованы из своего нормально интегрированного пакета; lifecycle wrappers и stage acceptance №185 — настоящие. В LifecyclePorts передавалась явная проекция пяти полей templateIdentity; version оставался только в договорном templateSnapshot. Общий PDF adapter не завершал CONTRACT job раньше финализации.

Helper подтвердил draft CAS/replay, порядок источников с position=index+1 и замену состава; ошибка второго stage-перехода откатила общую публикацию PDF/ContractVersion/статусов, затем повтор успешно перевёл оба собственных проекта и черновики; принятые версии закреплены; изменение Client после выпуска не изменило снимок; повтор финализации вернул прежний результат. Реальные `authorizeSource` и `patchProjectStageTransaction` выполнялись в переданном native tx. Пять физических IO методов были заблокированы, dispatch заменён async noop, внешние fetch/transport/S3/process/singleton вызовы запрещены tripwires.

Внешний private sentinel выполнил обязательный ROLLBACK; все fixtures откатились. **Все 76 таблиц и полный public-каталог совпали точно до/после**: baseline SHA-256 `afd3a5a3feb4e6029c8ca298804d713f6b778b05da403194380adee268ee9bec`, catalog SHA-256 `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`. Сохранены все 83 успешных receipt и четыре прежних checksum-исключения, 11 таблиц КП вновь пусты. Постоянных native-записей нет.

Полная web+runner типизация после интеграции PASS; повторять широкий прогон после одних OpenSpec-правок не требовалось. Targeted contract tests остаются 25/25; перед фиксацией выполнены их повтор, ESLint собственных файлов, OpenSpec strict и staged diff check. Local tooling guard tests — 4/4, ignored runner/receipts не входят в коммит. Владелец разрешил локальный коммит №186; push/staging/production этим этапом не выполняются.

Граница результата: `physicalDocumentAcceptance=false`, `rendererAccepted=false`, `s3Accepted=false`, `physicalIoPortsBlocked=5`. Успешный metadata SQL-run не объявляет принятой генерацию байтов или настоящие S3 Put/Get/readback, визуальную идентичность, HTTP/API/browser либо staging. Эти проверки остаются открытыми в 3.3 и composition №187.
