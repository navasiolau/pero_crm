# №185: порты для native caller и договора №186

Этот документ описывает фактические интерфейсы после обычного merge зависимостей №180–183. Сам по себе он не является DB/runtime-приёмкой. Внешний caller отвечает за существующую разрешённую local5433, точный container/URL/declaration guard, одну rollback-транзакцию и сравнение полного business baseline. Здесь нет подключения к БД или запуска worker.

Root уже выполнил отдельную metadata-only SQL-приёмку с этими настоящими adapters: run `faf674f0-7e25-48a5-b590-07d6eb630207`, sourcePlan `0b9289833b0a8a3415c51506c3e786087bb0fa7cc3858879ecc8c0b404b80572`. Квитанция, hashes и ограничения — в [verification.md](verification.md). Успех SQL не подтверждает physical documents или production composition.

## Native helper №185

`verifyKpVersionNative(tx, input)` из `apps/web/tests/helpers/kp-version-native.ts` принимает тот же `Prisma.TransactionClient`, внутри которого caller создаёт собственные фикстуры и после проверки выполняет полный rollback.

| Поле input | Требование |
| --- | --- |
| `runId` | UUID проверенного root-run. Helper использует marker `__qa185_<runId>` |
| `proposalId` | Собственный живой связанный КП в LEAD; `sourceId` равен marker, `createdById` равен actor.id |
| `actor` | `{id,source:"web",sessionVersion}` собственного активного management user; `User.name` равен marker |
| `ports` | Полные `LifecyclePorts & LifecycleSecurity`, описанные ниже |
| `save` | Настоящий полный №181 save в этом же tx, с №182 pricing и №183 media hooks; возвращает `{revision}` |

Для первой SQL-приёмки использовать фикстуру без изображений. Actual `itemMediaReferences` тогда естественно возвращает пустой список, а media hook проверяет и синхронизирует пустой состав без S3. Это не принимает image upload/retention. PDF helper — объявленная metadata-only SQL-фикстура; `rendererAndS3Accepted:false` сохраняется даже при успешном native запуске.

## Обязательные порты

`LifecyclePorts` из `lifecycle-contract.ts`:

```ts
type LifecyclePorts = {
  enabled: boolean;
  templateIdentity(): {
    templateHash: string;
    fontManifestHash: string;
    sourceManifestHash: string;
    chromium: string;
    puppeteer: string;
  };
  pricingSnapshot(proposal: ProposalRecord):
    LifecycleObject | Promise<LifecycleObject>;
  mediaIds(state: LifecycleState): readonly string[];
};
```

- `enabled:true` разрешает только явно вызванную операцию этого caller; не меняет env/глобальный feature flag и не запускает worker.
- Runtime `templateIdentity` берётся из настоящего pinned getter №184 после его обычного merge. Metadata-only native SQL fixture может иметь явно объявленную неизменяемую fixture identity с валидными SHA256; она не доказывает шаблон, шрифты или рендер и не становится runtime default.
- `pricingSnapshot` использует `projectProposalPricing(proposal.state, fixedRate)` №182 с сохранёнными `currency/rate/rateDate/rateSource`. Все Decimal сериализуются строками в JSON object; отсутствующий курс — ошибка, без НБРБ/fetch и без нового курса.
- `mediaIds` использует `itemMediaReferences` №183 для стабильных item IDs и обеих image slots, затем возвращает media IDs. Не подставлять произвольные URL и не объявлять пустой список для состояния с картинками.

`LifecycleSecurity` из `lifecycle-store.ts` имеет ровно один обязательный callback:

```ts
type LifecycleSecurity = {
  authorizeSource(tx: Prisma.TransactionClient,
    binding: ActorBinding): Promise<void>;
};
// ActorBinding: {id,source:"web"|"api"|"telegram",tokenId?,sessionVersion?}
```

Store сам читает свежий User с active/roles/sessionVersion под `FOR SHARE`; lifecycle проверяет management roles. Callback не может быть noop: в runtime №187 он повторно проверяет actual API key/owner/revocation/scopes либо текущую web session. Native web-only caller может строго привязать его к собственному fixture actor/session; проверка отзыва пользователя остаётся настоящим SQL store.

Дополнительных портов clock/access policy нет. Время/lease получаются из `clock_timestamp()` через store. Все wrappers используют переданный tx и не открывают другую транзакцию.

