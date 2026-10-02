# №20: код самостоятельного браузерного контура

Подготовлены `product-attachments-browser.mjs`, `product-attachments-stage-runner.mjs`, узкий `product-attachments-flight.mjs` и scoped attachmentsMode в настоящем Chrome zoom helper. Исполнитель не запускал DB/SSH/браузер/storage/stage-runner. Root выполняет actual acceptance после compiled source freeze.

Syntax и targeted ESLint PASS; шесть pure case/scope/layout/codec tests PASS. PNG factory создаёт валидное изображение 128×96 через существующий sharp; PDF имеет настоящий xref; B3D — обычное test attachment для действующего filename eligibility, не доказательство CAD render.

## DOM и закрытые мутации

Согласовано с UI-owner по действующему DOM: description над существующими вкладками, `data-product-measurement` сразу под ним; документы — широкий sibling `data-product-documents`, колонки production/installation. Нет вымышленной вкладки «Общее». Общие file rows имеют `data-file-id`; NoModel — единственный `#product-no-model` в Production, manager-only.

Восемь конечных own случаев: старый measurement PDF со stage INSTALLATION, ASSEMBLY PDF, реальная PHOTO cover через assignCover=1, PDF unassigned product B, новый measurement PNG, production PDF с длинным русским именем, installation PNG, OTHER B3D. Первые четыре создаются реальным same-origin compiled upload REST; новые обычные блоки проверяются через реальные Uploader widgets. OTHER использует существующий wildcard policy; DRAWING default не разрешает B3D, настройки не меняются. Все fields/product/project/category/stage/MIME/size/bytes hashes ограничены этими exact cases, fake task запрещён.

Все scalar requests — только закрытый own description patch с UUID и настоящим strict decoder №19. Upload capture сохраняется до ACK; отрицательный network upload тест abort-ится до upstream, показывает реальную ошибку клиента и retry через тот же widget. Каждый успешный upload получает отдельный подтверждённый ID, никакая галерея заранее не объявляется saved.

NoModel/source-registered file-delete requests привязаны к captured actor/path/actionID/args и known exact file subject. NoModel сохраняет только подтверждённую цепочку false→true→false. Не допускаются Price/initial/quantity/status/percent/finance mutations. Product B остаётся unassigned DESIGN для прямого ENGINEER denied original URL. Field role/office/combined cohorts берутся из подписанных существующих session profiles; никакие fake Tasks/users не создаются.

## Настоящий Flight и сохранение черновика

Файлы/NoModel legitimately возвращают full RSC после существующего revalidate. По прямому root-разрешению это наблюдается через настоящий installed Next15.5.20 client.edge в изолированном VM каждого ответа. SSR manifest даёт инертные namespaces без загрузки/исполнения app modules или chunk/callServer. Decoder ждёт действительную `a` promise, принимает только closed ok/error/(undefined result), отбрасывает f. Браузер получает unmodified real RSC bytes; domain validator/action не mock-ается. Scalar №19 codec остаётся строгим: modules/full RSC запрещены. Genuine installed server.edge production encoder tests подтверждают bool/error/Unicode и nested client/server refs; wrong actor/path/actionID/subject и redirect отвергаются.

Реальный description ACK задерживается после upstream commit; более новый raw draft должен пережить upload/delete refresh и последующее подтверждение. Проверяются прежние original SHA256, generated JPEG thumb, image viewer original, inline PDF и explicit download; два вложения append, cover не дублируется в новых группах. ENGINEER получает refusal при удалении чужого admin-uploaded файла; подтверждённый файл сохраняется.

## Подпись и cleanup

Finance-owner предоставил отдельные session/fixture/native helpers и `bundleProductAttachmentsQa`. Session checkpoint предшествует fixture prepare. До любого app delete coordinator получает signed fileObservation всех возвращённых IDs/keys. После первого UI delete новый signed alive manifest принимает исходный signed prior, сохраняя exact audit/storage scope.

