# Design
## Context
72Finish UUID/active/revision, catalogue readonly OFFICE/FIELD. 55live predicates и existing technical helper требуютDESIGN инженерномуgrant, включая действующие legacyparticipant grants. Productstatuscriticalguard/providercontroller stablealreadyexist.
## Goals / Non-Goals
Назначения в обычной карточке, сохранённый snapshot и безопасные partial saves. Не делать BOM, CAD, contractdate, pricing или image74.
## Decisions
Product.finishRevision integer + ProductFinishAssignment UUIDFKProduct/Finish; element canonicalkey uniqueinsideProduct, snapshotkind/name/code/color/catalogRevision. Старые Products получают0revision без новыхназначений, исходные поля сохраняются.
Allwriters withTaskTransaction/global lock, liveproduct/parent predicate+resolveVisibilityActor+existingcanEditProductTechnicalBlock; нет новогоPROCUREMENTproductwrite из catalogmanagement. UUID receiptactor/product/fingerprint, strictownerrevision+expectedfieldvalue, childownership. SelectedFinish mustactive; elementrename не меняетsnapshot. FKFinish Restrict, удалениеassignment explicit+audit, неCatalogdelete.
Readrevision+rows в томже lockedreadboundary для coherent DTO; readonlyauthorizedSnapshot дажееслиFinishinactive. UIоднаcachedFIFO queue perProductprovider owner иexistinginlinefieldcontrollers; immutablegetServerSnapshot, cacheexactunknownattemptUUID/payload, peerACKmonotonicrevision. Text Enter/blur, selectimmediate; conflict explicitaccept/rebase, no successrouterrefresh/revalidatedFlight; statusguard awaits dirty/pending and blocks unfinished/unknownadd/delete. New row onlyafterACK, oldACKdoesnotdiscardnewdraft.
Ordinary card sectionafterdocuments, ProductTasks69untouched. Dropdown currentselectedlabel comesfromsnapshot, noteditedcatalog; newactivechoicesfromallowedcatalog. SampleFK74absentuntilrealassetmodel, no fakeProject.
## Risks / Trade-offs
Globalrevision конфликтуетдаже при чужой строке; explicitrebase usescurrentrevision andexpectedfield metadata. No automaticdirtyretarget. Nativebuild неruntimeproof.
## Migration Plan
Reserved20261003130000, additiveProductrevision+table/keys only. RootguardedexistingDB migration/nativeouterrollback/staging; no agentDB/seed/restic/dump.
