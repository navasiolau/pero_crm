# Проверки №215

Code candidate `43a9ec138777ddbb664927670fa958330bb352bb`, обычные merges принятого #214 через staging сохранены. Root ведёт выпуск только до staging по прямому разрешению владельца от 11.11.2026.

## Local and review

- TypeScript, ESLint и production Next build — PASS; 0 lint errors, 4 прежних warnings вне задачи.
- Web без отдельно выполненного KP browser suite: **1394/1394**; KP browser **16/16**; template package **52/52**; targeted backend **31/31**; runtime target guards **13/13**; renderer streaming **4/4**.
- Полный KP suite выполнен без временных aliases/bridge. Через isolated worker все четыре страницы historical PDF и DPR2 изображения приложений pixel-identical. Structured continuation PDF: 8 A4, все 80 строк и 12 дополнительных разделов без потерь/повторов, 13 полных длинных кодов и один общий итог.
- Независимое ревью GPT 6.1 SOL: исправлены сопоставление legacy custom после удаления соседнего блока и обрезка длинных характеристик. Финальный source GO; неоднозначный старый draft сохраняется до явного немодального переноса.
- Реальная local БД 5433: транзакционные CAS/replay/legacy/source-generation/ABA/rollback проверки — PASS. Compiled UI на loopback: legacy→canonical autosave, custom и группа, пустой раздел, новая позиция, обе раскладки, очистка [] без возврата legacy, actual OpenAPI POST/PUT schemas — PASS.
- Local browser исправлялся только как harness: переключатель раскладки нажимается через видимую подпись, а не скрытый checkbox. Тестовые проекты/КП скрыты по точным receipts, own web остановлен. Local zero-media binding не выполняет S3 I/O; полный HTTP PDF release проверяется отдельно на staging.

Приватные evidence: `.playwright-mcp/specifications-root/`, `apps/web/test-results/kp-editor/4c987d58-a7f7-4107-81d1-51ba2a2db353/`, общий harness в worktree #214, local run `98d4b5eb-14be-4fc7-939c-8fc6333ddfbd`.

## Agent interfaces

- MCP Node **17/17**, Python **5/5**, skill validator PASS; постоянный parity test сравнивает схему и примеры с общим каталогом. Capability preflight читает реальный OpenAPI целевого сервера, старый сервер не получает specs-only write.
- Точечно обновлены 8 файлов установленного навыка и только `E:/KP/AGENTS.md`, `E:/KP/INSTRUKCIYA.md`. Сохранены owner-дополнения по вложениям дизайн-проекта, POST/PATCH клиентов, DOCX/ценам, изображениям/промптам и запрету печатать ставки услуг.
- Installed validator, Node syntax ×3, Python compile, installed compatibility tests **3/3**, mocked GET-only capabilities и CLI help — PASS. Backup/diff/SHA manifest: `.playwright-mcp/skill215-sync-20261111T012904Z-5ce1d10d/manifest.json`. Реальных запросов к production и изменений других навыков не было.

## Staging

**Принят staging `517eb5632cd91ac243245f700bcf26453a103c4b`.** [CI 42939664271](https://github.com/navasiolau/pero_crm/actions/runs/42939664271): **7/7 success**, включая обе browser cohorts, backend, native/PostgreSQL, Linux renderer и публикацию испытанных OCI без пересборки.

- Фактический web image `sha256:9a818ecde4b95dc0c6990d196ccc60e7d1d5b712c04608430d68ec216e7a5075`, renderer `sha256:c07795bdd080bd73e55dc785df734e07b454ccf27f67b24547c7d66bbd422ce5` совпадают с promoted CI digests. Guard до/после приёмки подтвердил эту revision, healthy и прежние DB ID/volume/StartedAt, неизменный W07.
- Первая загрузка образа завершилась `pull-failed`, оставив здоровую #214. Штатный повтор watcher успешно развернул #215; конфигурации и защитные проверки не менялись, ручной обход CI не применялся.
- Root выполнил full browser сценарий через настоящий HTTPS: actual OpenAPI, открытие legacy без записи, canonical autosave, стандартный/custom раздел и его группа, пустые пункты, новая позиция и обе раскладки, повторное открытие, desktop/mobile, явная очистка [] без возврата старых products — PASS.
- Через штатную кнопку выпущен и скачан настоящий PDF: **6 A4, 441359 bytes**. Все **80 строк** присутствуют ровно один раз и по порядку, custom раздел один раз, пустой фасад скрыт. Root просмотрел все шесть растровых страниц и реальные editor/preview снимки. Проверка геометрии подтвердила запас 44,37 pt под ценой; обрезки нет.
- Actual readback подтверждает исходный description побайтово с CRLF, пустой JSON первой позиции после очистки и все длинные строки второй позиции в Product. Выпущенная версия 5 неизменна; фактическое восстановление этой версии повысило live revision до 7 и восстановило структуру, повтор того же operationId не дал второй записи. Устаревший legacy PUT получил `409 KP_EDITOR_OUTDATED` без повышения revision.
- Оба QA проекта и КП UUID `6bfdcadd-2781-40b3-9a21-f927eb33d224` скрыты по exact receipts, история и PDF сохранены. Final health — HTTP 200/database ok. Local own service fixture удалена только по её ID после проверки отсутствия ссылок; local PostgreSQL возвращён в исходное stopped при отсутствии чужих соединений.
- Main/production не выпускались: remote main `30473e7f8bca76e843f1ec34580bcb5ca7133f5b`. Отчёт приёмки записан после deployment в feature/215; код staging остаётся на указанном проверенном SHA.

Приватные evidence: `.playwright-mcp/specifications-root/ci215.json`, `stage215-prepare/inspect/final-inspect/hide.*.private.json`, `stage215-6bfdcadd-2781-40b3-9a21-f927eb33d224/browser-215-1794361658211-8191166b/` (PDF, text verification, 6 PNG, screenshots), `version-verification.json`, `staging-final-health.json`, `local-cleanup.json`. Секреты/cookies не коммитятся.
