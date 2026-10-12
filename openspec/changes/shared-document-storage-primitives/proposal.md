# Why

Утверждённая задача151 устраняет одинаковые containment/realpath, pending→atomic rename и open/size реализации finance/logistics. Ключи документов, ACL и PENDING→READY остаются в доменах.

# What Changes

- Общие document-storage primitives вместо двух локальных реализаций.
- Нейтральный FileContentSource (size/contentHash/openRead) для совместимости140; локальная потоковая запись проверяет SHA/размер и не заменяет оригинал до полного завершения.
- Существующий private-response129 уже используется обоими HTTP readers; дополнительный response/HTTP framework не нужен.

# Capabilities

## New Capabilities

- shared-document-storage-primitives: единые безопасные filesystem функции документов.

# Impact

feature151 от fresh origin/staging16ed. Ownership: общий module и два storage adapters. HTTP/core/services140 у financial owner; S3 stream forwarding после normal139/140 integration, без копирования feature файлов. Schema/БД/старые storage keys/ACL не меняются.