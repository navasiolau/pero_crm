#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KpApiClient, KpApiError } from './client.mjs';

const string = { type: 'string', minLength: 1 };
const integer = { type: 'integer', minimum: 0 };
const sourceRefs = { type: 'array', minItems: 1, maxItems: 30, items: {
  type: 'object', properties: { proposalId: string, expectedRevision: integer }, required: ['proposalId', 'expectedRevision'], additionalProperties: false,
} };
const tools = [];
const handlers = new Map();
function tool(name, description, properties, required, handler, readOnly = true) {
  tools.push({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: readOnly, destructiveHint: ['kp_save_document', 'kp_restore_version', 'kp_generate_contract'].includes(name), idempotentHint: true, openWorldHint: false } });
  handlers.set(name, handler);
}
const op = { operationId: { ...string, format: 'uuid', description: 'Один UUID для одной операции. Сохраните до вызова; после тайм-аута проверяйте тот же UUID.' } };
const document = { documentId: string };
const version = { ...document, versionId: string };
tool('kp_list_documents', 'Список доступных КП CRM. Номер нового КП выдаёт сервер вместе с проектом «Лид».', { query: { type: 'string' } }, [], (c, a) => c.listDocuments(a.query));
tool('kp_get_document', 'Читать полное текущее КП, ревизию, клиента, проект и canEdit. Перед изменением всегда читать заново.', document, ['documentId'], (c, a) => c.getDocument(a.documentId));
tool('kp_find_clients', 'Искать выбранного клиента в CRM; служебную карточку «Временный» заполнять нельзя.', { query: { type: 'string' } }, [], (c, a) => c.findClients(a.query));
tool('kp_get_client', 'Читать реквизиты выбранного клиента CRM.', { clientId: string }, ['clientId'], (c, a) => c.getClient(a.clientId));
tool('kp_save_document', 'Создать КП и проект либо полностью сохранить существующее КП в «Лиде». Полный снимок перезаписывает коммерческие поля CRM и скрывает отсутствующие изделия. При правке сохранить ID всех прежних позиций. Не передавать старые ID и медиа в новое КП.', {
  documentId: string, state: { type: 'object', description: 'Полное state из свежего GET с внесёнными правками; items[].id стабильны.' }, expectedRevision: integer,
  clientId: string, fx: { type: 'object', properties: { currency: { enum: ['BYN', 'RUB', 'USD', 'EUR'] }, rate: string, date: string, source: { enum: ['NBRB', 'MANUAL'] } }, required: ['currency', 'rate', 'date', 'source'], additionalProperties: false },
  expectedNumber: { type: 'integer', minimum: 1, description: 'Необязательное ожидание; конфликт откатывает создание. Сам номер назначает CRM.' },
  basedOn: { ...string, description: 'ID образца только оформления для нового КП. Изделия, клиент и изображения не копируются.' }, ...op,
}, ['state', 'operationId'], (c, a) => c.save({ ...a, id: a.documentId }), false);
tool('kp_upload_image', 'Загрузить приватное изображение в существующее редактируемое КП (JPEG/PNG/WebP до 15 МиБ). Результат mediaId/token вставить в image/image2 и отдельно сохранить полное КП. URL S3 не используются.', {
  ...document, file: { ...string, description: 'Абсолютный локальный путь оригинала.' }, optimized: { ...string, description: 'Необязательный готовый JPEG; сохраняется без повторного сжатия.' }, expectedRevision: integer, ...op,
}, ['documentId', 'file', 'expectedRevision', 'operationId'], (c, a) => c.upload(a), false);
tool('kp_list_versions', 'Сохранённые выпуски появляются после успешного PDF или договора. Время отображается по Москве.', document, ['documentId'], (c, a) => c.listVersions(a.documentId));
tool('kp_get_version', 'Читать неизменяемый снимок прежнего выпуска КП.', version, ['documentId', 'versionId'], (c, a) => c.getVersion(a.documentId, a.versionId));
tool('kp_restore_version', 'Явно восстановить прежний выпуск как текущий КП. Только «Лид»; полностью синхронизирует клиента, коммерческие поля и активный состав CRM.', { ...version, expectedRevision: integer, ...op }, ['documentId', 'versionId', 'expectedRevision', 'operationId'], (c, a) => c.restore(a.documentId, a.versionId, a.expectedRevision, a.operationId), false);
tool('kp_generate_pdf', 'Выпустить PDF сохранённой ревизии. Возвращает задание; готовый выпуск появляется только после успеха. Произвольный state не принимается.', { ...document, expectedRevision: integer, ...op }, ['documentId', 'expectedRevision', 'operationId'], (c, a) => c.generatePdf(a.documentId, a.expectedRevision, a.operationId), false);
tool('kp_get_contract', 'Открыть форму договора и получить реквизиты клиента, settings, ревизию, sourceRefs и clientBaseline. Договор редактируется независимо от блокировки КП.', document, ['documentId'], (c, a) => c.getContract(a.documentId));
tool('kp_save_contract', 'Сохранить настройки договора с реквизитами из свежего GET. Не меняет этапы. Клиентскую карточку не изменяет.', { ...document, settings: { type: 'object' }, expectedRevision: integer, clientBaseline: string, sourceRefs, ...op }, ['documentId', 'settings', 'expectedRevision', 'clientBaseline', 'sourceRefs', 'operationId'], (c, a) => c.saveContract(a.documentId, a.settings, a.expectedRevision, a.clientBaseline, a.sourceRefs, a.operationId), false);
tool('kp_generate_contract', 'Выпустить договор и PDF всех включённых КП. ПОСЛЕ УСПЕХА проекты в «Лиде»/«Просчёте» автоматически переходят в «Договор», их черновики — в «Подготовку»; редактирование КП закрывается. Продвинутые проекты назад не возвращаются. Использовать только по поручению выпустить договор.', { ...document, expectedRevision: integer, clientBaseline: string, sourceRefs, ...op }, ['documentId', 'expectedRevision', 'clientBaseline', 'sourceRefs', 'operationId'], (c, a) => c.generateContract(a.documentId, a.expectedRevision, a.sourceRefs, a.clientBaseline, a.operationId), false);
tool('kp_get_job', 'Проверить задание генерации и получить ID приватных PDF/DOCX после успеха.', { jobId: string }, ['jobId'], (c, a) => c.getJob(a.jobId));
tool('kp_get_operation', 'После тайм-аута проверить прежний operationId и получить прежний результат без повторного создания.', op, ['operationId'], (c, a) => c.getOperation(a.operationId));
tool('kp_download_artifact', 'Скачать приватный PDF/DOCX по artifactId в новый локальный файл внутри PERO_KP_WORKSPACE (по умолчанию E:\\KP). Не перезаписывает существующие файлы.', { artifactId: string, path: string }, ['artifactId', 'path'], async (c, a, options) => saveDownload(await c.downloadArtifact(a.artifactId), a.path, options.workspace), false);
tool('kp_download_image', 'Скачать приватное изображение для локального архива. Исходники/оптимизированные изображения КП доступны в пределах срока хранения.', { ...document, mediaId: string, variant: { enum: ['original', 'optimized'] }, scope: { enum: ['uploaded', 'current', 'version'] }, versionId: string, path: string }, ['documentId', 'mediaId', 'path'], async (c, a, options) => saveDownload(await c.downloadMedia(a.documentId, a.mediaId, a), a.path, options.workspace), false);

