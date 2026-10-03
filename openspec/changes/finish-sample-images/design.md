# Design
## Context
47explicitlocal/S3 mode,48safeUploadErrorDetails/clientUUIDreplay,44boundedpreview/ACL-beforecache,73snapshotwriter/globalTaskTransaction уже существуют.
## Goals / Non-Goals
Actual originalbytes/samplepreview/fullscreen и retainedoldsnapshotassets. Не писать Project/File/цены/qty/earnedsnapshots, не backfillimage refs.
## Decisions
CatalogueMediaAsset UUID=iduploadCID, own finishId, storageKey catalogue-media/<finishUUID>/<assetUUID>/original, metadata/hash; Finish.current sample pointer иProductFinishAssignment.sampleAssetId nullable. Compositeasset(id,finishId)FK enforcessameFinish pointer/snapshot; Asset originalimmutable, retirement/delete flags notsourcefileediting.
ManagementexistingWAREHOUSEgrant; readactivecatalogueOFFICE/FIELD oractualvisibleProduct snapshots (includinginactiveFinish sample). Accountfinance-only denied. Protectedlookup beforecache/read; FileViewer trustedscopeenum choosesonlyinternal route. Genericpreview extendsfilebasewithoutsyntheticprojectId.
Preflightrole/context beforestorage, validate25MB/Sharp64MP supportedPNG/JPEG/WebP/AVIF/GIF; originalBuffer unchanged. ConditionalS3PutIfAbsent/localwx preventconfirmedoverwrite; exactbyteshash idempotent retry. Atomicasset/pointer/UUIDaudit receipt+finishrevisionCAS. Onpersistuncertainty resolver sameglobal lock determinesreceipt; failedresolver preservespossibleblob andunknown result, no destructiveguess.
Replace/delete retireoldasset; zero-ref/current-pointer check includesALLassignmentrefs includingarchived. Referencedasset notphysicallydeleted. Pointercommit ACK remainsauthoritative; subsequentstoragecleanup failure reportedcleanupPending withoutfalsebyteDeleteclaim, sameUUID replay retriesexactcandidate. Oldupload/delete replay returnscurrentconfirmedpointer, notstalesource.
73copiesnullableactualassetID onlynewassignment/explicitfinishchange; old NULL/storedasset unchanged bycatalogueedits. Finalreferencesremoval can callboundedretiredcleanup, notgeneralprune.
## Risks / Trade-offs
Postcommitcleanup can remainpending; no unknowncommitcleanup. Metadata-onlynative isnotS3 proof, Root actualblob/preview/cleanup acceptance required. No broad bucket listing orfakeProject scope.
## Migration Plan
Additive140000 asset/table/nullablecompositeFK, no backfill. Rootexistingtarget guards/migration/native/finalS3 QA; author BUILDONLY noDB/S3/runtime.
