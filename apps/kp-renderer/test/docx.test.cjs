const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { ContractModel, generateDocx, getKpTemplateIdentity, contractFileName } = require('@pero/kp-template');
const JSZip = createRequire(createRequire(require.resolve('@pero/kp-template')).resolve('docx'))('jszip');
const { validateRenderInput } = require('../validation.cjs');
const { isolatedWorker } = require('../server.cjs');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWM4tKTxPwgzwBgAZ0ILmdrs+PUAAAAASUVORK5CYII=', 'base64');
function input() {
  const state = { currency: 'BYN', order: { number: '231', date: '18.10.2026', project: 'Мебель' }, client: { name: 'Синтетический клиент' },
    items: [{ name: 'Шкаф', price: 100.75, qty: 2 }], discount: 10, discountMode: 'percent', delivery: { visible: false } };
  const settings = ContractModel.defaults(state, 'primary', new Date('2026-10-18T09:00:00Z')); settings.deliveryAddress = 'Синтетический адрес';
  const profile = { id: 'pero-by', name: 'Синтетический исполнитель', positionGenitive: 'директора', directorGenitive: 'Проверки', authority: 'Устава',
    country: 'BY', address: 'Синтетический адрес', taxId: '000', bankDetails: 'Синтетические реквизиты', email: 'fixture@example.invalid', phones: ['+000'], site: 'example.invalid', signature: 'Проверка' };
  const checked = ContractModel.validate(settings, [{ id: 'primary', state }], [profile]); assert.deepEqual(checked.errors, []);
  return { kind: 'docx', settings, summary: checked.summary, profile, rendered: [{ id: 'primary', imagesBase64: [image.toString('base64')] }], templateHash: getKpTemplateIdentity().templateHash };
}
test('isolated DOCX worker preserves original XML/template and appendix bytes', async () => {
  const request = input();
  const expected = await generateDocx(request.settings, request.summary, request.profile, [{ id: 'primary', images: [image] }]);
  const result = await isolatedWorker(request); assert.equal(result.kind, 'docx'); assert.equal(result.pageCount, 1);
  const [actual, baseline] = await Promise.all([JSZip.loadAsync(Buffer.from(result.bytesBase64, 'base64')), JSZip.loadAsync(expected)]);
  assert.deepEqual(Object.keys(actual.files).sort(), Object.keys(baseline.files).sort());
  for (const name of Object.keys(baseline.files)) if (!baseline.files[name].dir) assert.deepEqual(await actual.files[name].async('nodebuffer'), await baseline.files[name].async('nodebuffer'), name);
  assert.equal(contractFileName('231'), 'contract_231_Pero.docx');
});
test('DOCX rejects unmatched sources, invalid images and template changes before work', () => {
  assert.throws(() => validateRenderInput({ ...input(), templateHash: 'different' }), /TEMPLATE_MISMATCH/);
  assert.throws(() => validateRenderInput({ ...input(), rendered: [{ id: 'foreign', imagesBase64: [image.toString('base64')] }] }), /DOCX_SOURCES/);
  assert.throws(() => validateRenderInput({ ...input(), rendered: [{ id: 'primary', imagesBase64: [Buffer.from('url-not-png').toString('base64')] }] }), /PNG_REQUIRED/);
});

test('shared DOCX budget preserves multi-proposal jobs above 64 pages and rejects the 1001st page', () => {
  const request = input(); request.rendered[0].imagesBase64 = Array(1000).fill(image.toString('base64'));
  assert.doesNotThrow(() => validateRenderInput(request));
  request.rendered[0].imagesBase64.push(image.toString('base64')); assert.throws(() => validateRenderInput(request), /PAGE_LIMIT/);
});