## RestoreSave и полный №181 save

Фактический callback из `lifecycle.ts`:

```ts
type RestoreSave = (actor: DomainActor, input: {
  proposalId: string;
  expectedRevision: number;
  operationId: string;
  clientId: string | null;
  state: LifecycleState;
  fx: {
    currency: string;
    rate: string | null;
    rateDate: string | null;
    rateSource: string | null;
  };
}) => Promise<{revision: number}>;
```

Adapter отделяет `fx` от закрытого input №181 и вызывает `saveProposalInTransaction(tx, actor, input181, hooks)` в том же tx. Передаются исторические `state/clientId`; explicit `clientSnapshot` не добавляется, snapshot уже находится в `state.client.crmSnapshot`. Это сохраняет восстановление временного клиента без попытки изменить служебную карточку.

`hooks.applyPricing` обязателен: `projectProposalPricing` + `applyProjectionInTransaction` №182 и сохранение CP.currency/rate/rateDate/rateSource в том же tx. FX входит в стабильный pricing fingerprint операции. При изменении только FX hook сообщает `{changed:true}`, чтобы №181 увеличил ревизию. `hooks.applyMedia` — настоящий `createProposalMediaHooks` №183 с pinned `currentBinding`; для новых изображений требуются предварительно подготовленные реальные copies вне tx. Исключения не перехватываются до rollback; outbox не dispatch-ится внутри native внешней транзакции.

## Атомарные wrappers для №186

Все функции ниже экспортируются из `lifecycle-store.ts`. `ports` означает `LifecyclePorts & LifecycleSecurity`, `security` — только callback выше.

| Wrapper | Аргументы после tx | Результат/назначение |
| --- | --- | --- |
| `freezeSourcesInTransaction` | `binding, refs:[{proposalId,expectedRevision}], ports` | `FrozenProposalSource[]`, сохранённые state/FX/client/media/template до I/O |
| `assertRenderJobClaimInTransaction` | `claim, security` | `{job,payload,actor}` с текущими lease/actor checks |
| `recordPendingPdfArtifactInTransaction` | `{claim,proposalId,artifact:{storageBinding,sha256,size}}, ports` | Новый `ArtifactRecord`; PENDING ledger и exact orphan intent созданы до upload |
| `registerPendingArtifactCleanupInTransaction` | `{claim,artifactId,proposalId}, security` | Cleanup intent для уже существующего PENDING DOCX; proposalId — один из frozen sources |
| `publishSourcePdfInTransaction` | `{claim,proposalId,artifactId,verified}, ports` | `VersionRecord`; №186 отображает `id` в versionId, `pdfArtifactId` в artifactId |
| `completeRenderJobInTransaction` | `claim,result,security` | Завершает job после всех PDF/DOCX/stage операций |

`parseRenderJobPayload` и `pendingArtifactKey` экспортируются из `lifecycle-contract.ts`.

- `claim={id,owner,attempt,kind:"CONTRACT"}`. Actual job имеет `proposalId=null`, заполненный `contractId`, `createdById=payload.actor.id`; обязательный `payload.extra.contractId` точно равен job.contractId.
- `verified={id,storageBinding,key,sha256,size}` получается от настоящего readback. Native metadata-only fixture честно остаётся отдельной SQL-проверкой.
- DOCX key строится строго через `pendingArtifactKey(claim,{kind:"DOCX",id:contractId},artifactId)`; owner/kind/key должны совпасть при cleanup registration. PDF key возвращается PDF reservation, его нельзя создавать повторно другим путём.
- `source.mode="render"` публикует новую версию только в LEAD. `retained` использует accepted PDF и не создаёт новую версию КП. Источник не принимается из raw caller state.
- Порядок блокировок: общий mutex `(18435,55001)` первым, затем проекты в согласованном порядке, CP/contract/client. Render/storage находятся вне SQL.
- Финал №186 в одной внешней транзакции создаёт все новые PDF versions, READY DOCX и ContractVersion, выполняет переходы общим `patchProjectStageTransaction`, затем complete. Если stage result.ok=false — исключение и полный rollback. `publishSourcePdfInTransaction` сам job не завершает.

Runtime renderer/storage/API composition и запуск worker остаются отдельными задачами №184/187 и требуют обычных dependency merges; отсутствующие реализации не заменяются production заглушками.
