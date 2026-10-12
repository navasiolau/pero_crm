# Tasks

## 1. Guards

- [x] 1.1 Подтвердить отсутствие активных потребителей package/exports текущим адресным `rg` и зафиксировать три TS-файла/физические строки до удаления.
- [x] 1.2 Заменить retired sourceHash на actual registry и revision-bound metadata; проверить существующим policy test принятие исторической записи и STOP для неизвестного/зарегистрированного enabled hook до эффектов.
- [x] 1.3 Привязать QA source pins к текущим registry/demo/SDK и собрать оба существующих bundles offline в прежнем бюджете; убедиться, что hooks остаются настоящими и ленивые slots не вызываются.

## 2. Package и проверка

- [x] 2.1 Удалить только allowlist package-файлов и lock importer после path/reparse guards; проверить отсутствие package imports/source reads и неизменность остальных lock entries.
- [x] 2.2 Выполнить связанные существующие fixtures/runner/wire checks, scoped lint и OpenSpec validation; проверить сохранность signed PRE, corruption/target/source guards и отсутствие production/schema diff.
- [x] 2.3 Зафиксировать evidence с точными hashes, deleted TS LOC и честным staging NOT_RUN; передать независимому reviewer, commit только после CODE_GO.

## 3. Staging

- [ ] 3.1 Root выполняет обычный merge/CI и принимает фактически развёрнутый staging с сохранёнными guard-сценариями; локальные проверки не считать staging-приёмкой.
