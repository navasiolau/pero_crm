# Разовая конвертация тестовых цен — №46

Только root после source review. Production target отвергается; production БД этот контур не читает и не меняет. Не запускать restic/dump/seed/reset. SQL/apply и фактическую приёмку выполняет root.

## Поля и курс

Выбираются текущие `Project.currency != BYN`. Дата — календарный день `Project.createdAt` в Europe/Moscow; до 2016-07-01 требуется отдельное решение без неявной деноминации. Официальные источники:

- `https://api.nbrb.by/exrates/currencies`: однозначный abbreviation/validity/Cur_ID/Cur_Scale.
- `https://api.nbrb.by/exrates/rates/{ABBR}?parammode=2&ondate=YYYY-MM-DD`: exact requested Date/ID/scale.

Нет текущего курса/fallback и нет предварительного округления rate/scale до6 знаков. Decimal unit round-half-up2, затем line×qty. Project.initialPrice/delivery/unloading/installation и Product.expectedPrice/initialPrice — отдельные report rows; null сохраняется. Полный raw catalog, raw rates/metadata, URLs и SHA256 сохраняются в private FX receipt.

## Три отдельных root шага

Из `apps/web`, direct Node/tsx установленного pinned runtime:

```text
node scripts/byn-price-conversion/build-coordinator.mjs
node test-results/byn-price-coordinator.bundle.mjs <local|staging> <full40SHA> <local-node|actualsha256Image> inventory <absolutePrivateDirectory>
node test-results/byn-price-coordinator.bundle.mjs <sameTarget> <sameSHA> <sameImage> plan <sameDirectory>
node test-results/byn-price-coordinator.bundle.mjs <sameTarget> <sameSHA> <sameImage> apply <sameDirectory>
```

Private directory должна быть внутри `<worktree>/.playwright-mcp/round2/`. Env/секреты задаёт существующий root transport; не печатать raw stdout подготовительных DB шагов. Outer transport **inspect** и input `operation:"inspect"` совпадают; отдельный `priceOperation` равен inventory/seal/apply. Это сохраняет существующий stage gate и target/hostname/image/W07 proof. FX fetch выполняется root вне DB transaction. Файлы создаются через wx; ни оригинальный manifest, ни plan/receipt не перезаписываются.

Inventory подписывает источник и fingerprints **всех public tables**, включая дополнительные legacy tables и `_prisma_migrations`. Для выбранных Project/Product исключены только разрешённые текущие money/currency/updatedAt поля; qty/прочие колонки, невыбранные rows и все прочие таблицы сравниваются полностью. Apply проверяет подписи/target/plan, берёт row locks и выполняет единый Serializable transaction. Existing triggers остаются активны. Refusal/conflict приводит к rollback/STOP. Exact after state возвращает ALREADY_APPLIED без повторного умножения. Local без foreign rows возвращает NO_FOREIGN_PROJECTS без изменения цен.

Новый manifest имеет signed `version:2` и `fingerprintProfile:ALL_PUBLIC_TABLES_APITOKEN_LASTUSEDAT_ONLY_V2`. Единственное operational исключение — `ApiToken.lastUsedAt`: легитимные bot GET меняют этот timestamp. Все остальные поля/counts ApiToken и прочие данные по-прежнему совпадают полностью. Старые manifests без этого профиля отвергаются; их подписи/fingerprints/STOP receipts не пересчитываются и не переинтерпретируются. После обновления нужен новый inventory/plan в новом private directory.

После успешной записи возвращается реальный `txid_current()` pricingVersion существующей projection и updatedAt. Физического нового pricingVersion столбца/миграции нет. App receipt/cache writer не вызывается.

## Отчёт №32 — отдельная зависимость

`canonicalCurrentPriceSource` принимает только реальные nested project/product records и связывает Product с известным родителем. Missing amount/date/currency не подменяются значением null или предположением. `buildBynPricePlan` даёт canonical report schema. Production файл требует actual authenticated app export владельца; отсутствие/недоступность скрытого initialPrice отмечается как unavailable в исходном экспортёре, а не выдаётся за null. Здесь нет production collector/mutator и нет утверждения о сформированном production XLSX.

`buildProductionAppPriceReport` принимает wrapper schema существующего app-only экспортёра (available/known-null/unavailable), сохраняет unavailable без before/after и не предполагает qty=1 либо другую дату. Один workbook создаёт root через Spreadsheets skill/bundled artifact JS из canonical report JSON. Субагент не создавал production workbook или production export.
