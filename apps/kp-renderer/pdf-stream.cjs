'use strict';
const fs = require('node:fs/promises');
const { constants, createWriteStream } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { LIMITS, validatePdfManifest } = require('./validation.cjs');

const PDF_STREAM_TYPE = 'application/vnd.pero.kp-pdf.v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
const aborted = signal => { if (signal?.aborted) throw Error('KP_RENDER_ABORTED'); };

async function guardDirectory(directory) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || await fs.realpath(directory) !== directory) throw Error('KP_RENDER_SPOOL_GUARD');
  for (let current = directory;; current = path.dirname(current)) {
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('KP_RENDER_SPOOL_GUARD');
    if (path.dirname(current) === current) break;
  }
}
async function guardSpool({ root, directory }) {
  await guardDirectory(root);
  if (path.dirname(directory) !== root || !uuid.test(path.basename(directory))) throw Error('KP_RENDER_SPOOL_GUARD');
  await guardDirectory(directory);
}
async function createSpool(root = '/spool') {
  root = path.resolve(root); await guardDirectory(root);
  const directory = path.join(root, randomUUID()); await fs.mkdir(directory, { mode: 0o700 });
  return { root, directory };
}
async function cleanupSpool(spool) {
  await guardSpool(spool);
  const names = await fs.readdir(spool.directory);
  for (const name of names) {
    if (['browser', 'cache', 'raster'].includes(name)) {
      const info = await fs.lstat(path.join(spool.directory, name));
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('KP_RENDER_SPOOL_GUARD');
      continue;
    }
    if (!/^(?:manifest\.json|document\.html|output\.pdf|asset-\d+\.(?:png|jpg|webp|avif|gif))$/.test(name)) throw Error('KP_RENDER_SPOOL_GUARD');
    const file = path.join(spool.directory, name), info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('KP_RENDER_SPOOL_GUARD');
  }
  // Удаляем только проверенные файлы своего UUID-каталога; рекурсивной очистки корня нет.
  const removeOwned = async file => {
    if (path.dirname(file) !== spool.directory && !file.startsWith(spool.directory + path.sep)) throw Error('KP_RENDER_SPOOL_GUARD');
    const info = await fs.lstat(file);
    // Chromium создаёт Singleton-ссылки: удаляем саму ссылку, никогда не переходим по ней.
    if (info.isDirectory() && !info.isSymbolicLink()) {
      for (const name of await fs.readdir(file)) await removeOwned(path.join(file, name));
      await fs.rmdir(file);
    } else await fs.unlink(file);
  };
  for (const name of names) await removeOwned(path.join(spool.directory, name));
  await fs.rmdir(spool.directory);
}
async function regularFile(file) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const info = await handle.stat(); if (!info.isFile() || (await fs.lstat(file)).isSymbolicLink()) throw Error('KP_RENDER_SPOOL_GUARD'); return handle; }
  catch (error) { await handle.close(); throw error; }
}
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw Error('KP_RENDER_SPOOL_WRITE'); offset += result.bytesWritten; }
}
class FrameReader {
  constructor(stream, signal) { this.iterator = stream[Symbol.asyncIterator](); this.signal = signal; this.chunk = Buffer.alloc(0); this.offset = 0; }
  async copyExactly(length, write) {
    let remaining = length;
    while (remaining) {
      aborted(this.signal);
      if (this.offset === this.chunk.length) {
        const next = await this.iterator.next(); if (next.done) throw Error('KP_RENDER_FRAME_TRUNCATED');
        this.chunk = Buffer.from(next.value); this.offset = 0; if (!this.chunk.length) continue;
      }
      const size = Math.min(remaining, this.chunk.length - this.offset), piece = this.chunk.subarray(this.offset, this.offset + size);
      await write(piece); this.offset += size; remaining -= size;
    }
  }
  async end() {
    aborted(this.signal);
    if (this.offset !== this.chunk.length) throw Error('KP_RENDER_FRAME_TRAILING');
    for (;;) { const next = await this.iterator.next(); if (next.done) break; if (next.value.length) throw Error('KP_RENDER_FRAME_TRAILING'); }
  }
}
function assetName(index, mimeType) { return `asset-${index}.${extensions[mimeType]}`; }
async function receivePdfStream(request, spool, signal) {
  await guardSpool(spool); aborted(signal);
  const abort = () => request.destroy?.(Error('KP_RENDER_ABORTED'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const reader = new FrameReader(request, signal), header = [];
    await reader.copyExactly(4, piece => { header.push(piece); });
    const length = Buffer.concat(header).readUInt32BE();
    if (!length || length + 4 > LIMITS.requestBytes) throw Error('KP_RENDER_BYTES_LIMIT');
    const manifestFile = path.join(spool.directory, 'manifest.json'), handle = await fs.open(manifestFile, 'wx', 0o600);
    try { await reader.copyExactly(length, piece => writeAll(handle, piece)); } finally { await handle.close(); }
    const raw = await fs.readFile(manifestFile), manifest = validatePdfManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    const total = length + 4 + manifest.assets.reduce((sum, asset) => sum + asset.size, 0);
    if (!Number.isSafeInteger(total) || total > LIMITS.requestBytes) throw Error('KP_RENDER_BYTES_LIMIT');
    for (const [index, asset] of manifest.assets.entries()) {
      const file = await fs.open(path.join(spool.directory, assetName(index, asset.mimeType)), 'wx', 0o600), hash = createHash('sha256');
      try { await reader.copyExactly(asset.size, async piece => { hash.update(piece); await writeAll(file, piece); }); } finally { await file.close(); }
      if (hash.digest('hex') !== asset.sha256) throw Error('KP_RENDER_ASSET_CHECKSUM');
    }
    await reader.end(); return manifest;
  } finally { signal?.removeEventListener('abort', abort); }
}
async function workingDirectory(directory, name, root = process.env.PERO_KP_SPOOL_DIR ?? '/spool') {
  if (!['browser', 'cache', 'raster'].includes(name)) throw Error('KP_RENDER_SPOOL_GUARD');
  await guardSpool({ root: path.resolve(root), directory });
  const file = path.join(directory, name); await fs.mkdir(file, { mode: 0o700 }); return file;
}
async function readSpoolManifest(directory, root = process.env.PERO_KP_SPOOL_DIR ?? '/spool') {
  const spool = { root: path.resolve(root), directory }; await guardSpool(spool);
  const handle = await regularFile(path.join(directory, 'manifest.json'));
  let manifest;
  try { const info = await handle.stat(); if (info.size > LIMITS.stateBytes) throw Error('KP_RENDER_STATE_LIMIT'); manifest = validatePdfManifest(JSON.parse(await handle.readFile('utf8'))); }
  finally { await handle.close(); }
  const files = [];
  for (const [index, asset] of manifest.assets.entries()) {
    const file = path.join(directory, assetName(index, asset.mimeType)), handle = await regularFile(file), hash = createHash('sha256');
    try {
      if ((await handle.stat()).size !== asset.size) throw Error('KP_RENDER_ASSET_CHECKSUM');
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      if (hash.digest('hex') !== asset.sha256) throw Error('KP_RENDER_ASSET_CHECKSUM');
    } finally { await handle.close(); }
    files.push(file);
  }
  const state = structuredClone(manifest.state), byId = new Map(manifest.assets.map((asset, index) => [asset.mediaId, pathToFileURL(files[index]).href]));
  for (const item of state.items) for (const key of ['image', 'image2']) if (item[key]) item[key] = byId.get(item[key].slice(9));
  return { manifest, state, files, spool };
}
async function writePdfStream(spool, stream) {
  await guardSpool(spool);
  const file = path.join(spool.directory, 'output.pdf'), hash = createHash('sha256'); let size = 0, prefix = Buffer.alloc(0);
  const measure = new Transform({ transform(chunk, _encoding, done) {
    size += chunk.length; if (!Number.isSafeInteger(size) || size > LIMITS.pdfBytes) { done(Error('KP_RENDER_BYTES_LIMIT')); return; }
    if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
    hash.update(chunk); done(null, chunk);
  } });
  await pipeline(stream?.getReader ? Readable.fromWeb(stream) : stream, measure, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  if (!prefix.equals(Buffer.from('%PDF-'))) throw Error('KP_RENDER_PDF_INVALID');
  return { kind: 'pdf-file', path: file, size, sha256: hash.digest('hex') };
}
async function openPdfResult(spool, result, templateHash) {
  await guardSpool(spool);
  if (result?.kind !== 'pdf-file' || result.path !== path.join(spool.directory, 'output.pdf') ||
    !Number.isSafeInteger(result.size) || result.size < 5 || result.size > LIMITS.pdfBytes || !/^[a-f0-9]{64}$/.test(result.sha256 ?? '') ||
    !Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.templateHash !== templateHash) throw Error('KP_RENDER_RESULT_INVALID');
  const handle = await regularFile(result.path);
  try {
    const prefix = Buffer.alloc(5); await handle.read(prefix, 0, 5, 0);
    if ((await handle.stat()).size !== result.size || !prefix.equals(Buffer.from('%PDF-'))) throw Error('KP_RENDER_RESULT_INVALID');
    return handle.createReadStream({ start: 0, autoClose: true });
  } catch (error) { await handle.close(); throw error; }
}
module.exports = { PDF_STREAM_TYPE, createSpool, cleanupSpool, receivePdfStream, readSpoolManifest, writePdfStream, openPdfResult, workingDirectory };
