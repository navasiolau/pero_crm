# Поток обычных вложений

Endpoint /api/files/upload принимает документ в private owned spool и считает SHA256/размер при записи. Оригинал передаётся в storage потоком; полный document Buffer не создаётся. Изображение отдельно читается как bounded Buffer до25 МиБ для прежнего Sharp thumbnail. Document cap1 ГиБ, original bytes/filename/MIME/keys, nonce/receipt, ordinary/measurement/sketch/project-cover/batch workflows сохраняются.

## Контекст и доступ

Общий sendFileUpload передаёт x-pero-upload-context: ASCII percent-encoded JSON {version:1,fields} до4096 bytes. Fields только projectId/productId/taskId/section/assignCover/assignProjectCover/expectedSketchFileId/expectedCoverFileId/clientMutationId. Helper не читает File bytes. Invalid present header отказывает400 до body; late multipart target совпадает с normalized declaration.

Auth/global upload role проверяются до body в обоих lanes. Declared lane проверяет exact entity/mode ACL до body. Headerless/file-first формы поддержаны через тот же bounded private spool: полный entity context известен после multipart metadata, ACL проверяется до storage и повторно при finalization. Exact zero-byte entity denial для legacy не обещается. Private spool через web не выдаётся.

Target adapter переиспользует existing cover schemas/permissions и resolveUploadContext для early/late stages. После stream обновляются session/roles; transaction обновляет actor ещё раз. Existing cover writers повторяют permissions/CAS внутри transaction; ordinary writer повторяет resolveUploadContext и derived product match. Engineer PRODUCTION read не расширяет technical DESIGN upload.

## Конечные пределы

- Image25 МиБ, document1 ГиБ; один file,16 text fields,17 parts.
- Field4096 UTF8 bytes, field-name100 UTF8 bytes, sum metadata64 КиБ; точные пределы включены.
- Binary multipart body<=decoded file cap+128 КиБ. Exact native base64 transfer допускает конечный encoded wire bound2×decoded cap+128 КиБ; стандартный76-character CRLF wrapping помещается. Размеры25 МиБ/1 ГиБ, SHA и fingerprint относятся к прежним native decoded original bytes. Boundary200 bytes, received chunk<=1 МиБ.
- Busboy1.6.0: fixed16 КиБ header block. MAX_HEADER_PAIRS2000 ограничивает накопление, дополнительные пары могут игнорироваться; pair-count reject не заявляется.
- Собственное counting/field-name validation не опирается на ignored headerPairs/fieldName options. Coarse cap+1 limits не отказывают на exact equality.
- highWaterMark64 КиБ является конфигурацией, **не RSS-приёмкой**.

Предел задачи139 — **32 МиБ живых транспортных буферов на upload**,64 МиБ на два одновременно. Общая память Node RSS/external/arrayBuffers включает код, SDK и недостижимые ещё не собранные allocations; её исходные baseline/peak/delta публикуются отдельно без принудительного GC. Бизнесспецификация не задаёт32 МиБ для всего процесса.

В existing RSS entry public queue lengths измеряются для pending/parser/part/measure read+write/file write/spool readers/IncomingMessage/storage reader. На каждый HWM64 КиБ допускается overshoot одним входным chunk<=1 МиБ; queue caps проверяются при sampling и на итоговом peak. Сумма максимумов разных очередей консервативно считает общие backing buffers повторно. К ней всегда добавляются фиксированные резервы: Node→Web prefetch и active input3 МиБ, pending concat1 МиБ+3 bytes, parser header/fields320 КиБ, native empty metadata sidecar72 КиБ, UTF8/base64 text+output3 МиБ+32 КиБ, file-write in-flight1 МиБ+64 КиБ, original read/hash/S3-body in-flight256 КиБ. Теоретическая сумма всех queue caps и резервов —17145862 bytes/upload (<32 МиБ), размер файла в неё не входит. Image decoder/full bounded image buffer исключён только согласно явной оговорке плана; документ целиком не читается.

