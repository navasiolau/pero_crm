import { getKpTemplateIdentity, KP_RENDER_LIMITS, type SavedProposalRenderInput, type SavedContractRenderInput, type InternalRenderOutput } from '@pero/kp-template';
import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PDF_MAX_BYTES, responseChunks, spoolPdf, type PdfStreamAsset } from './pdf-io';

type RendererOptions = { fetcher?: typeof fetch; baseUrl?: string; secret?: string; signal?: AbortSignal };
async function requestRenderer(input: unknown, options: RendererOptions): Promise<InternalRenderOutput> {
  const base = new URL(options.baseUrl ?? process.env.PERO_KP_RENDERER_URL ?? 'http://kp-renderer:3100');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('KP_RENDERER_CONFIGURATION_INVALID');
  const secret = options.secret ?? process.env.PERO_KP_RENDERER_SECRET;
  if (!secret || secret.length < 32) throw Error('KP_RENDERER_SECRET_REQUIRED');
  const isDocx = !!input && typeof input === 'object' && 'kind' in input && input.kind === 'docx';
  const body = JSON.stringify(input), maxJsonBytes = isDocx ? KP_RENDER_LIMITS.docxRequestBytes : KP_RENDER_LIMITS.requestBytes;
  if (Buffer.byteLength(body) > maxJsonBytes) throw Error('KP_RENDERER_REQUEST_LIMIT');
  const headers = { 'content-type': 'application/json', 'x-pero-renderer-key': secret, 'x-pero-renderer-kind': isDocx ? 'docx' : 'pdf' };
  const response = options.fetcher ? await options.fetcher(new URL('/v1/render', base), { method: 'POST', headers, body, signal: options.signal, cache: 'no-store', redirect: 'error' }) :
    await new Promise<Response>((resolve, reject) => {
      const request = (base.protocol === 'https:' ? httpsRequest : httpRequest)(new URL('/v1/render', base), { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, signal: options.signal, agent: false }, message => {
        const replyHeaders = new Headers(); for (const [key, value] of Object.entries(message.headers)) if (value !== undefined) replyHeaders.set(key, Array.isArray(value) ? value.join(',') : value);
        resolve(new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, { status: message.statusCode, headers: replyHeaders }));
      });
      request.setTimeout(0); request.on('socket', socket => socket.setTimeout(0)); request.once('error', reject); request.end(body);
    });
  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => null);
    const code = failure && typeof failure === 'object' && 'error' in failure &&
      typeof failure.error === 'string' && ['KP_RENDER_BUSY', 'KP_RENDER_TIMEOUT', 'KP_RENDER_BYTES_LIMIT', 'KP_RENDER_INPUT_INVALID', 'KP_RENDER_WORKER_FAILED', 'KP_RENDER_BROWSER_FAILED', 'KP_RENDER_FONT_MISSING'].includes(failure.error)
      ? failure.error : 'KP_RENDER_FAILED';
    const status = code === 'KP_RENDER_BUSY' ? 503 : code === 'KP_RENDER_TIMEOUT' ? 504 : ['KP_RENDER_WORKER_FAILED', 'KP_RENDER_BROWSER_FAILED', 'KP_RENDER_FAILED'].includes(code) ? 502 : response.status;
    throw Object.assign(Error(response.status === 429 ? 'Рендер занят. Повторите генерацию позже' : 'Не удалось сформировать документ'), { code, status });
  }
  const reader = response.body?.getReader(); if (!reader) throw Error('KP_RENDERER_RESPONSE_EMPTY');
  let size = 0; const chunks: Buffer[] = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > maxJsonBytes) { await reader.cancel(); throw Error('KP_RENDERER_RESPONSE_LIMIT'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || !('kind' in value) || !('pageCount' in value) || !('templateHash' in value) ||
    !Number.isSafeInteger(value.pageCount) || Number(value.pageCount) < 1 || value.templateHash !== getKpTemplateIdentity().templateHash) throw Error('KP_RENDERER_RESPONSE_INVALID');
  return value as InternalRenderOutput;
}
function decode(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('KP_RENDERER_RESPONSE_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > max || bytes.toString('base64') !== value) throw Error('KP_RENDERER_RESPONSE_INVALID');
  return bytes;
}
/** Вызывать после чтения сохранённого снимка, вне транзакции публикации. */
export async function renderProposalPdf(input: SavedProposalRenderInput, options: RendererOptions = {}) {
  const result = await requestRenderer(input, options);
  if (result.kind !== 'pdf') throw Error('KP_RENDERER_RESPONSE_INVALID');
  const bytes = decode(result.bytesBase64, KP_RENDER_LIMITS.pdfBytes);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('KP_RENDERER_RESPONSE_INVALID');
  return { bytes, pageCount: result.pageCount, templateHash: result.templateHash };
}

export type StreamedProposalRenderInput = Omit<SavedProposalRenderInput, 'assets'> & { assets: PdfStreamAsset[] };
/** Реальный PDF RPC использует Node HTTP: нет скрытых 300-секундных headers/body deadlines undici. */
export async function renderProposalPdfStream(input: StreamedProposalRenderInput, options: RendererOptions = {}) {
  const base = new URL(options.baseUrl ?? process.env.PERO_KP_RENDERER_URL ?? 'http://kp-renderer:3100');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('KP_RENDERER_CONFIGURATION_INVALID');
  const secret = options.secret ?? process.env.PERO_KP_RENDERER_SECRET;
  if (!secret || secret.length < 32) throw Error('KP_RENDERER_SECRET_REQUIRED');
  const abort = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
  const manifest = Buffer.from(JSON.stringify({ protocol: 1, ...input, kind: 'pdf', assets: input.assets.map(({ mediaId, mimeType, size, sha256 }) => ({ mediaId, mimeType, size, sha256 })) }));
  let contentLength = 4 + manifest.length;
  if (new Set(input.assets.map(asset => asset.mediaId)).size !== input.assets.length) throw Error('KP_RENDERER_ASSET_INVALID');
  for (const asset of input.assets) {
    if (!Number.isSafeInteger(asset.size) || asset.size < 1 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('KP_RENDERER_ASSET_INVALID');
    contentLength += asset.size;
  }
  if (!Number.isSafeInteger(contentLength) || contentLength > PDF_MAX_BYTES) throw Error('KP_RENDERER_REQUEST_LIMIT');
  async function* framed() {
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(manifest.length); signal.throwIfAborted(); yield prefix; yield manifest;
    for (const asset of input.assets) {
      signal.throwIfAborted(); const source = await asset.openRead(signal), hash = createHash('sha256'); let size = 0;
      for await (const chunk of source) {
        signal.throwIfAborted(); if (!(chunk instanceof Uint8Array) || (size += chunk.byteLength) > asset.size) throw Error('KP_RENDERER_ASSET_CHANGED');
        hash.update(chunk); yield chunk;
      }
      if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw Error('KP_RENDERER_ASSET_CHANGED');
    }
  }
  const headers = { 'content-type': 'application/vnd.pero.kp-pdf.v1', 'content-length': String(contentLength), 'x-pero-renderer-key': secret };
  let message: IncomingMessage | undefined, request: ReturnType<typeof httpRequest> | undefined;
  let requestBody: ReadableStream<Uint8Array> | undefined, responseBody: ReadableStream<Uint8Array> | undefined;
  let upload: Promise<void> | undefined;
  try {
    let responseHeaders: Headers, status: number, body: AsyncIterable<Uint8Array>;
    if (options.fetcher) {
      const stream = Readable.toWeb(Readable.from(framed(), { signal })) as ReadableStream<Uint8Array>; requestBody = stream;
      const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: stream, duplex: 'half', signal, cache: 'no-store', redirect: 'error' };
      const response = await options.fetcher(new URL('/v1/render', base), init);
      if (!response.body) throw Error('KP_RENDERER_RESPONSE_EMPTY');
      responseHeaders = response.headers; status = response.status; responseBody = response.body; body = responseChunks(response.body, signal);
    } else {
      const received = new Promise<IncomingMessage>((resolve, reject) => {
        request = (base.protocol === 'https:' ? httpsRequest : httpRequest)(new URL('/v1/render', base), { method: 'POST', headers, signal, agent: false }, resolve);
        request.setTimeout(0); request.on('socket', socket => socket.setTimeout(0)); request.once('error', reject);
      });
      upload = pipeline(Readable.from(framed()), request!, { signal }); void upload.catch(() => {});
      message = await received; status = message.statusCode ?? 0; responseHeaders = new Headers();
      for (const [key, value] of Object.entries(message.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(',') : value);
      if (status === 200) await upload;
      body = message;
    }
    if (status !== 200) throw Error(status === 429 ? 'KP_RENDERER_BUSY' : 'KP_RENDERER_PDF_FAILED');
    const size = Number(responseHeaders.get('content-length')), pageCount = Number(responseHeaders.get('x-pero-render-page-count'));
    const sha256 = responseHeaders.get('x-pero-content-sha256') ?? '', templateHash = responseHeaders.get('x-pero-template-hash');
    if (responseHeaders.get('content-type')?.split(';')[0] !== 'application/pdf' || !Number.isSafeInteger(size) || size < 5 || size > PDF_MAX_BYTES ||
      !Number.isSafeInteger(pageCount) || pageCount < 1 || !/^[a-f0-9]{64}$/.test(sha256) || templateHash !== input.templateHash || templateHash !== getKpTemplateIdentity().templateHash) throw Error('KP_RENDERER_RESPONSE_INVALID');
    const file = await spoolPdf(body, { size, sha256 }, signal);
    return { file, pageCount, templateHash };
  } finally { abort.abort(); message?.destroy(); request?.destroy(); if (requestBody && !requestBody.locked) await requestBody.cancel().catch(() => {}); if (responseBody && !responseBody.locked) await responseBody.cancel().catch(() => {}); await upload?.catch(() => {}); }
}
/** Свежий договор получает исходные DPR2-приложения и PDF из одного page/context. */
export async function renderProposalBundle(input: SavedProposalRenderInput, options: RendererOptions = {}) {
  const result = await requestRenderer({ ...input, kind: 'bundle' }, options);
  if (result.kind !== 'bundle' || !Array.isArray(result.pagesBase64) || result.pagesBase64.length !== result.pageCount) throw Error('KP_RENDERER_RESPONSE_INVALID');
  const bytes = decode(result.bytesBase64, KP_RENDER_LIMITS.pdfBytes), pages = result.pagesBase64.map(page => decode(page, KP_RENDER_LIMITS.assetBytes));
  if (bytes.subarray(0, 5).toString() !== '%PDF-' || bytes.length + pages.reduce((sum, page) => sum + page.length, 0) > KP_RENDER_LIMITS.totalAssetBytes ||
    pages.some(page => !page.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) throw Error('KP_RENDERER_RESPONSE_INVALID');
  return { bytes, pages, pageCount: result.pageCount, templateHash: result.templateHash };
}
/** Приложения договора используют уже выпущенный PDF после очистки изображений. */
export async function rasterizeRetainedPdf(bytes: Buffer, options: RendererOptions = {}) {
  if (bytes.length > KP_RENDER_LIMITS.pdfBytes || bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('KP_RENDERER_PDF_INVALID');
  const result = await requestRenderer({ kind: 'rasterize', pdfBase64: bytes.toString('base64') }, options);
  if (result.kind !== 'rasterize' || !Array.isArray(result.pagesBase64) || result.pagesBase64.length !== result.pageCount) throw Error('KP_RENDERER_RESPONSE_INVALID');
  const pages = result.pagesBase64.map(page => decode(page, KP_RENDER_LIMITS.rasterPageBytes));
  if (pages.reduce((sum, page) => sum + page.length, 0) > KP_RENDER_LIMITS.totalAssetBytes || pages.some(page => !page.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) throw Error('KP_RENDERER_RESPONSE_INVALID');
  return { pages, pageCount: result.pageCount, templateHash: result.templateHash };
}

/** Все условия и страницы приложений приходят из замороженного серверного снимка договора. */
export async function renderContractDocx(input: SavedContractRenderInput, options: RendererOptions = {}) {
  const result = await requestRenderer(input, options);
  if (result.kind !== 'docx') throw Error('KP_RENDERER_RESPONSE_INVALID');
  const bytes = decode(result.bytesBase64, KP_RENDER_LIMITS.docxBytes);
  if (bytes.subarray(0, 2).toString() !== 'PK') throw Error('KP_RENDERER_RESPONSE_INVALID');
  return { bytes, pageCount: result.pageCount, templateHash: result.templateHash };
}
