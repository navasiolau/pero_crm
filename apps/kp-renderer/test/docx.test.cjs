const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { ContractModel, generateDocx, getKpTemplateIdentity, contractFileName } = require('@pero/kp-template');
const JSZip = createRequire(createRequire(require.resolve('@pero/kp-template')).resolve('docx'))('jszip');
const { validateRenderInput } = require('../validation.cjs');
const { isolatedWorker } = require('../server.cjs');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWM4tKTxPwgzwBgAZ0ILmdrs+PUAAAAASUVORK5CYII=', 'base64');
function input({ country = 'BY', customerType = 'individual', proposals = [{}] } = {}) {
  const state = { currency: country === 'BY' ? 'BYN' : 'RUB', order: { number: '231', date: '18.10.2026', project: 'Мебель' }, client: { name: 'Синтетический клиент' },
    items: [{ name: 'Шкаф', price: 100.75, qty: 2 }], discount: 10, discountMode: 'percent', delivery: { visible: false }, ...proposals[0] };
  const settings = ContractModel.defaults(state, 'primary', new Date('2026-10-18T09:00:00Z')); settings.deliveryAddress = 'Синтетический адрес';
  settings.customer = { ...settings.customer, type: customerType, taxId: '000', registrationAddress: 'Тестовый адрес', representative: 'Тест', authority: 'Устав' };
  settings.contractorProfileId = country === 'BY' ? 'pero-by' : 'pero-ru';
  const profile = { id: settings.contractorProfileId, name: 'Синтетический исполнитель', positionGenitive: 'директора', directorGenitive: 'Проверки', authority: 'Устава',
    country, address: 'Синтетический адрес', taxId: '000', bankDetails: 'Синтетические реквизиты', email: 'fixture@example.invalid', phones: ['+000'], site: 'example.invalid', signature: 'Проверка' };
  const sources = [{ id: 'primary', state }, ...proposals.slice(1).map((value, index) => ({
    id: 'additional-' + index, state: { ...state, order: { ...state.order, number: String(232 + index) }, ...value },
  }))];
  settings.proposalIds = sources.map(source => source.id);
  const checked = ContractModel.validate(settings, sources, [profile]); assert.deepEqual(checked.errors, []);
  return { kind: 'docx', settings, summary: checked.summary, profile,
    rendered: sources.map(source => ({ id: source.id, imagesBase64: [image.toString('base64')] })), templateHash: getKpTemplateIdentity().templateHash };
}
test('isolated DOCX worker preserves original XML/template and appendix bytes', async () => {
  const request = input();
  const expected = await generateDocx(request.settings, request.summary, request.profile, [{ id: 'primary', images: [image] }]);
  const result = await isolatedWorker(request); assert.equal(result.kind, 'docx'); assert.equal(result.pageCount, 1);
  const [actual, baseline] = await Promise.all([JSZip.loadAsync(Buffer.from(result.bytesBase64, 'base64')), JSZip.loadAsync(expected)]);
  assert.deepEqual(Object.keys(actual.files).sort(), Object.keys(baseline.files).sort());
  for (const name of Object.keys(baseline.files)) {
    if (baseline.files[name].dir) continue;
    const actualPart = await actual.files[name].async('nodebuffer');
    const baselinePart = await baseline.files[name].async('nodebuffer');
    assert.ok(actualPart.equals(baselinePart), name);
  }
  assert.equal(contractFileName('231'), 'contract_231_Pero.docx');
});
test('DOCX rejects unmatched sources, invalid images and template changes before work', () => {
  assert.throws(() => validateRenderInput({ ...input(), templateHash: 'different' }), /TEMPLATE_MISMATCH/);
  assert.throws(() => validateRenderInput({ ...input(), rendered: [{ id: 'foreign', imagesBase64: [image.toString('base64')] }] }), /DOCX_SOURCES/);
  assert.throws(() => validateRenderInput({ ...input(), rendered: [{ id: 'primary', imagesBase64: [Buffer.from('url-not-png').toString('base64')] }] }), /PNG_REQUIRED/);
});

test('shared DOCX budget accepts synthetic appendices above 64 pages', () => {
  const request = input(); request.rendered[0].imagesBase64 = Array(65).fill(image.toString('base64'));
  assert.doesNotThrow(() => validateRenderInput(request));
});

