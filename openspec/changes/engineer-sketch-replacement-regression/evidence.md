# Evidence

08.10.2026, задача112, ветка `bugfix/112`, базовый staging `20a049b2`.

- Прослежен полный путь `ProductCoverLayout → PhotoUploadButton → sketchUploadForm → POST /api/files/upload → authorizeProductCoverUpload → resolveUploadContext → persistUploadedProductCover`.
- Назначенный инженер и ENGINEERING-участник допускаются только на DESIGN. Кнопка замены не зависит от `canDeleteCover`; old file author/legacy null не ограничивает замену. Старые вложения не удаляются.
- Исходные focused тесты:54 PASS,0 FAIL. Новый POST regression с синхронизированным storage boundary и последовательным моделированием Product row lock:13 PASS,1 FAIL; две повторные физические загрузки остаются, `deletes=0` при требуемом2.
- Минимальный functional diff: repeated upload компенсирует только свои randomUUID storage keys; org notify выполняется только для первого success. После fix:56 PASS,0 FAIL (те же54 и2 новых). Новые QA guard/bundle tests:5 PASS,0 FAIL. Эти controlled boundary проверки не являются real PostgreSQL/S3/staging evidence.
- Локальный TypeScript `tsc --noEmit --incremental false`:PASS. OpenSpec strict:PASS. Targeted ESLint проверяется без ошибок и предупреждений; точный итог после финализации harness записывается ниже.
- Own pnpm offline/frozen install и Prisma generate завершились в отдельном worktree, без подключения к БД. Отсутствуют migrations, ACL/публичные API изменения, commit/push/merge, restic или дампы.
- Task-specific compiled-runtime harness собран без execution. Результат dry build и его SHA сохраняются приватно в `apps/web/test-results`; actual staging2.2 и cleanup2.3 остаются открыты до root-reviewed запуска на фактически развёрнутом task112 SHA.

Итог финальной локальной версии:61 focused PASS (56 functional/POST/UI +5 QA guards/bundle),0 FAIL; повторный TSC PASS; targeted ESLint0errors0warnings; `git diff --check` PASS; strict OpenSpec PASS. Dry bundle17137B, SHA256 `826a0e6642c979f40ef661e3bfe247d1e7d9949f74d6dea568c090e1688c6ce1`. Root-reviewed execute БД/HTTP/S3 не выполнялся. Независимый functional review координатора сообщил actionable findings NONE.
