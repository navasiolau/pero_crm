# Tasks

## 1. Доступ к файлам на сервере

- [x] 1.1 Добавить в server/access/visibility.ts для WORKER/MOUNTER ветку чтения файлов изделий со статусом != DESIGN рядом с productVisibilityWhere:179 и комментарием про ненаследование File-доступа, и проверить что эскиз, hasB3d, _count.files и файлы задач покрываются тем же fileVisibilityWhere; verify: `pnpm --filter @pero/web test` по visibility-тестам зелёный и ручной разбор matches() для DESIGN/PRODUCTION
- [x] 1.2 Убедиться что НЕ изменены upload-context.ts, delete-permission.ts, cover-core.ts, canEdit/canReplaceProductCover и maskProductionRead; verify: `git diff --stat` показывает только visibility.ts и артефакты change

## 2. Проверки и свидетельства

- [x] 2.1 Прогнать pnpm lint и pnpm --filter @pero/web test, сохранить результаты в evidence.md; verify: обе команды завершены без новых ошибок
- [x] 2.2 Описать в evidence.md ручные кейсы: цех видит замер+эскиз+документы чужого назначенного изделия в PRODUCTION, DESIGN не видит, скачивание /api/files/:id отдаёт 200 вместо 404; verify: evidence.md содержит все три кейса
