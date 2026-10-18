// Контракт публичного транспорта; импорт не подключает БД, S3 или очередь.
const id = { type: "string", minLength: 1, maxLength: 160 } as const;
const revision = { type: "integer", minimum: 0 } as const;
const operationId = { type: "string", format: "uuid" } as const;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });
const parameters = (...names: string[]) => names.map(name => ({ name, in: "path", required: true, schema: id }));
const response = (schema: unknown) => ({ "200": { description: "Подтверждённый результат", content: json(schema) },
  "400": { description: "Невалидный запрос", content: json(ref("KpError")) },
  "401": { description: "Требуется действующий Bearer и активный владелец" }, "403": { description: "Нужны роль и явный scope КП" },
  "404": { description: "Раздел выключен или сущность недоступна" }, "409": { description: "Конфликт ревизии, этапа или UUID" },
  "410": { description: "Источник удалён или истёк" }, "413": { description: "Превышен лимит тела" },
  "503": { description: "Результат не подтверждён; используйте GET operations" } });
function read(summary: string, scope: string, schema: unknown, names: string[] = [], query: Record<string, unknown>[] = []) {
  return { summary, tags: ["КП и договоры"], "x-required-scope": scope, parameters: [...parameters(...names), ...query], responses: response(schema) };
}
function command(summary: string, scope: string, schema: unknown, result: unknown, names: string[] = []) {
  return { ...read(summary, scope, result, names), requestBody: { required: true, content: json(schema) } };
}
const query = (name: string, schema: unknown, required = false) => ({ name, in: "query", required, schema });
const record = { type: "object", additionalProperties: true };
const nullableString = { type: ["string", "null"] };
const state = { ...record, required: ["items"], properties: { items: { type: "array", items: record } } };
const clientProperties = { name: { type: "string", minLength: 1 }, phone: { type: "string", minLength: 1 },
  lastName: nullableString, middleName: nullableString, email: nullableString, address: nullableString,
  comment: nullableString, passportNumber: nullableString, passportIssuedBy: nullableString };
const sources = { type: "array", minItems: 1, maxItems: 30, items: { type: "object", additionalProperties: false,
  required: ["proposalId", "expectedRevision"], properties: { proposalId: id, expectedRevision: revision } } };
const release = { type: "object", additionalProperties: false, required: ["operationId", "expectedRevision"], properties: { operationId, expectedRevision: revision } };
const contractProperties = { documentId: id, operationId, expectedRevision: revision, clientBaseline: { type: "string", pattern: "^[a-f0-9]{64}$" }, sourceRefs: sources };
const contractGenerate = { type: "object", additionalProperties: false, required: ["operationId", "expectedRevision", "clientBaseline", "sourceRefs"], properties: contractProperties };
const fx = { type: "object", additionalProperties: false, required: ["currency", "rate", "date", "source"], properties: {
  currency: { enum: ["BYN", "RUB", "USD", "EUR"] }, rate: { type: "string", description: "Decimal BYN за единицу валюты" },
  date: { type: "string", format: "date" }, source: { enum: ["NBRB", "MANUAL"] } } };
const writeProperties = { operationId, state, clientId: id, clientSnapshot: { type: "object", additionalProperties: false, properties: clientProperties }, address: nullableString, fx: ref("KpFx") };
export const kpApiSchemas = {
  KpError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: id, message: { type: "string" } } } } },
  KpFx: fx,
  KpCreateDocument: { type: "object", additionalProperties: false, required: ["operationId", "state"], properties: { ...writeProperties, expectedNumber: { type: "integer", minimum: 1 } } },
  KpSaveDocument: { type: "object", additionalProperties: false, required: ["operationId", "expectedRevision", "state"], properties: { ...writeProperties, expectedRevision: revision, proposalId: id } },
  KpDocument: { type: "object", required: ["id", "revision", "state", "project", "client", "canEdit", "isArchive", "fx", "createdAt", "updatedAt"],
    properties: { id, revision, state, project: { type: ["object", "null"], properties: { id, number: { type: "string" }, stage: { type: "string" } } },
      client: { type: ["object", "null"], properties: { id, label: { type: "string" } } }, canEdit: { type: "boolean" }, isArchive: { type: "boolean" },
      fx: { anyOf: [ref("KpFx"), { type: "null" }] }, sourceDate: { type: ["string", "null"], format: "date" },
      createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
  KpVersion: { type: "object", required: ["id", "revision", "createdAt", "trigger", "isAccepted", "pdfArtifactId"], properties: {
    id, revision, createdAt: { type: "string", format: "date-time" }, trigger: { enum: ["PDF", "CONTRACT", "IMPORT"] }, isAccepted: { type: "boolean" }, pdfArtifactId: nullableString } },
  KpJob: { type: "object", required: ["id", "state"], properties: { id, state: { enum: ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"] },
    error: nullableString, result: { type: ["object", "null"], properties: { artifactId: id, versionId: id, fileName: { type: "string" }, mimeType: { type: "string" }, downloadUrl: { type: "string" } } } } },
  KpContractSave: { ...contractGenerate, properties: { ...contractProperties, settings: record }, required: [...contractGenerate.required, "settings"] },
  KpContractGenerate: contractGenerate,
} as const;
const versionList = { type: "object", properties: { versions: { type: "array", items: ref("KpVersion") } } };
const clientDetails = { type: "object", properties: { id, label: { type: "string" }, isTemporary: { type: "boolean" }, snapshot: { type: "object", properties: { id, ...clientProperties } } } };
const contractForm = { type: "object", properties: { contractId: nullableString, revision, settings: record, profiles: { type: "array", items: record },
  sourceRefs: sources, clientDefaults: record, clientBaseline: { type: "string" }, canEdit: { type: "boolean" }, versions: { type: "array", items: record } } };
const download = read("Скачать приватный PDF или DOCX", "kp:read (PDF) / kp:contracts:read (DOCX)", { type: "string", format: "binary" }, ["artifactId"]);
const upload = { ...read("Загрузить приватное изображение без повышения ревизии", "kp:media:write", { type: "object", properties: { mediaId: id, reference: { type: "string" } } }),
  requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["documentId", "operationId", "expectedRevision", "file"],
    properties: { documentId: id, operationId, expectedRevision: revision, file: { type: "string", format: "binary" }, optimized: { type: "string", format: "binary" } } } } } } };
