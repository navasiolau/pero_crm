# Spec Delta

## ADDED Requirements

### Requirement: Compiler compatibility не зависит от runtime-only упаковки

Compiler cache SHALL учитывать весь нормализованный base/build Docker prefix до единственной явной runner boundary, config inputs, actual base digest/platform/effective flags и прежний source hash. Изменения runtime-only части SHALL NOT сбрасывать compiler compatibility, а отсутствие/повтор границы MUST запрещать подготовку. Pnpm store SHALL находиться только в cache mount с copy import, node_modules SHALL оставаться в image layer; прямой Docker exporter SHALL сохранять полный immutable OCI/provenance proof и cleanup до тестирования.

#### Scenario: Меняется только runner упаковка
- **WHEN** runtime-only Dockerfile часть меняется при прежних base/build/config/platform/flags
- **THEN** compiler compatibility SHALL оставаться прежней, а свежий build, config/diff_ids/OCI proof и все проверки SHALL выполняться

#### Scenario: Меняется build или его совместимость
- **WHEN** меняется любой base/build command, конфигурация, actual base/platform либо effective build flag
- **THEN** compiler compatibility MUST измениться без fallback на несовместимые ключи; ordinary local frozen install и supply-chain проверки SHALL сохраняться

### Requirement: Metadata из проверенного runtime и параллельная типизация

CI SHALL извлекать полные свежие generated types, BUILD_ID и manifest из принадлежащей текущему запуску незапущенной immutable runtime projection без сети/mounts; проверка OCI/config/layers/provenance/SHA MUST завершаться до приложения, миграций и tsc. Полный tsc SHALL выполняться в backend после exact-ID artifact с проверенными archive digest, identity и всеми file hashes, также для PR. Отдельный metadata builder export SHALL NOT использоваться.

#### Scenario: Producer ещё выполняет интеграции
- **WHEN** Native успешно загрузил ранний types artifact и продолжает интеграции
- **THEN** backend SHALL выполнить полный tsc параллельно; Native SHALL ждать весь backend SUCCESS перед bot packaging, а publishers SHALL по-прежнему ждать все unit/native gates

#### Scenario: Повреждение metadata или ошибка producer
- **WHEN** artifact имеет чужой SHA/attempt, неверный archive/file hash, лишний путь или symlink, либо producer/tsc завершился ошибкой
- **THEN** CI MUST завершиться ошибкой без публикации; bounded ожидание и owned cleanup SHALL сохраняться

#### Scenario: Отмена фоновой установки или metadata copy
- **WHEN** job отменён после создания owned deps group или metadata container
- **THEN** existing finally/always cleanup SHALL удалить только exact owned ресурсы с проверкой identity; незавершённая установка, смерть без status и timeout300с MUST запрещать использование dependencies

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