Cleanup нового admin context использует только реальные compiled deleteFile buttons/ConfirmDelete по exact signed IDs; cover удаляется из прежней вкладки Files, где он всё ещё виден. SDK Delete/DB File delete/prefix removal в coordinator отсутствуют. После всех app deletes signed fixture inspect подтверждает DB files0+все исходные keys отсутствуют через real HEAD/local ENOENT; затем exact own fixture rows/audits restore, затем session preference CAS restore.

Unknown/неподтверждённые upstream results, неожиданные actors/actions, unsuccessful positive upload (возможен неизвестный storage outcome) и guard mismatch — STOP с сохранением checkpoints/private journals. Никаких overrides/рестиков/дампов/новой БД. Stdout — только counts/revision/cleanup; cookies/private credentials остаются в памяти.

## Визуальные проверки для root

Шесть размеров, sidebar/same-viewport crossing640 и плавная ширина должны доказать реальный container rule: две равные колонки при content width≥640, иначе Production→Installation. Long Russian names/actions/gallery не выходят за страницу. Chromium tabs.setZoom/getZoom200 + native compositor остаются настоящими; attachmentsMode3020 ограничен own product/selector, без viewport/CSS zoom подмены. Actual browser/native/staging PASS здесь не заявляется.

Root первый actual local browser20 завершился FAIL после 2 checks/8 uploads в `original_thumb_view_download`: default Playwright headless-shell не поддержал открытие PDF, popup оставался blank. Все 8 реальных файлов/keys были удалены через подтверждённый контур, fixture CLEANED/prefs RESTORED. Исправлен только QA launch: точно как доказанный №18 `chromium.launch({headless:true,channel:"chromium"})`, mode явен в receipt. PDF popup/view1/content-disposition checks сохранены. Source guard предотвращает возврат headless-shell и удаление PDF проверки. Pure tests 7/7 PASS, syntax/ESLint PASS. Фактический повтор запускает root; новый actual PASS здесь не заявляется.

Root второй actual local browser20 завершился FAIL после 4 checks/8 uploads на NoModel: QA выбирал скрытый Base UI input по внутреннему id. Все files/keys CLEANED/prefs RESTORED; NoModel до сбоя не записывался. Исправлен только QA selector на доступный `getByRole('checkbox',{name:'Модели нет',exact:true})`; подтверждены один visible control и его расположение в Production. Role matrix считает доступные checkbox, а не скрытые HTML internals. Force click и app изменения не применялись. Source guard и pure tests 8/8 PASS; syntax/ESLint PASS. Фактический повтор выполняет root.

Root последующая функциональная приёмка дала 84 checks PASS/8 файлов/exact cleanup и actual zoom4, однако personal visual обнаружил сжатый примерно20px title header при заполненном sketch на1440/sidebar840. Этот receipt фиксирует функциональный PASS с visual FAIL, а не принятую №20. UI-owner исправил header; QA теперь измеряет title width≥min(220,доступная ширина title-row минус arrow/gap), nonzero ancestors, label/input и action/status non-overlap. Checks реально вызываются для всех6размеров, same-viewport sidebar и smooth widths; hidden Base UI internals исключены. Pure case прямо отвергает старый20px collapse даже при отсутствии pageoverflow.

Root отдельно подтвердил две P2 корректировки: measurement category имеет приоритет даже при совпадении со sketchFileId, и photo-upload должен идти через видимый dialog/dropzone. Новый finite9 case создаёт реальный B MEASUREMENT/INSTALLATION PNG через existing upload route, затем назначает его sketch через существующий UI picker/setProductCover(B,id), без DB metadata/S3 faking. A обычный PHOTOcover остаётся исключённым из документов. Both cover-bind ACKs ограничены previousFileId=null; все9 metadata/keys подписываются до первого delete. Decoder cover-bind расширен только по прямому root-разрешению для точного admin/ownB/actualBfile/actionID/args; foreign subjects отказываются.

