# Verification — задача 116

Фактическая приёмка браузерной печати принята оркестратором на staging `37f882f69a2d76901b98321ff7824d0d04db4db8`, OCI image `sha256:e59a361d87fb0acd84be943747375115f8aa014225b7dd8d5d39e95d693daf0f`. Это дополнение фиксирует actual staging и завершённое readonly-окно. Предыдущие локальные проверки и этапы интеграции остаются историческими результатами в [evidence.md](evidence.md); файл не изменён.

## Actual staging result

Parent run `ff30f55e-dac2-48d2-ac5e-cad6400f3eca`, source `feature/116`. Продуктовые print helper/button/общая строка уже были развёрнуты в принятой ревизии. Последующие QA-коммиты уточнили служебные static/PDF GET, безопасную диагностику, локаторы и ожидание настоящего обработчика перед единственным printer click; приложение и parent producer ими не изменены. Последний QA commit `c7b3b99d55ffd440639ebfc201749e72a54caf99` опубликован только в feature/116; интеграцию нового evidence и итоговую ревизию всего пула контролирует Root.

**8/8 actual native preview подтверждены** без повторения уже принятых случаев. На каждом получены настоящий `chrome://print/`, `state=1`, `error=0`, `pageCount=1`, `previewLoaded=true` и правильный PDF/image признак; нажата только штатная «Отмена», target закрыт, `physicalPrintSubmitted=false`.

| Файл | Проверенная поверхность | Native |
|---|---|---|
| Эскиз `cmv0lqi7i001gok01oidvatly` | Общий список проекта | PNG, PASS |
| Чужое фото `cmv0lqp01001uok0134hsnbah` | Документы изделия | PNG, PASS |
| Собственный замер `cmv0lqvjy0026ok0149iutpsa` | Замер изделия | PNG, PASS |
| Производственный PDF `cmv0lr3et002kok01rbl8w8kf` | Документы изделия | PDF, PASS |
| Изображение задачи `cmv0lrhrn0038ok012wosznft` | Общий список проекта, тот же файл/общая printer row | PNG, PASS |
| PDF проекта `cmv0lro8h003mok01wjtlwyip` | Общий список проекта | PDF, PASS |
| Финансовый PDF `c4d491a3-2e81-4648-95ad-456f5ce6b4a8` | Собственный расход | PDF, PASS |
| Финансовое изображение `e70534a6-5f97-48cc-8de8-2792ce7e6878` | Детали собственного прихода | PNG, PASS |

Standalone QA-задача parent13 имеет `workId=null` и исключается действующим `mapTaskDetails` из task workspace. Её файл напечатан через настоящий общий список проекта. Это **не приёмка TaskDialog**: отдельный сценарий TaskDialog задачи 115 выполняется с согласованным Work child. Родительский scope ради печати не расширялся.

Unsupported CAD на staging не имеет кнопки принтера. Серверные оригиналы перед каждым новым просмотром проверены по HTTP/MIME/SHA256 и текущему signed owner binding. Arbitrary HTTP origins, backend writes и неподтверждённые ошибки CRM/React запрещены. Исключение служебных PDF URI работает только для текущего verified own PDF; финальная успешная попытка не использовала подавление ошибок: `pageErrors=0`, `nativeShutdownErrors=0`, `deniedReads=0`, `upstreamWrites=0`, `storageWriteAttempts=0`.

## Actual PNG visual review

Все четыре новых PNG просмотрены локально; целое изображение видно на одной странице с полями, PDF показывает собственный документ `PERO QA113`; интерфейса CRM на печатной странице нет. Ранние четыре подтверждённых native PNG сохраняются в прежних каталогах. Изображения fixture имеют один и тот же оригинал 360×480, PDF — один и тот же документ; совпадение содержимого объясняет одинаковые PNG hashes. Локальные tall/wide corner cases из evidence.md остаются отдельными локальными проверками.

Private ignored base: `C:/Users/admin/.codex/worktrees/crm-task-113/pero_crm_v2/apps/web/test-results/files-final-ff30f55e-dac2-48d2-ac5e-cad6400f3eca/`.

