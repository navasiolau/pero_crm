## Purpose
Реальные образцы отделок в защищённом catalogue-media пространстве с неизменным оригиналом и устойчивыми историческими ссылками спецификации изделия.
## ADDED Requirements
### Requirement: Protected real media
Sample SHALL иметьотдельныйasset scope; upload/replace/delete MUST проверятьmanagergrant, finish/assetCAS и UUID безfakeProject/File.
#### Scenario: Foreign or stale asset
- **WHEN** запрос содержитчужойasset либоустаревшийpointer/revision
- **THEN** прежний подтверждённыйобразец и чужие файлы не меняются.
### Requirement: Original and preview
Оригинальныебайты MUST сохраняться; preview/fullscreen SHALL использоватьexisting защищённыйviewer/ACL-beforecache.
#### Scenario: Readonly active catalogue
- **WHEN** операционныйreadonlyactor открываетобразец
- **THEN** доступноboundedpreview иoriginalfullscreen безwritegrant; finance-only отказан.
### Requirement: Snapshot retention
Новый assignment SHALL копироватьactualnullable sampleAssetID; existingNULL/oldreference MUST не inherit currentcatalogue sample.
#### Scenario: Catalogue sample replaced or removed
- **WHEN** oldasset используетсяassignedsnapshot
- **THEN** ссылка/оригиналсохраняются; physicalcleanup разрешёнтолькоexactzero-refretiredasset.
### Requirement: Commit evidence
Unknown outcome MUST сохранятьpossibleoriginal иUUIDpayload; replay SHALL не создаватьдубликат и не возвращатьstalesource вместоcurrentpointer.
#### Scenario: Lost acknowledgement
- **WHEN** исходныйACK потерян
- **THEN** sameUUID retry resolvescommittedreceipt безповторногопереписыванияоригинала.
