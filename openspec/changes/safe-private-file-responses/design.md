# Design

## Context

См. proposal.md. Основа — `3819f17`, рабочая ветка `bugfix/129`. В текущем UI legacy `thumb=1` уже не используется; действуют `preview=thumbnail/card/cover`. Существующий image-preview service проверяет ACL вне cache, ограничивает источник 25 МиБ и 64 млн пикселей, число задач и cache, декодирует Sharp и возвращает WebP. Finance/logistics read-adapters уже имеют одинаковый raster allowlist, nosniff и sandbox.

## Goals / Non-Goals

**Goals:** переиспользовать существующий проверенный декодер, закрыть legacy fallback, привести успешные file responses к одной явно ограниченной политике заголовков.

**Non-Goals:** upload streaming 139/140, общий filesystem/storage слой 151, удаления 137/138, queue135, новые зависимости, DB/migrations, редизайн и изменение авторизации.

## Decisions

1. Legacy `thumb=1` становится алиасом `preview=thumbnail`, с той же ACL, лимитами и условным ETag. Исторический `hasThumb` и JPEG объект не определяют безопасность ответа. Альтернатива — доверять одному `hasThumb` — не проверяет реальные байты; отдельный Sharp путь дублировал бы готовый bounded сервис. Оригиналы и старые keys сохраняются в storage.
2. Новый `server/files/private-response.ts` формирует только MIME/disposition/private headers. Inline grant дополнительно проверяет общий raster/PDF allowlist; доменный adapter явно задаёт, разрешён ли inline в этом запросе. Обычный оригинал остаётся attachment, PDFview включается явно; finance/logistics сохраняют действующий raster inline. Helper не читает auth, БД или storage.
3. Image-preview service использует тот же helper для успешных 200/304 с прежними cache/Vary/ETag. HTTP document-adapters используют helper только в read-части; upload и lifecycle остаются отдельными задачами.
4. Реальный GET проверяется через существующий relational fixture adapter и подставной S3 stream, с инертным HTML/SVG, декодируемым raster и повреждёнными байтами. Смешанный engineer-access test получает настоящую малую PNG fixture вместо текстовой заглушки, чтобы продолжить доказывать разрешённый PRODUCTION thumb. Удаление полезных ACL/PDF/cache проверок запрещено.

## Risks / Trade-offs

- [Legacy thumb теперь перекодирует оригинал] → готовые singleflight/cache/лимиты сохраняются; актуальный UI использует тот же сервис. Входы unsupported/invalid fail closed.
- [CSP sandbox влияет на встроенный PDF/печать] → finance PDF уже использует этот sandbox; независимая browser-проверка обычного PDF просмотра/печати обязательна до staging acceptance.
- [DI не доказывает реальное browser/runtime поведение] → local handler/adapter матрица дополняется существующей browser-проверкой и реальной staging карточкой, хешом исходного download и совпадением deployed SHA.
- [Случайные реальные storage side effects] → тесты не создают клиент БД и используют только in-memory streams; stage чтение чужого файла обязательно останавливается до storage. Никакого purge/cleanup/reset/seed/dump.

## Migration Plan

Миграций нет. После targeted local tests, lint/typecheck и независимого review ветка вливается обычным merge в staging оркестратором. Принять фактический SHA/образ, health, raster thumbnail/fullscreen, PDFview/печать, download hash и deny ACL. При регрессии возвращается совместимый образ приложения либо исправляется эта ветка. Main и production не затрагиваются.