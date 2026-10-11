# Resolved test dispositions — 156

Эти две записи описывают уже удалённые blocks, а не действующие test files. Активная карта содержит только существующие paths; validator159 остаётся строгим и неизменным.

- Baseline карты: `3819f175dca3f69f40da92760cf746bad430f4bc`; accepted parent перед удалением: `d121f0798e963f32d13f52c9bde57c0aa82b7929`.
- Retirement commit: `2a3e91ffb663e42f1cf8fecd90a2248647356d1f`. Source baseline/raw V8 и corrected report3819 не пересчитываются.
- Исторические Git blobs: inline-percentage-projection.test.ts `ba3b8eb4131902b0c5b5cd682fc3203d93d3bbd8`; product-engineering-fund-ui.test.ts `6dbaf008c8f50f5fed1747ecf9fbfab517f56c8d`.

## Archived RETIRE rows

```json
[
  {
    "file": "apps/web/tests/inline-percentage-projection.test.ts",
    "block": "orphan helper projection",
    "decision": "RETIRE",
    "task": 156,
    "reason": "Только после переноса null/zero/dirty/frozen/ACK на актуальный controller/UI.",
    "remainingProtection": [
      "apps/web/tests/product-percentage-rate-adjust.test.ts"
    ]
  },
  {
    "file": "apps/web/tests/product-engineering-fund-ui.test.ts",
    "block": "SSR old fund/helper blocks16–55",
    "decision": "RETIRE",
    "task": 156,
    "reason": "Orphan UI только после проверки graph/compatibility; historic reader/facts не удаляются.",
    "remainingProtection": [
      "apps/web/tests/product-engineering-legacy.test.ts",
      "apps/web/tests/work-shares-settlement.test.ts"
    ]
  }
]
```

## Live UUID mapping

Прежний KEEP block из product-engineering-fund-ui.test.ts находится в apps/web/tests/request-id.test.ts. Полное test name: request id falls back to cryptographic random bytes when randomUUID is unavailable; body AST SHA0e048375cc22dd78f4f66f510470f2275f7635e888c9d5c8c1c46f1281c1c2e3 сохранён original156. Оба живых mixed-query blocks inline-engineer-fallback остаются в active map.

Числа текущих контрактов/targets и CI entry не меняются; retired record не является новым runtime/native PASS. Подробная классификация10blocks и remaining protection сохранены в design.md/evidence.md.
