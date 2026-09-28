# Engineering fund UI evidence (2026-09-28)

Owned files: `apps/web/src/components/engineering-fund.tsx`, `apps/web/src/lib/request-id.ts`, and `apps/web/tests/product-engineering-fund-ui.test.ts`.

- TDD: the new SSR/mapping test failed before the component existed; the explicit empty-mapping assertion exposed and fixed the enable-fund path for products with no works.
- `pnpm exec tsx --test tests/product-engineering-fund-ui.test.ts`: 8 passed. Tests render the summary for unset/zero/settled/legacy states, render the full component under a router stub for read-only gates and separate physical/financial labels, verify exact 100% mapping with zero and no inferred shares for multi-task conversion, and cover two-decimal rate validation, canonical conversion idempotency keys and the cryptographic HTTP-LAN UUID fallback.
- `pnpm exec eslint src/components/engineering-fund.tsx src/lib/request-id.ts tests/product-engineering-fund-ui.test.ts`: passed without warnings.
- No browser, database, migration, deployment, or hosted visual check was run. The markup includes `min-h-12` touch targets and `min-w-0` wrapping; responsive layout still needs the root agent's separately authorized visual QA at 360/390 px.

UI behavior: management in DESIGN can enable/configure the DRAFT pool, submit complete Work and Task financial mappings, create a Work with its first Task of type «Проектирование», and convert an eligible unpaid Work with explicit task mapping. The conversion request UUID remains stable for the exact canonical payload and changes after edits; the close UUID remains stable across retry. UUID generation uses Web Crypto random bytes when `randomUUID` is unavailable on HTTP LAN. A synchronous ref blocks duplicate create clicks while a request is pending. A separate confirmation dialog reviews the preliminary amount/date/weights before close. The settled and legacy-protected views expose no editing actions, and no legacy individual amount is invented.
