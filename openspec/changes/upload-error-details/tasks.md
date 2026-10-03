# Tasks

## 1. Client Implementation

- [x] 1.1 RED→GREEN transport tests JSON/nonJSON/network/timeout, safe diagnostics, request correlation/commitState and exact same-CID retry.
- [x] 1.2 Общий diagnostics/copy component с collapse/readonly/aria/mobile containment; focused render/copy tests.
- [x] 1.3 PhotoUploadButton/Uploader/FileGrid используют shared transport/error surface; cover/context/camera preserved, ordinary CID added, ambiguity blocks new upload; changed-context retry отвергается.
- [x] 1.4 Targeted/type/lint/OpenSpec source checks PASS; isolated deps only, source freeze для root. 7/7 targeted PASS, full TypeScript PASS, scoped lint 0 errors/0 warnings. Clean offline install и только собственный Prisma --no-engine codegen; DB/shared client не затрагивались.

## 2. Root Acceptance

- [ ] 2.1 После интеграции №47 root проверяет actual safe DTO/HTTP/copy/retry/mobile и staging exact revision; DB/S3/runtime субагент не выполняет.
