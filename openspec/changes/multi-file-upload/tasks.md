# Tasks
## 1. Артефакты OpenSpec
- [x] 1.1 Созданы proposal/spec/design/tasks на русском без изменения интерфейса; проверка `npx openspec validate multi-file-upload`.
## 2. Сервер: дифференцированный лимит
- [x] 2.1 Чистый модуль `server/files/upload-limits.ts` (image 25 МБ, document 1 ГБ, раздельные тексты); обе проверки route.ts (`file.size`, `buffer.length`) переведены на него, sharp-блок не тронут; проверка юнит-тестом лимитов.
- [x] 2.2 Регрессия: обложки (`assignCover`/`assignProjectCover`) по-прежнему 25 МБ; `image-preview.ts` SOURCE_MAX не тронут.
## 3. Клиент: батч-инфраструктура
- [x] 3.1 `lib/file-upload-client.ts`: константы пачки (100 файлов, пул 4, порог 25 МБ), `uploadTimeoutMsForSize` (60 с → 600 с), таймаут по умолчанию из размера файла, `sendUploadBatch` (кап 100, пул 4 для мелких, последовательно для крупных, порядок выбора, частичный успех); проверка новым тестом `tests/multi-file-upload.test.ts`.
## 4. Клиент: точки загрузки
- [x] 4.1 `Uploader` (files-tab.tsx): `multiple` на input, FileList → массив, кап 100, отдельный FormData + `clientMutationId` на файл, `validateFileForCategory` для каждого, итог «Загружено X из Y + список ошибок»; проверка линт + ручной кейс пачки фото.
- [x] 4.2 `PhotoUploadButton` (не обложка): `multiple`, перебор FileList в input/drop/paste, та же батч-логика; `assignCover` и `project-cover.tsx` строго одиночные без изменений; проверка линт + кейс одиночной обложки.
## 5. Проверки и evidence
- [x] 5.1 `pnpm lint` и `pnpm --filter @pero/web test` зелёные; evidence.md с кейсами (пачка 5–20 фото, thumb/preview/удаление, 25МБ-отказ не валит пачку, одиночная обложка) и зафиксированным риском памяти + требованием теста PDF 600МБ–1ГБ на local/staging.
