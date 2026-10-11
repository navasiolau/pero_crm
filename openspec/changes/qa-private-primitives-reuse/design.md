# Design

## Context

Ветка feature/162 создана после fetch от origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929. См. proposal.md. Предварительное исследование завершено; до scope GO меняются только OpenSpec artifacts.

## Goals / Non-Goals

**Goals:** canonical JSON: 2 реализации → 1; SHA-256: 3 → 1; обход предков против symlink: 3 → 1; запись open/write/fsync/close: 4 → 1. Измерить суммарные байты четырёх QA-модулей плюс нового helper относительно base; добиться сокращения исполняемого текста, отдельно показать прирост строк/тестов и не выдавать его за уменьшение production JS.

**Non-Goals:** общий QA framework, объединённый store, изменение validators/подписей/wire/version/caps/source pins/phase machine/cleanup/unknown ACK; изменение приложения, native runner, SQL, HTTP, браузер или инфраструктурные эффекты.

## Decisions

1. Новый маленький helpers/qa-private-primitives.mjs импортирует только node:crypto, node:fs, node:path. Без I/O и эффектов на import. Общие функции canonical, sha, проверка symlink предков и fsync-запись байтов. Лимиты и error codes задаёт вызывающий адаптер, не helper.
2. warehouse checkedDirectory сохраняет абсолютный путь, проверку всех предков до корня ФС до mkdir, создание каталога, сравнение realpath с учётом process.platform. warehouse runner сохраняет отдельную private results policy и свой порядок проверок.
3. product draft privatePath сохраняет требование существующего results, запрещает корень и выход наружу, lower-case сравнение, проверяет предков до results, исключая сам results как раньше. Не усилять и не ослаблять эту политику незаметно.
4. durableWrite только принимает bytes и flags wx/a. Проверка technical data, размер, readback, ledger CAS, chain hash и выбор append/exclusive остаются явными. У warehouse store сейчас нет readback после put; его добавление не входит в рефакторинг. get продолжает читать с прежним декодированием/ошибками.
5. Новый helper включается явным относительным путём в SOURCE_FILES двух runners. Общая зависимость должна участвовать в pre/post source binding. Исторические source pins/receipts не переписываются; новый run требует актуального полного manifest.
6. Граница кода — четыре named modules плюс helper. Tests: существующие wire/runner/fixtures/browser guard suites каждого семейства; новый pure primitives guard test. file-fixture113 не переводить на helper: третье семейство вне scope, его guards можно прогнать неизменными.

## Risks / Trade-offs

- Разные private path policies → адаптеры сохраняют прежний порядок, сравнения и коды отказов; fixtures для root/foreign path/symlink.
- Изменение wire bytes/hash → сравнение canonical vectors и прежних roundtrip/rejection fixtures, gzip settings не меняются.
- Crash после artifact до ledger/неполный append → прежние recovery/CAS/crash cases и fault fixture; никаких попыток repair/cleanup чужих файлов.
- Новый dependency не запинен → явное включение helper в оба source manifests и guard test наличия pin.
- Короткий однострочный исходник и читабельный helper → фактические bytes и LOC учитывать отдельно. Если executable bytes не сокращаются, пересмотреть extraction в пределах scope, не компенсировать удалением guards/tests.

## Migration Plan

Baseline выбранных pure guards → новые RED guard fixtures → extraction → GREEN плюс cold import/offline bundle/node syntax/lint/OpenSpec strict → независимое review → один разрешённый коммит. Push/обычный merge/staging-приёмку выполняет root. БД и инфраструктура не меняются. SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md обязательны; STOP при guard mismatch. Restic/dumps/reset/seed/new stand/main/production запрещены.
