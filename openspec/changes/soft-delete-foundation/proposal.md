# Why
Физическое удаление проекта/изделия угрожает сохранённым файлам, номерам и финансовым фактам. №54 создаёт общую основу logical delete до отдельных действий №55/56.

# What Changes
- Nullable deletedAt/deletedById на Project и Product, без изменения существующих строк.
- Общие live filters и mutation guards: удалённое изделие и удалённый родитель недоступны рабочим запросам и изменениям.
- Finance/history/number allocation сохраняют исходные строки и снимки.
- Кнопки и операции soft delete будут отдельными №55/56.

# Capabilities
## New Capabilities
- `soft-delete-foundation`: сохранение данных и исключение удалённых сущностей из рабочих каналов.
## Modified Capabilities

# Impact
Prisma additive migration, access/queries, operational API и mutation validation. Без удаления файлов, выплат, начислений, резервов и таймеров; без DB execution.
