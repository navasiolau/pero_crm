# Why
Работник не видит производство без назначенной задачи, поэтому не может ознакомиться с текущими изделиями. №67 открывает только производственный просмотр перед отдельными задачами68/69.
# What Changes
- WORKER получает общий readonly Product PRODUCTION и родительский Project независимо от Task.
- Pure MOUNTER не получает общий grant; остальные роли сохраняют union.
- Раздел Изделия виден WORKER, фильтры и прямые URL используют одну политику.
- Файлы, task execution, technical/status edits, finance/payroll и upload сохраняют прежние права.
# Capabilities
## New Capabilities
- `production-worker-product-access`: безопасный производственный просмотр без назначения задачи.
## Modified Capabilities
# Impact
Central visibility, Products sidebar row и focused query/direct-file/upload tests. Active actor проверяется existing auth/API resolve; soft-delete54 wrappers сохраняются при обычном merge.
