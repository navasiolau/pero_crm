# Evidence

## Scope and baseline

Задача №17, feature/17 от fresh origin/staging44281e4f229a9d655b70f0f73151413af66296f8 после фактической приёмки №16. Изменение — частичные правки изделия и общих Project/Client реквизитов, общий field controller, closed DTO, CAS/receipt, thin Server Actions. Layout проекта/новые проценты/вложения/description whitespace/initialPrice правила следующих задач не реализуются этим change. Production/main не изменяются.

## Local verification — 02.10.2026

- Web unit: 637/637 PASS; bot12/12 PASS. Финальные production build/typecheck PASS, lint0errors (один прежний cleanup-uploads.ts warning).
- Domain RED→GREEN: исходные CAS/receipt4fail→9pass; controller7fail→11pass; sharedcontact/legacyproject compatibility3fail→14pass; await-invalidation1fail→2pass; malformed envelope TypeError→14pass domain/action suites.
- Реальный PostgreSQL native9groups PASS; outer rollback и fingerprint16таблиц подтвердили точную сохранность исходных записей. Все вспомогательные actors/works/materials существовали только внутри rollback. Реальные Prisma/Zod/SQL savepoints; только внешняя доставка уведомлений/плагинов и cache invalidation явно stubbed в native контуре.
- Последний native receipt: .playwright-mcp/modernization/local-inline-native-d1f530e1-d1bf-4acf-9cc2-535ffd246276/native-receipt.json. В него включены actual SQL profile title/phone: только scalar/access/CAS/audit/outbox таблицы; никаких history/tasks/files/payment/payroll/stock/экономических чтений, externalfetch0. Query params/секреты не записываются.
- Compiled production browser75checks PASS, failures0. Два разрешённых actors в независимых contexts: Enter+blur/no-op, медленный ответ и новый draft, параллельное соседнее поле, same-field conflict/rebase, разные поля, invalid/zero/null, потерянный ответ после фактического commit и replay того же UUID, смена клиента/телефона, price/quantity flush до статуса, hidden dirty percentage guard, assigned ENGINEER DESIGN.
- После уточнения server fallback инженерного черновика финальный compiled browser76checks PASS: .playwright-mcp/modernization/local-inline-browser-60cfc6e3-8813-4399-a41a-2a2e6da8c871/browser-receipt.json. Новый сценарий меняет инженера на другого активного, проверяет подтверждённого получателя pristine DRAFT и возвращает прежнего. Query DTO hasConfiguration отличает подсказку от реально сохранённой конфигурации, в том числе revision0; dirty и frozen составы не меняются. RED2/2→GREEN36/36 профильных тестов, дополнительных SQL чтений нет.
- Browser receipt: .playwright-mcp/modernization/local-inline-browser-34fd1cef-30e9-43f1-888f-f8f738171683/browser-receipt.json. ADMIN/MANAGER/MANAGER+ENGINEER/ENGINEER, шесть размеров320×800/360×800/390×844/768×1024/1024×768/1440×900; sidebar open/closed и29промежуточных ширин320…1440. Geometry проверена, изображения лично просмотрены оркестратором.
- Реальный Chrome tabs.setZoom/getZoom200%: innerWidth1424→712, DPR1→2, CSSzoom1; horizontaloverflow отсутствует, ошибка количества видна. Финальный повтор5checks PASS: .playwright-mcp/modernization/local-inline-zoom-06e21611-5fd6-45af-a219-b713683657cf/browser-receipt.json. Нативные viewport-снимки1424физических пикселя лично просмотрены; zoom и неизменная геометрия проверены после каждого кадра. Изолированный временный профиль удалён по проверенному точному пути.
- QA business fixtures2Client/1Project/2Product и точные собственные audit/event/status/notification IDs удалены после signed observation; original fingerprint всех моделей совпал. Preferences восстановлены exact HMAC/CAS; frozen/финансовые записи не создавались и не удалялись. Restic/дампы/reset/seed не использовались.

## Architecture and compatibility mapping

products/actions.ts → products/core.ts/patch-contract.ts → quantity-core/status-core. Обычный patch не вызывает invalidation/refresh; отдельные create/delete/status ожидают завершения профильной invalidation до ответа. Два соседних поля используют независимые same-origin POST того же registered Server Action через установленный Next15.5.20 Flight codec, без дополнительной библиотеки/API/Prisma writer. Compact envelope проверяется в unit и actual HTTP/RSC evidence.

Shared contacts: projects/contact-core.ts → clients/core.ts, Project→Client locks/expectedClientId; product receipt атомарен с contact audit/outbox. Старый product full update без baseline отклоняется; старая Project форма и адресный bot dialog используют реальный captured contactBaseline и пропускают неизменённые контакты. Client CRUD — MANAGER_ROLES с union совмещённых ролей. DRAFT preview обновляется из confirmed price/engineer; frozen totals/snapshots остаются прежними.

Malformed DTO/unauth payload возвращает typed validation до domain transaction, не придумывает field/baseline/UUID и не раскрывает чужие данные. Права проверяются до replay/conflict; current role/status/assigned engineer подтверждаются в native/unit матрице.

## Staging acceptance

Первый merge7eb10ae19c4c69f6d93d725dc5b15668d52b89fb фактически развёрнут: web16fdba69014ca3072635a8d4453effe32ec5acd6f81e7eebe44a4bca47b0c735, image sha256:0bd5dd0399205cc99ba3e2ff97a66867ef6da58a562e9e4cfc93f91f886e75c7, healthy. Hosted native9groups PASS, rollback verified, receipt .playwright-mcp/modernization/staging-inline-native-4a762b12-632b-4244-9dbd-37c230d7e210/native-receipt.json. DB/container/start/mount и W07 исходный SHA сохранены. После следующего scoped fix default-engineer projection требуется приёмка новой фактической staging-ревизии; полного принятия №17 пока нет.
