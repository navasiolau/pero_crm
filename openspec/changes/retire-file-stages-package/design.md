# Design

## Context

См. `proposal.md`. Действующий registry импортирует только demo. Package file-stages не имеет production-потребителя; единственная активная зависимость от его TS-файла — source pin в QA runner. Проверки enabled Plugin выполняются перед созданием fixtures и снова перед фазами существующего жизненного цикла.

## Goals / Non-Goals

**Goals:** убрать зависимость от retired source, проверяя фактический registry при той же revision и сохраняя отказ до эффектов.

**Non-Goals:** не менять приложение, registry/demo/SDK, исторические Plugin rows, настройки, файлы, финансовые данные или физическую QA-цель. Новый registry framework и общий аудит исходников не нужны.

## Decisions

1. Fixtures импортируют настоящий `getManifest` приложения. Известная историческая metadata `file-stages` 0.1.0 / API 1 разрешается только при `getManifest(id) === undefined` и совпавшей revision политики. Любой зарегистрированный enabled manifest и любой неизвестный ID/версия/API приводят к STOP. Переданные вызывающим кодом списки manifest и старый sourceHash не являются доказательством.
2. Существующий `noHookPolicy` сохраняет поля `revision` и `plugins`, но список содержит только retired metadata без sourceHash. Политика по-прежнему входит в подписанный PRE и сравнивается перед подготовкой. Старые QA metadata не продолжают изменённый жизненный цикл: прежний source CAS отклоняет новые bytes.
3. Runner вместо file-stages pin читает registry, demo manifest, SDK и их package entry metadata. Esbuild компилирует эти настоящие модули. Только три ленивых UI slot imports demo остаются external, поскольку guard не вызывает slots; hooks/commands/manifest остаются в bundle.
4. Положительные и отрицательные проверки расширяют существующий тест policy. Временное добавление manifest в настоящий registry только внутри процесса теста подтверждает отказ при новом активном hook; `finally` восстанавливает registry. Проверка считает эффекты после preflight и требует ноль для отказов.
5. Удаление выполняется по точному списку четырёх package-файлов после проверки абсолютных путей и reparse points. Lockfile теряет только importer отключённого package; glob `packages/plugins/*` сохраняется для demo. Физические TS-строки измеряются по HEAD до удаления.

## Risks / Trade-offs

- Реестр может получить новый плагин → actual `getManifest` и pinned source останавливают неизвестный enabled-контур до эффектов; фикстура с зарегистрированным hook проверяет этот отказ.
- Bundle может случайно потянуть UI → external ограничен тремя точными lazy slot imports, существующая cold-сборка обоих bundles проверяет бюджет 256 KiB.
- Старые metadata могут оказаться несовместимы → source CAS и подписанный PRE остаются строгими; автоматический повтор или изменение старых receipts не выполняется.
- Удаление package не доказывает уменьшение клиентского JS → отчёт содержит только измеренные физические TS-строки; CI/build и staging-приёмка остаются отдельными фактами.

## Migration Plan

Миграций и действий с БД нет. После local/source review выполняется собственный commit №157; обычный merge, CI и приёмку staging проводит Root. Архивация OpenSpec и production-выпуск не входят в задачу.
