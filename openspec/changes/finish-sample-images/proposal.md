# Proposal
## Why
Каталог72 и snapshots73 готовы; нужен реальный защищённый образец изображения в отдельном catalogue-media scope без fakeProject/File.
## What Changes
- CatalogueMediaAsset сimmutableoriginal/owner/hash, Finish nullable sample pointer, assignment nullable snapshotAssetID безbackfill/liveinherit.
- Management upload/replace/delete CAS+UUID и реальные original/optimizedpreview/fullscreen.
- Referencedoldasset/blob сохраняется при замене/удалении каталога; толькоexactzero-ref retiredasset очищается.
- Unknowncommit/replay/stale/ACL ошибки сохраняют подтверждённый источник; ошибки47/48 безопасны.
## Capabilities
### New Capabilities
- `finish-sample-images`: защищённые образцы каталога и сохранённые ссылки snapshots.
### Modified Capabilities
Нет.
## Impact
Reserved20261003140000 models/FK, catalogue-media service/routes, genericpreview/FileViewer trusted scope, finish/sample controls и snapshotcopy. NoPrice/BYN/qty/pay/CAD/BOM changes илиfakeentities.
