# Spec Delta

## ADDED Requirements

### Requirement: Полные обязательные проверки при использовании CI-кэша

CI SHALL выполнять существующие тесты, lint, production build и полную типизацию web, включая тестовые исходники и заново сгенерированные типы routes. Полная типизация MUST выполняться после build. Отключение дублирующихся проверок внутри build SHALL допускаться только при обязательных внешних gates; обычная локальная сборка SHALL сохранять свои проверки. Оба jobs публикации SHALL требовать успеха полной unit matrix и native job с cleanup; failure, skipped или cancelled любого обязательного gate MUST блокировать публикацию образов.

#### Scenario: Ошибка тестового исходника вне встроенной типизации build
- **WHEN** тестовый файл имеет TypeScript-ошибку либо свежий тип route нарушает контракт
- **THEN** полный gate типизации завершается ошибкой и образы не публикуются

#### Scenario: Независимые проверки выполняются параллельно
- **WHEN** существующие suites и build запускаются одновременно
- **THEN** успешный результат CI возможен только при успехе всех обязательных suites и gates с сохранением изоляции тестовых процессов

#### Scenario: Native использует свежую сборку того же run
- **WHEN** shared Bake DAG выпускает full OCI с provenance, no-attest Docker projection и fresh metadata текущего SHA, а полная типизация и required unit suites проверяют те же source inputs
- **THEN** native SHALL испытывать совпадающие Alpine runtime image config/diff_ids/revision/BUILD_ID, а публикация SHALL только после успеха всех обязательных suites/checks/cleanup переносить исходный immutable OCI/referrers без rebuild/early tags

#### Scenario: Native испытывает production standalone без отдельной host сборки
- **WHEN** CI тестирует production OCI runtime, собранный единственным shared build graph
- **THEN** native SHALL использовать тот же Alpine standalone/runtime packaging; отдельная host no-standalone сборка и cross-ABI .next/node_modules копирование SHALL NOT заменять испытываемый образ, а обычный local Docker fallback SHALL сохраняться

### Requirement: Кэш ускоряет подготовку без повторного использования рабочих данных

CI SHALL сохранять только промежуточные build-данные и слои образов с ключами, учитывающими совместимость runtime, зависимости и входные исходники. Фикстуры, секреты, запущенные контейнеры и рабочие данные MUST NOT входить в кэш. Кэш закреплённого тестового сервиса MUST сохранять проверку исходных pins, фактического image digest и текущего владельца запуска до DB/S3-операций; существующие tmpfs и cleanup SHALL сохраняться.

#### Scenario: Совместимый повторный build
- **WHEN** CI находит кэш с совместимыми Node, lockfile и build-конфигурацией
- **THEN** промежуточные данные ускоряют свежую сборку текущего SHA, а все обязательные проверки выполняются снова

#### Scenario: Несовпадение pins или принадлежности контейнера
- **WHEN** кэшированный тестовый образ либо контейнер не соответствует исходным pins или владельцу текущего запуска
- **THEN** CI завершается ошибкой до DB/S3-операций и использует только существующий cleanup собственных ресурсов
