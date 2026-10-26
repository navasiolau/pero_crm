'use strict';
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { fork, execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');
const { LIMITS, validateRenderInput } = require('./validation.cjs');
const { PDF_STREAM_TYPE, createSpool, cleanupSpool, receivePdfStream, openPdfResult } = require('./pdf-stream.cjs');

function sameSecret(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && expected.length >= 32 &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
async function isolatedWorker(input, options = {}) {
  const deadlineMs = options.deadlineMs ?? LIMITS.deadlineMs;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) throw Error('KP_RENDER_DEADLINE_INVALID');
  if (options.signal?.aborted) throw Error('KP_RENDER_ABORTED');
  const supplied = options.browserSpoolDirectory ?? (input?.kind === 'pdf-stream' ? input.spoolDirectory : undefined);
  if (supplied) return spawnIsolatedWorker(input, { ...options, deadlineMs, browserSpoolDirectory: supplied,
    spoolRoot: options.spoolRoot ?? path.dirname(supplied) });
  if (!['pdf', 'bundle', 'rasterize', 'docx'].includes(input?.kind)) throw Error('KP_RENDER_INPUT_INVALID');
  // Прежний прямой buffered-вызов сам владеет scratch; HTTP передаёт каталог своего запроса.
  const spool = await createSpool(options.spoolRoot ?? process.env.PERO_KP_SPOOL_DIR ?? os.tmpdir());
  try { return await spawnIsolatedWorker(input, { ...options, deadlineMs, spoolRoot: spool.root, browserSpoolDirectory: spool.directory }); }
  finally { await cleanupSpool(spool); }
}
function spawnIsolatedWorker(input, { deadlineMs = LIMITS.deadlineMs, signal, spoolRoot, browserSpoolDirectory, onChild } = {}) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) return Promise.reject(Error('KP_RENDER_DEADLINE_INVALID'));
  if (signal?.aborted) return Promise.reject(Error('KP_RENDER_ABORTED'));
  return new Promise((resolve, reject) => {
    const environment = {};
    for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'PERO_KP_CHROMIUM_PATH', 'PERO_KP_PDFINFO_PATH', 'PERO_KP_PDFTOPPM_PATH'])
      if (process.env[key]) environment[key] = process.env[key];
    if (spoolRoot) environment.PERO_KP_SPOOL_DIR = spoolRoot;
    if (browserSpoolDirectory) environment.PERO_KP_BROWSER_SPOOL_DIR = browserSpoolDirectory;
    const worker = fork(path.join(__dirname, 'worker.cjs'), { env: environment, detached: process.platform !== 'win32', execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', windowsHide: true });
    let browserPid, result, failure, timer, forceTimer, closed = false; const killers = [];
    const taskkill = () => killers.push(new Promise(resolve => {
      execFile('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    }));
    const killBrowser = () => {
      if (process.platform === 'win32' || !browserPid) return;
      for (const pid of [-browserPid, browserPid]) { try { process.kill(pid, 'SIGKILL'); } catch { /* Только PID собственного Chromium. */ } }
    };
    const terminate = error => {
      if (failure || closed) return; failure = error;
      if (process.platform === 'win32') {
        taskkill();
      } else {
        killBrowser();
        // SIGTERM даёт Puppeteer завершить Chromium и при отмене незавершённого launch.
        try { process.kill(-worker.pid, 'SIGTERM'); } catch { try { worker.kill('SIGTERM'); } catch { /* Процесс уже завершился. */ } }
      }
      // Это срок принудительной отмены, а не ограничение длительности рендера.
      forceTimer = setTimeout(() => {
        killBrowser();
        if (process.platform === 'win32') taskkill();
        else { try { process.kill(-worker.pid, 'SIGKILL'); } catch { try { worker.kill('SIGKILL'); } catch { /* Уже завершён. */ } } }
      }, 250);
    };
    const abort = () => terminate(Error('KP_RENDER_ABORTED'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('error', () => terminate(Error('KP_RENDER_WORKER_FAILED')));
    worker.once('close', async code => {
      closed = true; clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      // Освобождаем слот лишь после выхода собственного процесса и закрытия IPC.
      if (failure) {
        if (process.platform !== 'win32') {
          killBrowser(); try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* Собственная группа уже завершилась. */ }
        }
        await Promise.all(killers);
        const owned = [browserPid, ...(process.platform === 'win32' ? [] : [-worker.pid, ...(browserPid ? [-browserPid] : [])])].filter(Boolean);
        const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
        while (owned.some(exists)) await new Promise(resolve => setTimeout(resolve, 5));
        reject(failure);
      }
      else if (code !== 0 || !result) reject(Error('KP_RENDER_WORKER_EXITED'));
      else resolve(result);
    });
    worker.on('message', message => {
      if (message?.type === 'browser') {
        if (Number.isSafeInteger(message.pid) && message.pid > 1 && message.pid !== process.pid && message.pid !== worker.pid) { browserPid = message.pid; if (failure) killBrowser(); }
        else terminate(Error('KP_RENDER_WORKER_FAILED'));
        return;
      }
      if (message?.ok === true && message.result && !result) result = message.result;
      else terminate(Error(/^KP_RENDER_[A-Z_]+$/.test(message?.code ?? '') ? message.code : 'KP_RENDER_FAILED'));
    });
    worker.once('disconnect', () => { if (!result && !failure) terminate(Error('KP_RENDER_WORKER_FAILED')); });
    if (deadlineMs) timer = setTimeout(() => terminate(Error('KP_RENDER_TIMEOUT')), deadlineMs);
    try { onChild?.(worker); worker.send(input, error => { if (error) terminate(Error('KP_RENDER_WORKER_FAILED')); }); }
    catch { terminate(Error('KP_RENDER_WORKER_FAILED')); }
    if (signal?.aborted) abort();
  });
}
function createRendererServer({ secret, run = isolatedWorker, spoolRoot = process.env.PERO_KP_SPOOL_DIR ?? '/spool' } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('KP_RENDER_SECRET_REQUIRED');
  let active = 0; const queue = [], requests = new Set();
  const execute = (operation, signal) => new Promise((resolve, reject) => {
    const entry = {};
    entry.abort = () => { const index = queue.indexOf(entry); if (index >= 0) { queue.splice(index, 1); reject(Error('KP_RENDER_ABORTED')); } };
    entry.start = () => {
      signal.removeEventListener('abort', entry.abort);
      if (signal.aborted) { reject(Error('KP_RENDER_ABORTED')); queue.shift()?.start(); return; }
      active++;
      Promise.resolve().then(operation).then(resolve, reject).finally(() => { active--; queue.shift()?.start(); });
    };
    if (signal.aborted) reject(Error('KP_RENDER_ABORTED'));
    else if (!active) entry.start();
    else if (queue.length < LIMITS.queue) { queue.push(entry); signal.addEventListener('abort', entry.abort, { once: true }); }
    else reject(Error('KP_RENDER_BUSY'));
  });
  const server = http.createServer(async (request, response) => {
    const send = (status, body) => { if (!response.destroyed && !response.headersSent) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); } };
    if (!sameSecret(request.headers['x-pero-renderer-key'], secret)) { send(401, { error: 'KP_RENDER_UNAUTHORIZED' }); return; }
    if (request.method === 'GET' && request.url === '/health') { send(200, { status: 'ok', active, queued: queue.length }); return; }
    if (request.method !== 'POST' || request.url !== '/v1/render') { send(404, { error: 'KP_RENDER_NOT_FOUND' }); return; }
    const contentType = request.headers['content-type']?.split(';')[0];
    if (!['application/json', PDF_STREAM_TYPE].includes(contentType)) { send(415, { error: 'KP_RENDER_JSON_REQUIRED' }); return; }
    const controller = new AbortController(); let spool;
    const abort = () => { controller.abort(); request.destroy(); };
    const close = () => { if (!response.writableFinished) abort(); };
    let completed;
    const tracked = { abort, done: new Promise(resolve => { completed = resolve; }) }; requests.add(tracked);
    request.once('aborted', abort); response.once('close', close);
    try {
      await execute(async () => {
        if (contentType === PDF_STREAM_TYPE) {
          spool = await createSpool(spoolRoot);
          const manifest = await receivePdfStream(request, spool, controller.signal);
          const result = await run({ kind: 'pdf-stream', spoolDirectory: spool.directory }, { signal: controller.signal, spoolRoot: spool.root, browserSpoolDirectory: spool.directory });
          controller.signal.throwIfAborted();
          const stream = await openPdfResult(spool, result, manifest.templateHash);
          response.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'content-length': String(result.size),
            'x-pero-template-hash': result.templateHash, 'x-pero-render-page-count': String(result.pageCount), 'x-pero-content-sha256': result.sha256 });
          await pipeline(stream, response, { signal: controller.signal });
        } else {
          let size = 0; const chunks = [];
          for await (const chunk of request) {
            controller.signal.throwIfAborted(); size += chunk.length;
            if (size > (request.headers['x-pero-renderer-kind'] === 'docx' ? LIMITS.docxRequestBytes : LIMITS.requestBytes)) throw Error('KP_RENDER_BYTES_LIMIT');
            chunks.push(chunk);
          }
          const input = validateRenderInput(JSON.parse(Buffer.concat(chunks).toString('utf8'))); chunks.length = 0;
          spool = await createSpool(spoolRoot);
          const result = await run(input, { signal: controller.signal, spoolRoot: spool.root, browserSpoolDirectory: spool.directory });
          controller.signal.throwIfAborted(); send(200, result);
        }
      }, controller.signal);
    } catch (error) {
      const code = /^KP_RENDER_[A-Z_]+$/.test(error?.message) ? error.message : controller.signal.aborted ? 'KP_RENDER_ABORTED' : 'KP_RENDER_INPUT_INVALID';
      send(code === 'KP_RENDER_BUSY' ? 429 : code === 'KP_RENDER_TIMEOUT' ? 504 : 400, { error: code });
    } finally {
      request.removeListener('aborted', abort); response.removeListener('close', close);
      if (spool) await cleanupSpool(spool).catch(error => console.error(JSON.stringify({ event: 'KP_RENDER_SPOOL_CLEANUP_FAILED', code: /^KP_RENDER_[A-Z_]+$/.test(error?.message) ? error.message : 'KP_RENDER_SPOOL_IO' })));
      requests.delete(tracked); completed();
    }
  });
  server.requestTimeout = 0; server.headersTimeout = 10_000;
  server.shutdown = async () => {
    const stopped = new Promise(resolve => server.close(resolve));
    const current = [...requests]; for (const request of current) request.abort();
    server.closeAllConnections(); await Promise.all(current.map(request => request.done)); await stopped;
  };
  return server;
}
if (require.main === module) {
  const server = createRendererServer({ secret: process.env.PERO_KP_RENDERER_SECRET });
  const stop = () => { void server.shutdown().then(() => process.exit(0), () => process.exit(1)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  server.listen(Number(process.env.PORT || 3100), '0.0.0.0');
}
module.exports = { createRendererServer, sameSecret, isolatedWorker };
