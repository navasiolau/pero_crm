const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateRenderInput, prepareRenderState, boundedBase64, LIMITS } = require('../validation.cjs');
const { renderPdf } = require('../render.cjs');
const { getKpTemplateIdentity } = require('@pero/kp-template');
const base = () => ({ kind: 'pdf', proposalId: 'proposal', revision: 2, templateHash: getKpTemplateIdentity().templateHash,
  state: { items: [{ image: 'kp-media:photo', image2: '', price: 100, qty: 2 }] }, assets: [{ mediaId: 'photo', mimeType: 'image/png', bytesBase64: 'aGVsbG8=' }] });
test('a snapshot resolves only owned asset identifiers without arbitrary fetch URLs', () => {
  const request = validateRenderInput(base()); const state = prepareRenderState(request);
  assert.equal(state.items[0].image, 'data:image/png;base64,aGVsbG8=');
  assert.equal(request.state.items[0].image, 'kp-media:photo');
  for (const image of ['http://127.0.0.1:5432/', 'https://example.invalid/picture', 'file:///etc/passwd', 'data:image/png;base64,aGVsbG8=', 'kp-media:missing'])
    assert.throws(() => validateRenderInput({ ...base(), state: { items: [{ image }] } }), /KP_RENDER_(IMAGE|ASSET)/);
});
test('unmatched template, duplicate or unused media and over-limit inputs fail before Chromium', () => {
  assert.throws(() => validateRenderInput({ ...base(), templateHash: 'old' }), /KP_RENDER_TEMPLATE_MISMATCH/);
  assert.throws(() => validateRenderInput({ ...base(), assets: [...base().assets, ...base().assets] }), /KP_RENDER_ASSET_DUPLICATE/);
  assert.throws(() => validateRenderInput({ ...base(), state: { items: [] } }), /KP_RENDER_ASSET_UNUSED/);
  assert.doesNotThrow(() => validateRenderInput({ ...base(), state: { items: Array(201).fill({ image: 'kp-media:photo' }) } }));
  assert.throws(() => validateRenderInput({ ...base(), state: { items: {} } }), /KP_RENDER_STATE/);
  assert.throws(() => boundedBase64('not-base64', 100), /KP_RENDER_BASE64/);
  assert.throws(() => boundedBase64('aGVsbG8=', 4), /KP_RENDER_BYTES/);
});
test('retained PDF mode validates PDF bytes and rejects resource or URL objects', () => {
  assert.equal(validateRenderInput({ kind: 'rasterize', pdfBase64: Buffer.from('%PDF-1.7\n').toString('base64') }).kind, 'rasterize');
  assert.throws(() => validateRenderInput({ kind: 'rasterize', pdfBase64: Buffer.from('https://private.invalid').toString('base64') }), /KP_RENDER_PDF/);
});

test('PDF page counter accepts counts above 64 and keeps integer validation without Chromium', async () => {
  const render = pageCount => renderPdf(base(), async () => ({
    newPage: async () => ({ setViewport: async () => {}, setJavaScriptEnabled: async () => {}, setRequestInterception: async () => {},
      on: () => {}, emulateMediaType: async () => {}, setContent: async () => {}, evaluate: async () => 0,
      $$eval: async () => pageCount, pdf: async () => Buffer.from('%PDF-synthetic') }),
    close: async () => {}
  }));
  assert.equal((await render(65)).pageCount, 65);
  for (const count of [0, -1, 1.5]) await assert.rejects(render(count), /KP_RENDER_PAGE_LIMIT/);
});