const item = (name, material, hardware) => ({
  name, qty: 1, price: 100,
  specifications: [
    { id: 'body', type: 'body', group: 'construction', label: 'Корпус', value: material },
    { id: 'hardware', type: 'hardware', group: 'hardware', label: 'Фурнитура', value: hardware },
  ],
});

async function contractXml(request) {
  const output = await isolatedWorker(request);
  const zip = await JSZip.loadAsync(Buffer.from(output.bytesBase64, 'base64'));
  return zip.file('word/document.xml').async('string');
}

test('договор с физлицом в РБ указывает источник нагрузки и сохраняет эскиз и акт', async () => {
  const request = input({ proposals: [{ items: [item('Кухня', 'ЛДСП EGGER Eurodekor', 'BOYARD SB28GR.1/500')] }] });
  const xml = await contractXml(request);
  assert.match(xml, /7\.3\. Инструкция по эксплуатации мебели PERO \(Приложение № 4, редакция 1 от 22\.11\.2026\)/);
  assert.match(xml, /Республике Беларусь заказа на изготовление мебели Стороны согласовывают и подписывают эскиз/);
  assert.match(xml, /вследствие нарушения Заказчиком доведённых до него правил/);
  assert.doesNotMatch(xml, /200 кг|Заказчик теряет право|\{\{(?:warranty_conditions|contract_instructions)\}\}/);
  const instructionStart = xml.indexOf('ИНСТРУКЦИЯ ПО ЭКСПЛУАТАЦИИ МЕБЕЛИ PERO');
  assert.ok(instructionStart > xml.indexOf('ОСОБЫЕ ОТМЕТКИ'));
  const appendix = xml.slice(instructionStart);
  assert.match(appendix, /Несущая способность пары направляющих — 40 кг при монтажной длине 500 мм/);
  assert.match(appendix, /BOYARD, каталог функциональной фурнитуры 2024, стр\. 110/);
  assert.match(appendix, /HYPERLINK[^>]+www\.boyard\.biz\/storage\/docs\/[^>]+\/110\//);
  assert.match(appendix, /Декоративные поверхности EGGER/);
});

test('договор РФ из двух КП не переносит нагрузку на полку и пропускает неопределённые модели', async () => {
  const request = input({ country: 'RU', proposals: [
    { items: [
      item('Шкаф', 'ЛДСП EGGER', 'Петли Salice AIR'),
      item('Ящики', 'ЛДСП', 'BLUM LEGRABOX'),
      item('Тумба', 'ЛДСП', 'BOYARD SB28GR.1/400 или SB28GR.1/500'),
      item('Стеллаж', 'Полка из ЛДСП 50 кг', 'Без Salice AIR'),
    ] },
    { items: [
      { name: 'Комод', price: 100, qty: 1, products: [{ title: 'Фурнитура', drawers: 'BLUM LEGRABOX 753.5001S' }] },
      { ...item('Тумба', '', ''), specifications: [], products: [{ drawers: 'BOYARD SB08GR.1/500' }] },
    ] },
  ] });
  const xml = await contractXml(request);
  assert.match(xml, /7\.3\. Инструкция по эксплуатации мебели PERO \(Приложение № 5/);
  assert.match(xml, /Приложение №4 — Акт сдачи-приёмки выполненных работ/);
  const appendix = xml.slice(xml.indexOf('ИНСТРУКЦИЯ ПО ЭКСПЛУАТАЦИИ МЕБЕЛИ PERO'));
  assert.match(appendix, /Предельная масса двери — 25 кг/);
  assert.match(appendix, /приложение № 1, поз\. 1\./);
  assert.match(appendix, /Класс нагрузки пары корпусных направляющих — 70 кг/);
  assert.match(appendix, /приложение № 2, поз\. 1\./);
  assert.doesNotMatch(appendix, /40 кг|35 кг|50 кг|BOYARD|поз\. 1, 4/);
});

test('договоры ИП и организации содержат акт без приложения с инструкцией', async () => {
  for (const customerType of ['soleProprietor', 'organization']) {
    const xml = await contractXml(input({ customerType }));
    assert.match(xml, /Приложение №3 — Акт сдачи-приёмки выполненных работ/);
    assert.doesNotMatch(xml, /ИНСТРУКЦИЯ ПО ЭКСПЛУАТАЦИИ МЕБЕЛИ|\{\{contract_instructions\}\}|200 кг/);
  }
});
