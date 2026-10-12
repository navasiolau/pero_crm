# Proposal

## Why

В поддерживаемом source остаются отключённые нефинансовые UI-цепочки: рабочие entry points их не используют, но исходники и отдельные тесты продолжают сопровождаться. Их ограниченное удаление должно сохранить действующие карточки, контакты, файлы, исторические данные и внешний вид.

## What Changes

- Задача155 зависит от159 и160; implementation разрешается только после приёмки160 на staging и отдельного ROOT_RELEASE. feature/155 создана после fresh fetch от origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929.
- Удалить ровно девять подтверждённых source files: Drawer, Breadcrumb, SurveyorLink, FileImageThumbnail, inline-phone-dependency, warehouse-input, HistoryTab, CommunicationsTab и единственный addCommunication module.
- Разорвать только закрытую цепочку CommunicationsTab→addCommunication, которая целиком входит в allowlist; не удалять Communication/history модели, строки, миграции или исторический getProjectFor reader.
- Удалить три orphan inline-phone-dependency blocks и только obsolete thumbnail block/import из mixed file-image-thumbnail test; живой FileGridView block и его setup сохранить дословно.
- Сохранить все пять current contact-controller blocks, warehouse contracts/validators и действующие FileViewer/FileList/card/navigation tests; после implementation подтвердить local и actual staging-приёмкой.

## Capabilities

### New Capabilities

Нет. skip_specs: true — удаляется только подтверждённо отключённый код без нового поведения.

### Modified Capabilities

Нет. Действующие требования к доступу, данным, контактам и файлам сохраняются.

## Impact

- Exact scope: девять source deletion, один orphan test-file deletion и один mixed test edit; всего11 source/test paths. Block classification, source hashes и protected exclusions находятся в design.md/census.json.
- Actual baseline подтверждён:781 physical LOC /30776 UTF-8 bytes. Вне allowlist нет найденных production/type-only/dynamic/plugin/bot consumers; обнаружены два test imports и один внутренний closed-chain import. Исходные test blocks отдельно классифицированы, целые mixed suites не удаляются.
- Source LOC не равен экономии executed JavaScript. Production chunks/CSS ещё NOT_MEASURED; их сравнение и визуальная приёмка — последующие обязательные стадии, не результат readonly census.
- Planning сейчас не меняет source, schema, зависимости или окружения. Install/typing/Node actions/DB/browser/deletion/commit NOT_RUN. Работа153/156 и чужие изменения сохраняются; main/production запрещены.