Photo QA открывает видимый «Фото замера изделия» и проверяет dropzone, реальную ошибку при controlled paste с pre-upstream network abort, доступный retry, busy/disabled во время задержанного реального ответа и успешный drop через реальный upload handler. В receipt явно `SIMULATED_DOM_PASTE`: controlled File/DataTransfer DOM event, не native ОС clipboard. Root разрешил этот вариант; чтения/записи живого clipboard нет, fakeTask отсутствует. Тот же файл после retry даёт один подтверждённый ID, включая dirty-description сохранность.

Новые guards/cases/Flight/title/modal tests 11/11 PASS, syntax/targeted ESLint чистые. Это code-only проверки: повторную фактическую visual/functional/native/staging приёмку выполняет root после rebuilt frozen candidate. Последний authoritative native receipt — 5 groups +5 actual status-policy cases,43-table rollback (по root), actual zoom —4, не завышенные counts.

Новый прямой user instruction переносит всю визуальную матрицу/zoom до завершения кода20–26. Добавлен operation `smoke`: только необходимые функциональные uploads/modal/NoModel/ACL/точные cleanup; `skipVisual` не запускает6размеров/sidebar/smooth/zoom и receipt явно `VISUAL_DEFERRED`, не visual PASS.

Root последний run...2ce5f438 остановлен с сохранением OWN-state. Generic Playwright paste не создал ClipboardEvent, clipboardData отсутствовал; исправлен QA на настоящий `new ClipboardEvent` в DOM с контролируемым DataTransfer/files1. Node pure fixture подтверждает readable clipboardData и отказ generic/missing данных; root разрешил simulation, OS clipboard не затрагивается.

Для guarded reconciliation добавлен code-only `product-attachments-recover-runner.mjs`: OLD checkpoint/journal читаются и не перезаписываются; новая session prepare используется только для short-lived cookies с точной привязкой старых actor IDs/roles, новый baseline отбрасывается. Новый HMAC file observation получает все действительно captured alive IDs; реальные app UI delete, final keys-absence inspect/restore OLD fixture, затем ORIGINAL session baseline restore. Отчёт `RECOVERED_OWN_DATA`, не acceptance PASS. Finance исправил ровно approved B MEASUREMENT PNG/INSTALLATION cover guard, старые signatures/namespaces неизменны. Все15pure tests и targeted ESLint PASS. Исполнитель runtime не запускал; отдельный root cleanup/Go обязателен перед любым local runner.

## Actual local functional smoke — 02.10.2026

После явного root Go исполнитель запустил только reviewed `product-attachments-stage-runner.mjs local 7bcef04f28f1be2f6fb686e17cd6f3334960ddb0 smoke` с existing guarded127.0.0.1:5433/pero_crm environment и explicituploadsRoot этого worktree. Root заранее подтвердил recovery предыдущего OWN run и готовность compiled3020. Никакие rawSQL/directSDKDelete/SSH/Git/stage/prod/restic/dump/reset/seed команды не выполнялись.

Actual PASS:13functionalchecks,9реальныхapp-uploadedfiles. Pending/error controlledClipboardEvent/drop с реальным HTTP upload, Bmeasurement-as-sketch/Aphotoexclude, file original/thumb/PDF/nativeChromium/download, description dirty/RSC сохранность, managerNoModel false→true→false и actorACL/engineernegative прошли. `VISUAL_DEFERRED`: размеры/sidebar/smooth/zoom в этом запуске НЕ выполнялись и visual acceptance не заявляется.

Outputdir: `.playwright-mcp/modernization/local-attachments-smoke-20d78a58-13f3-471d-959e-5df2039608df`. Stdout/stderr только в private `.playwright-mcp/modernization/local20-smoke-agent-20261002.private.log`; в диалог выведены только whitelist status/counts/revision/cleanup.

Final authoritative cleanup: fixture `CLEANED`, `originalData=MATCH`, `storage=EXACT_OWN_KEYS_ABSENT`; session preferences `RESTORED`. Удаление шло только через compiled existing app UI/ConfirmDelete по signed exactIDs, затем physicalkeyabsence локальным ENOENT и exact signed own-data restoration. GuardSTOP не возник. Это local функциональный receipt на указанной compiled ревизии, не staging/production/all-plan visual proof.
