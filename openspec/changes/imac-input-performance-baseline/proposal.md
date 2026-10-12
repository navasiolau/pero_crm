# Proposal

Уточнение владельца12.10.2026: iMac окончательно исключён из приёмки. №141 завершается измерениями доступного ПК после оптимизаций; аппаратная причина исходного инцидента не устанавливается. Production/main по-прежнему запрещены без отдельного указания. Старые аппаратные ожидания и расширенные матрицы ниже являются историческим планом, не текущим блокером.

## Why

Владелец подтвердил задержки ввода только в CRM на iMac2017/Windows11/Chrome/16ГБ; тот же аккаунт и фильтры на другом ПК работают быстро. iMac сейчас недоступен, поэтому причинный вывод и устранение инцидента141 принимаются по доступному ПК, а доступный ПК позволяет снять воспроизводимые компонентные baseline для независимых задач142–146.

## What Changes

- Оформить один проверяемый диагностический протокол с фиксированными данными, ролями,20 реальными клавишами,5 повторами, раздельными normal-production и profiling-production измерениями.
- Подготовить private/ignored pure-component producers на чистом accepted sourceRoot: реальные React/UI/controllers, synthetic fixture и controlled Next/server boundaries, без PostgreSQL, Next runtime либо настоящих business writes.
- Зафиксировать render counts реальных authored component bodies, React commits/actualDuration, keyboard/caret, Event Timing coverage, long tasks, raw/minified/gzip bytes и полную source/producer/toolchain closure до/после запуска.
- Отдельно описать будущую paired full-app/staging/iMac приёмку и A/B одного фактора. Доступный PC benchmark не заменяет физическое устройство, настоящий production build CRM или устранение лагов.

## Capabilities

### New Capabilities

Нет: диагностическое tooling/docs не меняет поведение приложения; .openspec.yaml явно задаёт skip_specs: true.

### Modified Capabilities

Нет. Изменения UI142–146 выполняются в отдельных ветках/OpenSpec после измеренного baseline и review.

## Impact

Только openspec/changes/imac-input-performance-baseline/.openspec.yaml, proposal.md, design.md, tasks.md, protocol.md и evidence.md; supporting producers в ignored apps/web/test-results/input141-protocol/. Production source, API, schema/DB, CSS, lockfile, роли, исходные записи и файлы не меняются. Branch bugfix/141 fresh origin/staging cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Пока только planning: actual benchmark, deps installation, Next/build/native/staging calls0 до independent protocol GO и отдельного coordinated root window. Коммиты всего плана явно разрешены владельцем, main/production запрещены; restic/dumps/seed/reset/newDB не используются.