- Первые три PNG: `native-v6-root2/print-project-<id>.png` для трёх первых image ID таблицы.
- Производственный PDF: `native-v6-remaining/print-project-cmv0lr3et002kok01rbl8w8kf.png`.
- Новые четыре PNG: `native-v6-sub116-ready/print-project-cmv0lrhrn0038ok012wosznft.png`, `print-project-cmv0lro8h003mok01wjtlwyip.png`, `print-finance-c4d491a3-2e81-4648-95ad-456f5ce6b4a8.png`, `print-finance-e70534a6-5f97-48cc-8de8-2792ce7e6878.png`.

SHA256 image PNG: `a5a7f8f1536460a3eeae5274dcbca8deaa4499f48f0a00014899b84bfc532468`. SHA256 PDF PNG: `469347a589c307cccb48148b9a859326c20d879280ae20f5cbd7c797594225bf`.

| Immutable receipt | SHA256 |
|---|---|
| `sub116-native-ready-result.json` | `7506fc30fe0afc37f42511a960e12e3c5f9aa03011066c2b13e466055640fbf2` |
| `sub116-native-ready-closed.json` | `5c1bdc4c5d976b83e16365cd00caa4b8eb0753fd527b5732e6acc25a0baf0ac7` |
| `sub116-native-ready-visual-pass.json` | `4b676421ab067ebe883c2e04e3b77be697d8d9cbbca5b941e11444dbea6ad64f` |

## Readonly closure and preservation

Последний pass получил `READ_ONLY_CAPTURED` для новых 4 случаев, пропустив прежние 4 по совпадению current ID/contentHash и настоящему ready/Cancel proof. Визуальная приёмка — PASS. Late signed owner observation/final certificate подтвердили `READONLY_CLOSED`, parent part95: `originalsMatch=true`, `ownStateUnchanged=true`, `preferencesUntouched=true`, `tokenClockValid=true`, `moneyHashUnchanged=true`, `storageHashUnchanged=true`.

Финансовый hash: `69b7ccb6b840a478c6b5b918a6286e50d144d4fa6925e41dfcbb5773adb4479c`. Storage manifest hash: `cce2109a8bc2176507abe68582874579a6c4df1a21a6ae16e65402af8e663441`. Все собственные browser/process закрыты; readonly-окно возвращено Root/115. Credentials оставались в памяти, HAR/storageState/session dumps не создавались, физические задания не отправлялись.

**READONLY_CLOSED относится только к окну проверки 116. Parent13 остаётся LIVE**, его cleanup/OWN_CLOSED и остальные задачи контролирует Root. Новые деньги, акторы, файлы, Work или business DB/S3 mutations в этой проверке не создавались. Исходные данные сравнивались по reviewed token-clock contract: допускается только монотонный operational ApiToken.lastUsedAt; финансовые и остальные business facts сохранены. Дампы, restic, инфраструктура, staging push, main и production не выполнялись. Будущий app fix 115 для списка приходов не меняет проверенную print logic; эту заметку нельзя считать приёмкой будущей развёрнутой ревизии.

## Prior failed runs retained

Неуспешные receipts сохраняются без перезаписи и **не получают PASS задним числом**:

| Receipt | Результат полного запуска | Отдельное фактически полученное evidence |
|---|---|---|
| `root-print-direct-result.json` | STOP / `F116_CROSS_ORIGIN` | 3 images nativeReady/Cancel/PNG |
| `root-print-remaining-result.json` | STOP / `F116_PAGE_ERROR` | 1 production PDF nativeReady/Cancel/PNG |
| `root-print-final-result.json` | STOP / `F116_ACCEPTANCE_FAILED` | Native0, unsupported CAD control |
| `sub116-task-dom-diagnostic.json` | STOP / `TASK_TITLE_COUNT` | Concrete task Work-null workspace exclusion |
| `sub116-native-complete-result.json` | STOP / `F116_NATIVE_DIALOG_MISSING` | Native0, PNG0; late readonly closure/data preserved |

Итоговый successful pass — `sub116-native-ready-result.json`, late closure — `sub116-native-ready-closed.json`, actual + local visual PASS принят Root по результатам 65161e/47f01d. Readiness ожидание проверяет только прикреплённый React handler и не повторяет printer click. Все изменения восстановления тестового контура ограничены QA helper/tests; product print source остаётся без библиотек PDF/Word conversion.