Это измеритель конкретного Node/installed NextRequest adapter/spool/original-stream/mock SDK пути. Реальная SDK wire buffering/MinIO и полный deployed Next server проверяются отдельно при staging-приёмке; mock не выдаётся за такую проверку. Raw observations25/100/1024 МиБ иtwo-parallel остаются в исходной серии. После полного drain live queues0, owned reader/file/child closure обязательны. Ошибочные прежние process32MiB STOP и отдельная post-GC DIAGNOSTIC_ONLY сохраняются без переименования в PASS.

## Владение и запись

Spool — свежий random directory под guarded os.tmpdir; file wx/mode0600. Reader/cleanup проверяют canonical path, no reparse, exact dev/inode/no hardlink aliases; reader также size/mtime/ctime. Abort/limit/error закрывает parser/output/own handles и удаляет только этот own spool. Public body reader прекращает новые reads и release lock; actual abort отменяет source. HTTP socket/JSON outcome проверяется отдельно, unit release не является runtime proof. Ownership conflict оставляет состояние для HOLD; broad startup prune нет.

S3 оригинал передаётся с ContentLength/precomputed ChecksumSHA256 отдельным stream client maxAttempts1. Unknown Put ACK автоматически не повторяется. Explicit same-nonce client retry открывает fresh stream; Buffer s3Put сохраняет прежний client/default retries. Actual MinIO compatibility NOT_RUN.

Local publishing пишет bounded pending file, проверяет copied size/SHA и exclusive hardlink создаёт destination без overwrite; pending alias снимается. Поддержка этого no-clobber механизма конкретным filesystem требует отдельного actual acceptance; additional fallback/design adjustment проходит review до runtime.

Known rejection — explicit S3 service AccessDenied/InvalidAccessKeyId/SignatureDoesNotMatch/NoSuchBucket, HTTP4xx и attempts1. Missing metadata/prior retry/network/timeout/5xx остаются unknown. Unknown storage/DB ACK не компенсируется как доказанный rollback. File/receipt/audit атомарны после ACK; concurrent fresh Put losers компенсируются после transactional dedup, один physical Put не обещается.

## Evidence

Tiny real multipart/actual handler tests и fake DB/S3 сохраняют status/roles/CAS/replay/bytes/old/winner-key assertions. Implementation-only File.arrayBuffer1 заменён fullbuffer0+streamedbytes/hash. AsyncLocalStorage fixture связывает actor с запросом; production auth guard актуален.

Unit/type/lint не доказывают PostgreSQL/real storage/actual Next HTTP/large RSS/browser/staging. Только отдельные Root windows; migration139 нет. Main/production/restic/dump/seed/reset/new DB запрещены.

Primary docs: [Busboy](https://raw.githubusercontent.com/mscdex/busboy/v1.6.0/lib/types/multipart.js), [Node22 streams](https://nodejs.org/docs/latest-v22.x/api/stream.html), [AWS checksums](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html).

## Совместимость native метаданных

Public Busboy получает исходный stream. Bounded retained-header tap с finite one-byte lookahead учитывает delayed file event; после first event payload больше не сканируется. Ровно один captured Content-Disposition +single native File/public field match подтверждают part identity. Отдельный native Request.formData получает только bounded заголовок и ПУСТОЕ тело, никогда исходный файл. Его filename/MIME авторитетны: сохраняются params, last duplicate Content-Type, original folder prefix и percent-escaped кавычки. Raw Busboy filename не является нормализованным native именем; duplicate/ambiguous disposition отказывается без publication.

Exact base64 transfer декодируется потоково как прежний native UTF8→Buffer.from(base64), включая low8 UTF16, padding/whitespace/finalpartial/invalidUTF8. Binary transport не перекодируется. Await metadata не оставляет file stream без error listener; abort во время этого await очищает только owned temp. Native original receipt с тем же nonce/полным MIME/нормализованным именем/decodedSHA возвращает old ID без нового Put/notification.