export const kpApiPaths = {
  "/kp/documents": {
    get: read("Список КП с курсорной пагинацией", "kp:read", { type: "object", required: ["documents", "nextCursor"], properties: {
      documents: { type: "array", items: { type: "object", properties: { id, revision, number: nullableString, printedClientName: nullableString } } }, nextCursor: nullableString } }, [],
    [query("q", { type: "string" }), query("cursor", id), query("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 }), query("archive", { enum: ["include", "only", "exclude"], default: "include" })]),
    post: command("Создать КП, проект Лид и состав одной транзакцией", "kp:write", ref("KpCreateDocument"), ref("KpDocument")),
  },
  "/kp/documents/{documentId}": { get: read("Прочитать текущее КП", "kp:read", ref("KpDocument"), ["documentId"]),
    put: command("Полностью сохранить КП и синхронизировать CRM в Лиде", "kp:write", ref("KpSaveDocument"), ref("KpDocument"), ["documentId"]) },
  "/kp/documents/{documentId}/pdf": { post: command("Выпустить PDF сохранённой ревизии", "kp:export", release, ref("KpJob"), ["documentId"]) },
  "/kp/documents/{documentId}/versions": { get: read("Список успешных выпусков КП", "kp:read", versionList, ["documentId"]) },
  "/kp/documents/{documentId}/versions/{versionId}": { get: read("Прочитать снимок выпуска", "kp:read", { type: "object", properties: { version: ref("KpVersion"), document: ref("KpDocument") } }, ["documentId", "versionId"]) },
  "/kp/documents/{documentId}/versions/{versionId}/restore": { post: command("Восстановить выпуск как текущее КП в Лиде", "kp:write", release, ref("KpDocument"), ["documentId", "versionId"]) },
  "/kp/uploads": { post: upload },
  "/kp/documents/{documentId}/media/{mediaId}": { get: read("Прочитать приватное изображение", "kp:read", { type: "string", format: "binary" }, ["documentId", "mediaId"],
    [query("variant", { enum: ["original", "optimized"], default: "optimized" }), query("scope", { enum: ["uploaded", "current", "version"], default: "current" }), query("versionId", id)]) },
  "/kp/operations/{operationId}": { get: read("Прочитать неизменяемый результат собственной команды", "scope исходной команды", { type: "object", required: ["operationId", "kind", "result"], properties: { operationId, kind: { type: "string" }, result: {} } }, ["operationId"]) },
  "/kp/jobs/{jobId}": { get: read("Прочитать выполнение задания", "kp:read (PDF) / kp:contracts:read (CONTRACT)", ref("KpJob"), ["jobId"]) },
  "/kp/artifacts/{artifactId}/download": { get: { ...download, responses: { ...download.responses, "200": { description: "Приватный документ", content: { "application/pdf": { schema: { type: "string", format: "binary" } },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { schema: { type: "string", format: "binary" } } } } } } },
  "/kp/clients": { get: read("Найти клиентов CRM", "kp:read", { type: "object", properties: { clients: { type: "array", items: record } } }, [], [query("q", { type: "string" }), query("limit", { type: "integer", minimum: 1, maximum: 100, default: 30 })]),
    post: command("Создать обычного клиента CRM", "kp:write", { type: "object", required: ["operationId", "name", "phone"], properties: {
      operationId, ...Object.fromEntries(Object.keys(clientProperties).map(name => [name, { type: "string" }])) }, additionalProperties: false }, clientDetails) },
  "/kp/clients/{clientId}": { get: read("Прочитать структурный снимок клиента", "kp:read", clientDetails, ["clientId"]) },
  "/kp/rates": { get: read("Получить НБРБ на точную дату без изменения КП", "kp:read", { type: "object", properties: { fx: ref("KpFx") } }, [], [query("currency", { enum: ["BYN", "RUB", "USD", "EUR"] }, true), query("date", { type: "string", format: "date" }, true)]) },
  "/kp/contracts/{documentId}": { get: read("Открыть форму договора основного КП", "kp:contracts:read", contractForm, ["documentId"]),
    put: command("Сохранить настройки договора", "kp:contracts:write", ref("KpContractSave"), { type: "object", properties: { contractId: id, revision, sourceRefs: sources, clientBaseline: { type: "string" } } }, ["documentId"]) },
  "/kp/contracts/{documentId}/versions": { get: read("История DOCX, включая архив", "kp:contracts:read", { type: "object", properties: { versions: { type: "array", items: { type: "object", properties: { id, createdAt: { type: "string", format: "date-time" }, docxArtifactId: id, fileName: { type: "string" } } } } } }, ["documentId"]) },
  "/kp/contracts/{documentId}/generate": { post: command("Выпустить договор; ранние проекты переходят в Договор, черновики в Подготовку", "kp:contracts:generate", ref("KpContractGenerate"), ref("KpJob"), ["documentId"]) },
} as const;
