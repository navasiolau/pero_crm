import { getViewableFileSource, type ViewableFile } from './viewable-file';

const printableImages = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/apng', 'image/gif', 'image/webp',
  'image/avif', 'image/bmp', 'image/x-ms-bmp', 'image/svg+xml', 'image/x-icon',
  'image/vnd.microsoft.icon',
]);
export const PRINT_PREPARE_TIMEOUT_MS = 60_000;
export const PRINT_RESOURCE_TIMEOUT_MS = 120_000;

function baseMime(mimeType: string) { return mimeType.split(';', 1)[0].trim().toLowerCase(); }
export function getPrintableFileKind(file: Pick<ViewableFile, 'mimeType'>): 'pdf' | 'image' | null {
  const mimeType = baseMime(file.mimeType);
  return mimeType === 'application/pdf' ? 'pdf' : printableImages.has(mimeType) ? 'image' : null;
}
export function getImagePrintPage(width: number, height: number) {
  return width > height
    ? { orientation: 'landscape' as const, widthMm: 297, heightMm: 210 }
    : { orientation: 'portrait' as const, widthMm: 210, heightMm: 297 };
}

function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

/** Только известный защищённый route и оригинальные байты; ответ ошибки никогда не печатается. */
export async function fetchPrintableFile(file: ViewableFile, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<Blob> {
  const kind = getPrintableFileKind(file);
  if (!kind) throw new Error('Этот формат нельзя распечатать в браузере');
  if (!/^[a-zA-Z0-9_-]+$/.test(file.id)) throw new Error('Не удалось определить файл для печати');
  options.signal?.throwIfAborted();
  const source = getViewableFileSource(file) + (kind === 'pdf' ? '?view=1' : '');
  let response: Response;
  try {
    response = await waitWithAbort((options.fetcher ?? fetch)(source, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: options.signal,
    }), options.signal);
  } catch {
    options.signal?.throwIfAborted();
    throw new Error('Не удалось загрузить файл для печати');
  }
  if (!response.ok || response.redirected) {
    throw new Error([401, 403, 404].includes(response.status)
      ? 'Файл недоступен. Проверьте доступ и обновите страницу'
      : 'Не удалось загрузить файл для печати');
  }
  const mimeType = baseMime(response.headers.get('Content-Type') ?? '');
  if (getPrintableFileKind({ mimeType }) !== kind) throw new Error('Формат загруженного файла не подходит для печати');
  const blob = await waitWithAbort(response.blob(), options.signal);
  if (!blob.size) throw new Error('Файл для печати пуст');
  if (kind === 'pdf') {
    const [header, tail] = await waitWithAbort(Promise.all([
      blob.slice(0, 1024).text(), blob.slice(Math.max(0, blob.size - 4096)).text(),
    ]), options.signal);
    if (!/%PDF-\d+\.\d+/.test(header) || !/startxref\s+\d+\s+%%EOF(?:\s|\u0000)*$/.test(tail)) {
      throw new Error('Не удалось прочитать PDF для печати');
    }
  }
  options.signal?.throwIfAborted();
  return new Blob([blob], { type: mimeType });
}

type PrintJob = { preparing: boolean; dispose: () => void };
let activeJob: PrintJob | null = null;

