# Context

finance/logistics storage.ts повторяют path containment, realpath родителей, atomic pending write и read-size проверку. Оба read HTTP уже используют privateFileHeaders129. Root явно разрешил151 source implementation до140, API согласован с financial owner.

# Decisions

document-storage.ts содержит только filesystem/stream primitives. validateStorage и FINANCE/LOGISTICS UploadError/path codes остаются явными адаптерами. Старые Buffer put/open interfaces и S3 calls сохраняются.

FileContentSource структурно совместим с139 UploadSpoolFile: size, contentHash, openRead. Atomic local stream write считает bytes/SHA, закрывает собственный wx handle до rename и удаляет только собственный pending. Не включает MIME, keys, auth, reservation или workflow.140 может использовать свой структурный тип до normal dependency merge151.

Private headers/PDF/attachment политика129 уже общая; HTTP151 не меняется. Backend extraction не объявляется уменьшением browser JS.

# Verification

Параметризованные реальные temp-files checks обоих adapters: local/S3 boundaries, outside-root/symlink, missing/partial, exact retry bytes и pending failure. Existing domain core/HTTP regressions и private-response129 проверяют права/lifecycle/view headers. Без нового QA runner/framework/DB fixtures/dumps; actual stage принимает Root после normal merges.