# Evidence

## Scope and baseline

Задача №17, feature/17 от fresh origin/staging44281e4f229a9d655b70f0f73151413af66296f8 после фактической приёмки №16. Изменение — частичные правки изделия и общих Project/Client реквизитов, общий field controller, closed DTO, CAS/receipt, thin Server Actions. Layout проекта/новые проценты/вложения/description whitespace/initialPrice правила следующих задач не реализуются этим change. Production/main не изменяются.

## Local verification — 02.10.2026

- Web unit: 635/635 PASS; bot12/12 PASS. Финальные production build/typecheck PASS, lint0errors (один прежний cleanup-uploads.ts warning).
- Domain RED→GREEN: исходные CAS/receipt4fail→9pass; controller7fail→11pass; sharedcontact/legacyproject compatibility3fail→14pass; await-invalidation1fail→2pass; malformed envelope TypeError→14pass domain/action suites.
- Реальный PostgreSQL native9groups PASS; outer rollback и fingerprint16таблиц подтвердили точную сохранность исходных записей. Все вспомогательные actors/works/materials существовали только внутри rollback. Реальные Prisma/Zod/SQL savepoints; только внешняя доставка уведомлений/плагинов и cache invalidation явно stubbed в native контуре.
- Последний native receipt: .playwright-mcp/modernization/local-inline-native-d1f530e1-d1bf-4acf-9cc2-535ffd246276/native-receipt.json. В него включены actual SQL profile title/phone: только scalar/access/CAS/audit/outbox таблицы; никаких history/tasks/files/payment/payroll/stock/экономических чтений, externalfetch0. Query params/секреты не записываются.
- Compiled production browser75checks PASS, failures0. Два разрешённых actors в независимых contexts: Enter+blur/no-op, медленный ответ и новый draft, параллельное соседнее поле, same-field conflict/rebase, разные поля, invalid/zero/null, потерянный ответ после фактического commit и replay того же UUID, смена клиента/телефона, price/quantity flush до статуса, hidden dirty percentage guard, assigned ENGINEER DESIGN.
- Browser receipt: .playwright-mcp/modernization/local-inline-browser-34fd1cef-30e9-43f1-888f-f8f738171683/browser-receipt.json. ADMIN/MANAGER/MANAGER+ENGINEER/ENGINEER, шесть размеров320×800/360×800/390×844/768×1024/1024×768/1440×900; sidebar open/closed и29промежуточных ширин320…1440. Geometry проверена, изображения лично просмотрены оркестратором.
- Реальный Chrome tabs.setZoom/getZoom200%: innerWidth1424→712, DPR1→2, CSSzoom1; horizontaloverflow отсутствует, ошибка количества видна. Финальный повтор5checks PASS: .playwright-mcp/modernization/local-inline-zoom-06e21611-5fd6-45af-a219-b713683657cf/browser-receipt.json. Нативные viewport-снимки1424физических пикселя лично просмотрены; zoom и неизменная геометрия проверены после каждого кадра. Изолированный временный профиль удалён по проверенному точному пути.
- QA business fixtures2Client/1Project/2Product и точные собственные audit/event/status/notification IDs удалены после signed observation; original fingerprint всех моделей совпал. Preferences восстановлены exact HMAC/CAS; frozen/финансовые записи не создавались и не удалялись. Restic/дампы/reset/seed не использовались.

## Architecture and compatibility mapping

products/actions.ts → products/core.ts/patch-contract.ts → quantity-core/status-core. Обычный patch не вызывает invalidation/refresh; отдельные create/delete/status ожидают завершения профильной invalidation до ответа. Два соседних поля используют независимые same-origin POST того же registered Server Action через установленный Next15.5.20 Flight codec, без дополнительной библиотеки/API/Prisma writer. Compact envelope проверяется в unit и actual HTTP/RSC evidence.

Shared contacts: projects/contact-core.ts → clients/core.ts, Project→Client locks/expectedClientId; product receipt атомарен с contact audit/outbox. Старый product full update без baseline отклоняется; старая Project форма и адресный bot dialog используют реальный captured contactBaseline и пропускают неизменённые контакты. Client CRUD — MANAGER_ROLES с union совмещённых ролей. DRAFT preview обновляется из confirmed price/engineer; frozen totals/snapshots остаются прежними.

Malformed DTO/unauth payload возвращает typed validation до domain transaction, не придумывает field/baseline/UUID и не раскрывает чужие данные. Права проверяются до replay/conflict; current role/status/assigned engineer подтверждаются в native/unit матрице.

## Staging acceptance

Ожидается после ordinary merge и фактического deployment. Push/build/source SHA сами по себе не означают приёмку. Оркестратор сверяет OCI revision/image/health, W07/DB identity, затем выполняет native/browser/roles/truezoom на точной развёрнутой ревизии и добавляет результат здесь.
