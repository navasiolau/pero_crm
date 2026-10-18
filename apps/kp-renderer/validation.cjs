'use strict';
const { getKpTemplateIdentity, KP_RENDER_LIMITS: LIMITS } = require('@pero/kp-template');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);
function boundedBase64(text, max) {
  if (typeof text !== 'string' || !text.length || text.length > Math.ceil(max / 3) * 4 || text.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    if (typeof text === 'string' && text.length > Math.ceil(max / 3) * 4) throw Error('KP_RENDER_BYTES_LIMIT');
    throw Error('KP_RENDER_BASE64_INVALID');
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > max) throw Error('KP_RENDER_BYTES_LIMIT');
  if (bytes.toString('base64') !== text) throw Error('KP_RENDER_BASE64_INVALID');
  return bytes;
}
function validateRenderInput(input) {
  if (!record(input)) throw Error('KP_RENDER_INPUT_INVALID');
  if (input.kind === 'rasterize') {
    const bytes = boundedBase64(input.pdfBase64, LIMITS.pdfBytes);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('KP_RENDER_PDF_INVALID');
    return { kind: 'rasterize', pdfBase64: input.pdfBase64 };
  }
  if (input.kind === 'docx') {
    if (input.templateHash !== getKpTemplateIdentity().templateHash) throw Error('KP_RENDER_TEMPLATE_MISMATCH');
    if (!record(input.settings) || !record(input.summary) || !record(input.profile) ||
      Buffer.byteLength(JSON.stringify({ settings: input.settings, summary: input.summary, profile: input.profile })) > LIMITS.stateBytes) throw Error('KP_RENDER_STATE_LIMIT');
    if (!Array.isArray(input.summary.sources) || !input.summary.sources.length || input.summary.sources.length > LIMITS.docxSources ||
      !Array.isArray(input.rendered) || input.rendered.length !== input.summary.sources.length) throw Error('KP_RENDER_DOCX_SOURCES');
    const sources = new Set(input.summary.sources.map(source => source?.id));
    if (sources.size !== input.summary.sources.length || [...sources].some(value => !id(value))) throw Error('KP_RENDER_DOCX_SOURCES');
    let count = 0, total = 0;
    for (const source of input.rendered) {
      if (!record(source) || !sources.delete(source.id) || !Array.isArray(source.imagesBase64) || !source.imagesBase64.length) throw Error('KP_RENDER_DOCX_SOURCES');
      count += source.imagesBase64.length; if (count > LIMITS.docxPages) throw Error('KP_RENDER_PAGE_LIMIT');
      for (const encoded of source.imagesBase64) {
        const bytes = boundedBase64(encoded, LIMITS.docxPngBytes); total += bytes.length;
        if (total > LIMITS.docxTotalPngBytes) throw Error('KP_RENDER_BYTES_LIMIT');
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('KP_RENDER_DOCX_PNG_REQUIRED');
      }
    }
    return input;
  }
  if (!['pdf', 'bundle'].includes(input.kind) || !id(input.proposalId) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw Error('KP_RENDER_INPUT_INVALID');
  if (input.templateHash !== getKpTemplateIdentity().templateHash) throw Error('KP_RENDER_TEMPLATE_MISMATCH');
  if (!record(input.state) || !Array.isArray(input.state.items) || input.state.items.length > LIMITS.items || Buffer.byteLength(JSON.stringify(input.state)) > LIMITS.stateBytes) throw Error('KP_RENDER_STATE_LIMIT');
  if (!Array.isArray(input.assets) || input.assets.length > LIMITS.items * 2) throw Error('KP_RENDER_ASSET_LIMIT');
  const assets = new Map(); let total = 0;
  for (const asset of input.assets) {
    if (!record(asset) || !id(asset.mediaId) || !imageTypes.has(asset.mimeType)) throw Error('KP_RENDER_ASSET_INVALID');
    if (assets.has(asset.mediaId)) throw Error('KP_RENDER_ASSET_DUPLICATE');
    total += boundedBase64(asset.bytesBase64, LIMITS.assetBytes).length;
    if (total > LIMITS.totalAssetBytes) throw Error('KP_RENDER_ASSET_LIMIT');
    assets.set(asset.mediaId, asset);
  }
  const used = new Set();
  for (const item of input.state.items) {
    if (!record(item)) throw Error('KP_RENDER_STATE_INVALID');
    for (const key of ['image', 'image2']) {
      const token = item[key]; if (token === '' || token === undefined || token === null) continue;
      if (typeof token !== 'string' || !token.startsWith('kp-media:') || !id(token.slice(9))) throw Error('KP_RENDER_IMAGE_REFERENCE_INVALID');
      const mediaId = token.slice(9);
      if (!assets.has(mediaId)) throw Error('KP_RENDER_ASSET_MISSING');
      used.add(mediaId);
    }
  }
  if (used.size !== assets.size) throw Error('KP_RENDER_ASSET_UNUSED');
  return input;
}
function prepareRenderState(input) {
  const state = structuredClone(input.state), assets = new Map(input.assets.map(asset => [asset.mediaId, asset]));
  for (const item of state.items) for (const key of ['image', 'image2']) if (item[key]) {
    const asset = assets.get(item[key].slice(9));
    if (!asset) throw Error('KP_RENDER_ASSET_MISSING');
    item[key] = 'data:' + asset.mimeType + ';base64,' + asset.bytesBase64;
  }
  return state;
}
module.exports = { LIMITS, boundedBase64, validateRenderInput, prepareRenderState };
