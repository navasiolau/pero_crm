'use strict';
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { fork, execFile } = require('node:child_process');
const path = require('node:path');
const { LIMITS, validateRenderInput } = require('./validation.cjs');

function sameSecret(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && expected.length >= 32 &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function isolatedWorker(input, { deadlineMs = LIMITS.deadlineMs } = {}) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > LIMITS.deadlineMs) return Promise.reject(Error('KP_RENDER_DEADLINE_INVALID'));
  return new Promise((resolve, reject) => {
    const environment = {};
    for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'PERO_KP_CHROMIUM_PATH', 'PERO_KP_PDFINFO_PATH', 'PERO_KP_PDFTOPPM_PATH'])
      if (process.env[key]) environment[key] = process.env[key];
    const worker = fork(path.join(__dirname, 'worker.cjs'), { env: environment, detached: process.platform !== 'win32', execArgv: ['--max-old-space-size=384'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', windowsHide: true });
    let settled = false, browserPid;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) {
        // PID приходит только от нашего worker сразу после запуска Chromium.
        // Завершаем именно созданные деревья, чтобы timeout не оставлял orphan.
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true }, () => reject(error));
        } else {
          for (const pid of [browserPid, worker.pid]) if (Number.isSafeInteger(pid) && pid > 0) {
            try { process.kill(-pid, 'SIGKILL'); } catch { /* Процесс уже завершился. */ }
          }
          reject(error);
        }
      } else resolve(result);
    };
    const timer = setTimeout(() => finish(Error('KP_RENDER_TIMEOUT')), deadlineMs);
    worker.once('error', () => finish(Error('KP_RENDER_WORKER_FAILED')));
    worker.once('exit', () => finish(Error('KP_RENDER_WORKER_EXITED')));
    worker.on('message', message => {
      if (message?.type === 'browser') { if (Number.isSafeInteger(message.pid) && message.pid > 0) browserPid = message.pid; return; }
      if (message?.ok === true) finish(null, message.result); else finish(Error(message?.code || 'KP_RENDER_FAILED'));
    });
    try { worker.send(input, error => { if (error) finish(Error('KP_RENDER_WORKER_FAILED')); }); }
    catch { finish(Error('KP_RENDER_WORKER_FAILED')); }
  });
}
function createRendererServer({ secret, run = isolatedWorker } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('KP_RENDER_SECRET_REQUIRED');
  let active = 0; const queue = [];
  const execute = operation => new Promise((resolve, reject) => {
    const start = () => { active++; Promise.resolve().then(operation).then(resolve, reject).finally(() => { active--; queue.shift()?.(); }); };
    if (!active) start(); else if (queue.length < LIMITS.queue) queue.push(start); else reject(Error('KP_RENDER_BUSY'));
  });
  return http.createServer(async (request, response) => {
    const send = (status, body) => { if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); } };
    if (!sameSecret(request.headers['x-pero-renderer-key'], secret)) { send(401, { error: 'KP_RENDER_UNAUTHORIZED' }); return; }
    if (request.method === 'GET' && request.url === '/health') { send(200, { status: 'ok', active, queued: queue.length }); return; }
    if (request.method !== 'POST' || request.url !== '/v1/render') { send(404, { error: 'KP_RENDER_NOT_FOUND' }); return; }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') { send(415, { error: 'KP_RENDER_JSON_REQUIRED' }); return; }
    let size = 0; const chunks = [];
    try {
      for await (const chunk of request) {
        size += chunk.length; if (size > (request.headers['x-pero-renderer-kind'] === 'docx' ? LIMITS.docxRequestBytes : LIMITS.requestBytes)) { send(413, { error: 'KP_RENDER_BYTES_LIMIT' }); return; }
        chunks.push(chunk);
      }
      const input = validateRenderInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (size > (input.kind === 'docx' ? LIMITS.docxRequestBytes : LIMITS.requestBytes)) throw Error('KP_RENDER_BYTES_LIMIT');
      chunks.length = 0;
      const result = await execute(() => run(input)); send(200, result);
    } catch (error) {
      const code = /^KP_RENDER_[A-Z_]+$/.test(error?.message) ? error.message : 'KP_RENDER_INPUT_INVALID';
      send(code === 'KP_RENDER_BUSY' ? 429 : code === 'KP_RENDER_TIMEOUT' ? 504 : 400, { error: code });
    }
  });
}
if (require.main === module) {
  const server = createRendererServer({ secret: process.env.PERO_KP_RENDERER_SECRET });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT || 3100), '0.0.0.0');
}
module.exports = { createRendererServer, sameSecret, isolatedWorker };