async function saveDownload(result, target, workspace) {
  const root = await realpath(workspace);
  const path = resolve(root, target);
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new KpApiError('KP_PATH_INVALID', 'Файл должен находиться внутри PERO_KP_WORKSPACE.');
  let cursor = root;
  for (const segment of relative(root, dirname(path)).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    let info;
    try { info = await lstat(cursor); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new KpApiError('KP_PATH_INVALID', 'Каталог назначения содержит ссылку или занят файлом.');
    if (!info) await mkdir(cursor);
    const resolved = relative(root, await realpath(cursor));
    if (resolved === '..' || resolved.startsWith('..' + sep) || isAbsolute(resolved)) throw new KpApiError('KP_PATH_INVALID', 'Каталог назначения находится за пределами рабочего каталога.');
  }
  const parent = await realpath(dirname(path));
  const actualRel = relative(root, parent);
  if (actualRel === '..' || actualRel.startsWith('..' + sep) || isAbsolute(actualRel)) throw new KpApiError('KP_PATH_INVALID', 'Ссылка каталога ведёт за пределы рабочего каталога.');
  await writeFile(path, result.bytes, { flag: 'wx' });
  return { path, bytes: result.bytes.length, mimeType: result.mimeType };
}

function validateCall(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new KpApiError('KP_ARGUMENTS_INVALID', 'Нужен объект аргументов инструмента.');
  for (const key of Object.keys(args)) if (!Object.hasOwn(schema.properties, key)) throw new KpApiError('KP_ARGUMENTS_INVALID', `Неизвестный аргумент: ${key}.`);
  for (const key of schema.required) if (args[key] === undefined) throw new KpApiError('KP_ARGUMENTS_INVALID', `Нужен аргумент: ${key}.`);
  for (const [key, value] of Object.entries(args)) {
    const field = schema.properties[key];
    if (field.enum && !field.enum.includes(value)) throw new KpApiError('KP_ARGUMENTS_INVALID', `Недопустимый аргумент: ${key}.`);
    if (field.type === 'string' && (typeof value !== 'string' || (field.minLength && value.length < field.minLength))) throw new KpApiError('KP_ARGUMENTS_INVALID', `Нужна строка: ${key}.`);
    if (field.type === 'integer' && (!Number.isSafeInteger(value) || value < field.minimum)) throw new KpApiError('KP_ARGUMENTS_INVALID', `Нужно целое число: ${key}.`);
    if (field.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new KpApiError('KP_ARGUMENTS_INVALID', `Нужен объект: ${key}.`);
    if (field.type === 'array' && (!Array.isArray(value) || value.length < field.minItems || value.length > field.maxItems)) throw new KpApiError('KP_ARGUMENTS_INVALID', `Нужен массив: ${key}.`);
  }
}

export async function handleMessage(message, client, options = {}) {
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  if (message.id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize') return reply({ protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'pero-crm-kp', version: '1.0.0' }, instructions: 'КП редактируется только в «Лиде». Выпуск договора автоматически переводит связанные проекты в «Договор». После тайм-аута читайте operationId. Номер назначает CRM.' });
  if (message.method === 'ping') return reply({});
  if (message.method === 'tools/list') return reply({ tools });
  if (message.method !== 'tools/call') return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  const definition = tools.find(item => item.name === message.params?.name);
  if (!definition) return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown tool' } };
  try {
    const args = message.params.arguments ?? {};
    validateCall(definition.inputSchema, args);
    const value = await handlers.get(definition.name)(client, args, { workspace: options.workspace || process.env.PERO_KP_WORKSPACE || 'E:\\KP' });
    return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
  } catch (error) {
    const safe = error instanceof KpApiError ? { code: error.code, message: error.message, ...(error.operationId ? { operationId: error.operationId } : {}) } : { code: 'KP_TOOL_FAILED', message: 'Операция не завершена. Проверьте файл, аргументы и результат операции в CRM.' };
    return reply({ content: [{ type: 'text', text: JSON.stringify(safe) }], isError: true });
  }
}

async function main() {
  const client = new KpApiClient({ baseUrl: process.env.PERO_CRM_API_URL, key: process.env.PERO_CRM_API_KEY });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Последовательно: следующий инструмент видит результат предыдущего сохранения.
  for await (const line of input) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > 2 * 1024 * 1024) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }) + '\n'); continue; }
    let message;
    try { message = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
    const response = await handleMessage(message, client);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('Не удалось запустить MCP. Проверьте PERO_CRM_API_URL и PERO_CRM_API_KEY.\n'); process.exitCode = 1; });
