import { getKpTemplateIdentity, KP_RENDER_LIMITS, type SavedProposalRenderInput, type SavedContractRenderInput, type InternalRenderOutput } from '@pero/kp-template';

type RendererOptions = { fetcher?: typeof fetch; baseUrl?: string; secret?: string };
async function requestRenderer(input: unknown, options: RendererOptions): Promise<InternalRenderOutput> {
  const base = new URL(options.baseUrl ?? process.env.PERO_KP_RENDERER_URL ?? 'http://kp-renderer:3100');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('KP_RENDERER_CONFIGURATION_INVALID');
  const secret = options.secret ?? process.env.PERO_KP_RENDERER_SECRET;
  if (!secret || secret.length < 32) throw Error('KP_RENDERER_SECRET_REQUIRED');
  const isDocx = !!input && typeof input === 'object' && 'kind' in input && input.kind === 'docx';
  const body = JSON.stringify(input), maxJsonBytes = isDocx ? KP_RENDER_LIMITS.docxRequestBytes : KP_RENDER_LIMITS.requestBytes;
  if (Buffer.byteLength(body) > maxJsonBytes) throw Error('KP_RENDERER_REQUEST_LIMIT');
  const response = await (options.fetcher ?? fetch)(new URL('/v1/render', base), { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pero-renderer-key': secret, 'x-pero-renderer-kind': isDocx ? 'docx' : 'pdf' }, body,
    signal: AbortSignal.timeout(90_000), cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw Error(response.status === 429 ? 'Рендер занят. Повторите генерацию позже' : 'Не удалось сформировать документ');
  const reader = response.body?.getReader(); if (!reader) throw Error('KP_RENDERER_RESPONSE_EMPTY');
  let size = 0; const chunks: Buffer[] = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > maxJsonBytes) { await reader.cancel(); throw Error('KP_RENDERER_RESPONSE_LIMIT'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || !('kind' in value) || !('pageCount' in value) || !('templateHash' in value) ||
    !Number.isSafeInteger(value.pageCount) || Number(value.pageCount) < 1 || Number(value.pageCount) > (value.kind === 'docx' ? KP_RENDER_LIMITS.docxPages : value.kind === 'rasterize' ? KP_RENDER_LIMITS.rasterPages : KP_RENDER_LIMITS.pages) || value.templateHash !== getKpTemplateIdentity().templateHash) throw Error('KP_RENDERER_RESPONSE_INVALID');
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