/** Передаёт выбранный оригинал штатной печати. Возврат означает вызов браузера, а не физическую печать. */
export async function printViewableFile(file: ViewableFile, options: {
  signal?: AbortSignal; prepareTimeoutMs?: number; resourceTimeoutMs?: number;
} = {}): Promise<void> {
  if (activeJob?.preparing) throw new Error('Другой файл уже готовится к печати');
  options.signal?.throwIfAborted();
  const kind = getPrintableFileKind(file);
  if (!kind) throw new Error('Этот формат нельзя распечатать в браузере');
  if (kind === 'pdf' && navigator.pdfViewerEnabled === false) {
    throw new Error('В этом браузере отключён просмотр PDF. Включите его для печати');
  }
  activeJob?.dispose();
  const controller = new AbortController();
  let frame: HTMLIFrameElement | null = null;
  let objectUrl: string | null = null;
  let resourceTimer: ReturnType<typeof setTimeout> | undefined;
  const removers: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };
  let disposed = false;
  const job: PrintJob = { preparing: true, dispose: () => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers) remove();
    clearTimeout(resourceTimer);
    frame?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (activeJob === job) activeJob = null;
    controller.abort();
  } };
  activeJob = job;
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) listen(options.signal, 'abort', forwardAbort);
  listen(controller.signal, 'abort', job.dispose);
  listen(window, 'pagehide', job.dispose);
  const prepareTimer = setTimeout(() => controller.abort(new Error('Не удалось подготовить печать: время ожидания истекло')),
    options.prepareTimeoutMs ?? PRINT_PREPARE_TIMEOUT_MS);
  try {
    const blob = await fetchPrintableFile(file, { signal: controller.signal });
    controller.signal.throwIfAborted();
    objectUrl = URL.createObjectURL(blob);
    frame = document.createElement('iframe');
    frame.title = `Печать ${file.fileName}`;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.dataset.filePrint = kind;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0';
    const printFrame = frame, source = objectUrl;
    const loaded = new Promise<void>((resolve, reject) => {
      listen(printFrame, 'load', () => {
        try {
          if (kind === 'pdf' && printFrame.contentWindow?.location.href !== source) return;
          resolve();
        } catch { reject(new Error('Браузер не разрешил открыть документ для печати')); }
      });
      listen(printFrame, 'error', () => reject(new Error('Не удалось открыть файл для печати')));
      printFrame.src = kind === 'pdf' ? source : 'about:blank';
      document.body.append(printFrame);
    });
    await waitWithAbort(loaded, controller.signal);
    const printWindow = printFrame.contentWindow, printDocument = printFrame.contentDocument;
    if (!printWindow || !printDocument) throw new Error('Браузер не разрешил открыть документ для печати');
    if (kind === 'pdf') {
      if (baseMime(printDocument.contentType) !== 'application/pdf' || printDocument.readyState !== 'complete') {
        throw new Error('Браузер не загрузил PDF для печати');
      }
    } else {
      const image = printDocument.createElement('img');
      image.alt = file.fileName;
      image.src = source;
      const title = printDocument.createElement('title'); title.textContent = file.fileName;
      const style = printDocument.createElement('style');
      printDocument.head.replaceChildren(title, style);
      printDocument.body.replaceChildren(image);
      try { await waitWithAbort(image.decode(), controller.signal); }
      catch {
        controller.signal.throwIfAborted();
        throw new Error('Не удалось прочитать изображение для печати');
      }
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Не удалось прочитать изображение для печати');
      const page = getImagePrintPage(image.naturalWidth, image.naturalHeight);
      style.textContent = `@page{size:A4 ${page.orientation};margin:0}html{margin:0;padding:0}body{margin:0;padding:10mm;box-sizing:border-box;width:${page.widthMm}mm;height:${page.heightMm}mm;break-inside:avoid}img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;break-inside:avoid}`;
    }
    controller.signal.throwIfAborted();
    listen(printWindow, 'afterprint', job.dispose);
    // PDF print в Chromium асинхронный и не всегда отдаёт afterprint наружу.
    resourceTimer = setTimeout(job.dispose, options.resourceTimeoutMs ?? PRINT_RESOURCE_TIMEOUT_MS);
    try { printWindow.print(); }
    catch { throw new Error('Браузер не разрешил вызвать печать файла'); }
  } catch (error) {
    job.dispose();
    if (controller.signal.reason instanceof Error && controller.signal.reason.name !== 'AbortError') throw controller.signal.reason;
    throw error instanceof DOMException || error instanceof Error ? error : new Error('Не удалось распечатать файл');
  } finally {
    clearTimeout(prepareTimer);
    job.preparing = false;
  }
}
