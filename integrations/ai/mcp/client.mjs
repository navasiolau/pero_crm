import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export class KpApiError extends Error {
  constructor(code, message, status = 0, operationId) {
    super(message);
    this.name = 'KpApiError';
    this.code = code;
    this.status = status;
    this.operationId = operationId;
  }
}

const fail = (code, message, status = 0) => { throw new KpApiError(code, message, status); };
export function checkedId(value) {
  if (typeof value !== 'string' || !identifier.test(value) || value === '.' || value === '..') fail('KP_ID_INVALID', 'Нужен ID документа из API CRM.');
  return encodeURIComponent(value);
}
export function operationId(value = randomUUID()) {
  if (typeof value !== 'string' || !uuid.test(value)) fail('KP_OPERATION_INVALID', 'Идентификатор операции должен быть UUID.');
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('KP_REVISION_REQUIRED', 'Нужна ревизия свежего документа из CRM.');
  return value;
}

export function apiRoot(value) {
  let url;
  try { url = new URL(value); } catch { fail('KP_CONFIG_INVALID', 'Задайте PERO_CRM_API_URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !local)) {
    fail('KP_CONFIG_INVALID', 'Нужен HTTPS-адрес CRM без ключей в URL; HTTP допустим только для localhost.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/api/v1/kp') ? path : path + '/api/v1/kp';
  return url.toString().replace(/\/+$/, '');
}

export class KpApiClient {
  constructor({ baseUrl, key, timeoutMs = 40_000, fetchImpl = globalThis.fetch }) {
    this.root = apiRoot(baseUrl);
    if (typeof key !== 'string' || !key.trim() || /\s/.test(key)) fail('KP_KEY_REQUIRED', 'Задайте специальный PERO_CRM_API_KEY; старый API_KEYS генератора не подходит.');
    this.key = key;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(method, path, body, { binary = false, form = false } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) fail('KP_PATH_INVALID', 'Некорректный путь API.');
    const url = new URL(this.root + path);
    if (url.origin !== new URL(this.root).origin || !url.pathname.startsWith(new URL(this.root).pathname + '/')) fail('KP_PATH_INVALID', 'Запрос за пределы API CRM отклонён.');
    let response;
    try {
      response = await this.fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: `Bearer ${this.key}`, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
    } catch {
      throw new KpApiError('KP_NETWORK_ERROR', 'Сетевая ошибка или тайм-аут API CRM.');
    }
    if (!response.ok) {
      let data;
      try { data = await response.json(); } catch { data = undefined; }
      const code = typeof data?.error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(data.error.code) ? data.error.code : `KP_HTTP_${response.status}`;
      let message = typeof data?.error?.message === 'string' ? data.error.message : `API CRM вернул HTTP ${response.status}.`;
      message = message.split(this.key).join('[ключ скрыт]').slice(0, 1000);
      throw new KpApiError(code, message, response.status);
    }
    if (binary) return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || 'application/octet-stream' };
    try { return await response.json(); }
    catch { throw new KpApiError('KP_RESPONSE_INVALID', 'API CRM вернул некорректный JSON.'); }
  }

  async command(method, path, input) {
    const id = operationId(input.operationId);
    try { return { ...(await this.request(method, path, { ...input, operationId: id })), operationId: id }; }
    catch (error) {
      if (!(error instanceof KpApiError) || (error.status > 0 && error.status < 500)) throw error;
      try {
        const receipt = await this.getOperation(id);
        return { ...(receipt.result ?? receipt), operationId: id, recoveredAfterError: true };
      } catch {
        throw new KpApiError('KP_OUTCOME_UNKNOWN', 'Результат записи не подтверждён. Прочитайте операцию по operationId; повторное создание не выполнялось.', 0, id);
      }
    }
  }

  listDocuments(query = '') { return this.request('GET', '/documents' + (query ? `?q=${encodeURIComponent(query)}` : '')); }
  getDocument(id) { return this.request('GET', `/documents/${checkedId(id)}`); }
  findClients(query = '') { return this.request('GET', '/clients' + (query ? `?q=${encodeURIComponent(query)}` : '')); }
  getClient(id) { return this.request('GET', `/clients/${checkedId(id)}`); }
  getOperation(id) { return this.request('GET', `/operations/${operationId(id)}`); }
  listVersions(id) { return this.request('GET', `/documents/${checkedId(id)}/versions`); }
  getVersion(id, versionId) { return this.request('GET', `/documents/${checkedId(id)}/versions/${checkedId(versionId)}`); }
  getJob(id) { return this.request('GET', `/jobs/${checkedId(id)}`); }
  getContract(id) { return this.request('GET', `/contracts/${checkedId(id)}`); }

  async save({ id, state, expectedRevision, operationId: requestId, clientId, fx, expectedNumber, basedOn }) {
    if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.items)) fail('KP_STATE_INVALID', 'Нужно полное состояние КП с массивом items. Для правки сначала прочитайте текущий документ.');
    if (id && basedOn) fail('KP_TEMPLATE_INVALID', 'Шаблон применяется только к новому КП.');
    let next = structuredClone(state);
    if (basedOn) {
      const template = await this.getDocument(basedOn);
      const base = template.state || {};
      next = { ...Object.fromEntries(['header', 'footer', 'intro', 'manager', 'payment', 'warrantyMonths', 'currency', 'totalNote'].filter(k => Object.hasOwn(base, k)).map(k => [k, structuredClone(base[k])])), ...next };
    }
    if (id) {
      return this.command('PUT', `/documents/${checkedId(id)}`, { state: next, expectedRevision: revision(expectedRevision), operationId: requestId, ...(clientId ? { clientId } : {}), ...(fx ? { fx } : {}) });
    }
    next.items = next.items.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('KP_STATE_INVALID', 'Каждая позиция должна быть объектом.');
      const copy = { ...item };
      delete copy.id;
      for (const slot of ['image', 'image2']) if (typeof copy[slot] === 'string' && copy[slot].startsWith('kp-media:')) fail('KP_MEDIA_OWNER_REQUIRED', 'Для нового КП сначала создайте пустой документ, затем загрузите в него изображения.');
      return copy;
    });
    const number = expectedNumber;
    if (number !== undefined && (!Number.isSafeInteger(number) || number <= 0)) fail('KP_NUMBER_INVALID', 'Ожидаемый номер должен быть положительным целым числом.');
    return this.command('POST', '/documents', { state: next, operationId: requestId, ...(clientId ? { clientId } : {}), ...(fx ? { fx } : {}), ...(number === undefined ? {} : { expectedNumber: number }) });
  }

  restore(id, versionId, expectedRevision, requestId) {
    return this.command('POST', `/documents/${checkedId(id)}/versions/${checkedId(versionId)}/restore`, { expectedRevision: revision(expectedRevision), operationId: requestId });
  }
  generatePdf(id, expectedRevision, requestId) {
    return this.command('POST', `/documents/${checkedId(id)}/pdf`, { expectedRevision: revision(expectedRevision), operationId: requestId });
  }
  saveContract(id, settings, expectedRevision, clientBaseline, sourceRefs, requestId) {
    return this.command('PUT', `/contracts/${checkedId(id)}`, { documentId: id, settings, expectedRevision: revision(expectedRevision), clientBaseline, sourceRefs, operationId: requestId });
  }
  generateContract(id, expectedRevision, sourceRefs, clientBaseline, requestId) {
    return this.command('POST', `/contracts/${checkedId(id)}/generate`, { documentId: id, expectedRevision: revision(expectedRevision), sourceRefs, clientBaseline, operationId: requestId });
  }

  async waitJob(id, { timeoutMs = 0, intervalMs = 1000 } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(intervalMs) || intervalMs < 1) fail('KP_JOB_WAIT_INVALID', 'Некорректные параметры ожидания задания.');
    const deadline = timeoutMs === 0 ? null : Date.now() + timeoutMs;
    while (true) {
      const job = await this.getJob(id);
      const state = job.state ?? job.status;
      if (state === 'SUCCEEDED') return job;
      if (state === 'FAILED' || state === 'CANCELLED') throw new KpApiError(job.error?.code || 'KP_JOB_FAILED', job.error?.message || 'Выпуск документа не завершён.');
      if (deadline !== null && Date.now() >= deadline) throw new KpApiError('KP_JOB_PENDING', 'Выпуск ещё выполняется; продолжите чтение того же jobId.');
      await new Promise(resolve => setTimeout(resolve, deadline === null ? intervalMs : Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
    }
  }

  async upload({ documentId, file, optimized, expectedRevision, operationId: requestId }) {
    const document = await this.getDocument(documentId);
    if (!document.canEdit) fail('KP_PROJECT_NOT_LEAD', 'Редактирование КП разрешено только для проекта в статусе «Лид».', 409);
    const original = await readImage(file);
    const prepared = optimized ? await readImage(optimized) : null;
    if (prepared && prepared.mimeType !== 'image/jpeg') fail('KP_OPTIMIZED_INVALID', 'Подготовленное изображение должно быть JPEG.');
    const id = operationId(requestId);
    const body = new FormData();
    body.append('documentId', documentId);
    body.append('operationId', id);
    body.append('expectedRevision', String(revision(expectedRevision ?? document.revision)));
    body.append('file', new Blob([original.bytes], { type: original.mimeType }), original.name);
    if (prepared) body.append('optimized', new Blob([prepared.bytes], { type: prepared.mimeType }), prepared.name);
    let result;
    try { result = await this.request('POST', '/uploads', body, { form: true }); }
    catch (error) {
      if (error instanceof KpApiError && (error.status === 0 || error.status >= 500)) {
        try { const receipt = await this.getOperation(id); return { ...(receipt.result ?? receipt), operationId: id, recoveredAfterError: true }; }
        catch { throw new KpApiError('KP_OUTCOME_UNKNOWN', 'Исход загрузки неизвестен. Проверьте operationId; повторная загрузка не выполнялась.', 0, id); }
      }
      throw error;
    }
    return { ...result, operationId: id, originalSha256: createHash('sha256').update(original.bytes).digest('hex') };
  }

  downloadArtifact(id) { return this.request('GET', `/artifacts/${checkedId(id)}/download`, undefined, { binary: true }); }
  downloadMedia(documentId, mediaId, { variant = 'optimized', scope = 'current', versionId } = {}) {
    if (!['original', 'optimized'].includes(variant) || !['uploaded', 'current', 'version'].includes(scope)) fail('KP_MEDIA_SCOPE_INVALID', 'Неизвестный вариант изображения.');
    const query = new URLSearchParams({ variant, scope });
    if (scope === 'version') query.set('versionId', decodeURIComponent(checkedId(versionId)));
    return this.request('GET', `/documents/${checkedId(documentId)}/media/${checkedId(mediaId)}?${query}`, undefined, { binary: true });
  }
}

async function readImage(path) {
  const info = await stat(path).catch(() => fail('KP_FILE_UNAVAILABLE', 'Не удалось прочитать указанный файл изображения.'));
  if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) fail('KP_IMAGE_SIZE_INVALID', 'Нужен непустой файл изображения до 15 МиБ.');
  const bytes = await readFile(path);
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) fail('KP_IMAGE_SIZE_INVALID', 'Нужен непустой файл изображения до 15 МиБ.');
  let mimeType;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mimeType = 'image/jpeg';
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mimeType = 'image/webp';
  if (!mimeType) fail('KP_IMAGE_TYPE_INVALID', 'Поддерживаются JPEG, PNG и WebP.');
  return { bytes, mimeType, name: String(path).split(/[\\/]/).pop() || 'image' };
}
