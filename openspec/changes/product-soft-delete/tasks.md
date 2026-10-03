# Tasks
## 1. Domain
- [x] 1.1 RED→GREEN soft delete manager/CAS/parent/timer/replay/rollback/history preserving tests (RED1→GREEN5).
- [x] 1.2 Заменить физический writer и сериализовать startTimer без смены семантики; whole tsc и focused transaction/refusal2 tests PASS.
## 2. UI и проверки
- [x] 2.1 Красная урна «Удалить», fresh captured confirm baseline, sameUUID retry и operational redirect; matched/malformed ACK focused test PASS.
  - Исправлен actual staging RED: legacy Header string-only delete удалён, единственный текущий ProductDeleteButton размещён рядом со статусом; внешний дубль снят. Сплошной красный фон и белый текст заданы локально, shared Button не менялся. Повторная actual UI приёмка у Root.
- [x] 2.2 Whole tsc/scopedlint/OpenSpecstrict PASS, 8target tests; private native outerrollback BUILDONLY <256KiB, actual DB execution не выполнялась агентом.
- [ ] 2.3 Root actual native/local/stage acceptance с сохранением всей истории и fingerprints; pending до runtime.
