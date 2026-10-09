# Design

## Context

См. proposal.md. В базе FileCategory, FileStage и caption; UI изделия группирует категорию MEASUREMENT раньше stage, объединяет ASSEMBLY с PRODUCTION, а проект показывает плоский список. Upload использует эти поля в fingerprint, cover cores пишут PHOTO, file-stages включается через registry и проверяет расширения.

## Goals / Non-Goals

**Goals:** единый раздел размещения, полное сохранение File rows/объектов/FK, отсутствие категориальных форм и проверок при сохранении остальных upload guards.

**Non-Goals:** строки файлов, кнопка печати, thumbnail crop (задачи 114–116), изменение ролей/складских/финансовых записей, инфраструктура, история прежних миграций и ChangeLog.

## Decisions

- FileSection с default GENERAL и индексом projectId/section заменяет оба enum и три колонки. Явное поле формы section задаётся компонентом размещения, default GENERAL допускается для общего uploader; chooser отсутствует.
- Миграция преобразует ВСЕ rows: category MEASUREMENT; затем productId IS NULL; затем INSTALLATION; иначе PRODUCTION. taskId не отменяет раздел существующего изделия. Новый task GENERAL с productId показывается в документах производства, чтобы файлы не исчезали.
- Current cover/sketch исключается во всех секциях документов/замера; replacement сохраняет прежний row в его секции. Cover uploads сохраняются как PRODUCTION изделия или GENERAL проекта. File IDs, storedName, hasThumb, legacy IDs, FKs и содержимое не меняются.
- Старые поля multipart отклоняются с кодом UPLOAD_FORM_OUTDATED и 422 до bytes/storage/DB. Section валидируется по enum; replay fingerprint включает section. Отдельные cover fingerprints и CAS сохраняются.
- file-stages снимается только из runtime registry/dependencies/transpile и списка настроек. Его прежние записи Plugin/PluginSetting/PluginRunLog сохраняются для истории; прямой route настройки не работает без manifest. Исторические package source/миграции/ChangeLog не переписываются.

## Risks / Trade-offs

- Drop колонок несовместим со старой Prisma-моделью → root координирует момент migration и замены web image; запрещено применять drop, пока старый web принимает запросы. Существующий watcher заменяет контейнер, но это само по себе не гарантирует безопасный момент DB deploy. Никаких самостоятельных изменений watcher/infra в этой задаче.
- Старые upload receipts с fingerprint category/stage → старые формы fail-closed 422; новые clientMutationId создаются после обновления. Исторические receipts не переписываются.
- Прежние подписи удаляются по явному требованию владельца → обратный запуск старого приложения требует временного production migration dump и проверенного isolated restore по AGENTS; без dump local/staging, no restic.

## Migration Plan

1. На существующем разрешённом PostgreSQL root запускает guarded transaction rollback rehearsal: фактический DDL/mapping, все File rows/FKs/storage key fingerprints и schema rollback. Параллельные shared DB миграции не запускаются.
2. Контролируемая замена приложения и db:migrate/db:deploy выполняется root только после проверки revision и отсутствия активного старого web. Транзакционная миграция либо сохраняет все данные, либо откатывает DDL.
3. Local/staging после деплоя: проверка sections, текущих эскизов, старых вложений, загрузки и replay на фактически развёрнутой ревизии. Дампы local/staging не создаются.
4. Production не разрешена текущей задаче. Если разрешат production migration, применяется отдельный процесс временного dump+isolated restore, затем точное удаление temporary dump после acceptance.
