const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const template = require('../index.cjs');

const fixture = { header: { company: 'Перо Лайв' }, order: { number: '231', project: 'Шкаф', date: '18.10.2026' },
  client: { name: 'Заказчик' }, currency: 'BYN', discount: 10, discountMode: 'percent',
  items: [{ id: 'stable-1', name: 'Шкаф', price: 100.75, qty: 1, products: [] }],
  delivery: { mode: 'items', visible: true, items: [{ name: 'Доставка', price: 10, crmKind: 'DELIVERY' }] } };

test('source-compatible rounding and printing retain CRM-only row metadata', () => {
  const normalized = template.SheetRender.normalizeState(fixture);
  assert.equal(normalized.items[0].id, 'stable-1');
  assert.equal(normalized.delivery.items[0].crmKind, 'DELIVERY');
  const printed = template.SheetRender.buildFullHTML(fixture);
  assert.equal(printed, template.SheetRender.buildFullHTML({ ...fixture, delivery: { ...fixture.delivery, items: [{ name: 'Доставка', price: 10 }] } }));
  assert.equal(template.SheetRender.totalsOf({ ...fixture, delivery: { visible: false } }).total, 90.68);
});

test('editable tagline is literal in preview and export; only missing legacy value uses the original fallback', () => {
  const state = { ...fixture, header: { ...fixture.header, tagline: '<Точный слоган> & текст' } }, before = structuredClone(state);
  for (const html of [template.SheetRender.sheetHTML(state), template.SheetRender.buildFullHTML(state)]) {
    assert.ok(html.includes('<div class="sh-tagline">&lt;Точный слоган&gt; &amp; текст</div>'));
    assert.ok(!html.includes('<Точный слоган>'));
  }
  for (const header of [fixture.header, { ...fixture.header, tagline: null }])
    assert.ok(template.SheetRender.sheetHTML({ ...fixture, header }).includes('<div class="sh-tagline">Ваше желание — наша реализация</div>'));
  const cleared = template.SheetRender.sheetHTML({ ...fixture, header: { ...fixture.header, tagline: '' } });
  assert.ok(cleared.includes('<div class="sh-tagline"></div>'));
  assert.ok(!cleared.includes('Ваше желание — наша реализация'));
  assert.deepEqual(state, before);
});

test('totalNote renders safe literal text and preserves explicit line breaks in preview and export', () => {
  const state = { ...fixture, totalNote: '<em>Буквальный & текст</em>\r\nВторая строка\nТретья' }, before = structuredClone(state);
  const expected = '<div class="sh-totalNote">&lt;em&gt;Буквальный &amp; текст&lt;/em&gt;<br>Вторая строка<br>Третья</div>';
  for (const html of [template.SheetRender.sheetHTML(state), template.SheetRender.buildFullHTML(state)]) {
    assert.ok(html.includes(expected)); assert.ok(!html.includes('<em>'));
  }
  assert.deepEqual(state, before);
});

test('all textarea consumers preserve literal text and line breaks in both item layouts', () => {
  const text = '<b>Буквальный & текст</b>\r\nВторая строка', escaped = '&lt;b&gt;Буквальный &amp; текст&lt;/b&gt;<br>Вторая строка';
  for (const dbl of [false, true]) {
    const state = { ...fixture, intro: text, footer: text + '\nhttps://example.invalid',
      items: fixture.items.map(item => ({ ...item, dbl, description: text, note: text })) }, before = structuredClone(state);
    for (const html of [template.SheetRender.sheetHTML(state), template.SheetRender.buildFullHTML(state)]) {
      assert.ok(html.includes('<div class="sh-intro">' + escaped + '</div>'));
      assert.ok(html.includes('<div class="sh-cardDesc">' + escaped + '</div>'));
      assert.ok(html.includes('<span class="sh-noteText">' + escaped + '</span>'));
      assert.ok(html.includes('<div class="sh-footer">' + escaped + '<br><a href="https://example.invalid"'));
      assert.ok(!html.includes('<b>'));
    }
    assert.deepEqual(state, before);
  }
});

test('immutable original print CSS, contract template and model match captured source hashes', () => {
  const manifest = template.sourceManifest;
  for (const name of ['public/css/app.css', 'public/css/contract.css', 'public/js/contract-model.js', 'lib/contract-docx.js', 'templates/contracts/furniture.docx']) {
    const bytes = readFileSync(template.assetPath(name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name].sha256, name);
  }
});

test('browser assets are a closed whitelist and offline fonts have pinned bytes', () => {
  for (const name of ['../.env', 'lib/contract-docx.js', 'templates/contracts/contractors.json', 'public/js/../../lib/kp-browser.js'])
    assert.throws(() => template.browserAsset(name), /KP_ASSET_NOT_FOUND/);
  const css = template.fontCss('data');
  assert.ok(css.includes('font-family: \'Manrope\'')); assert.ok(css.includes('data:font/woff2;base64,'));
  assert.ok(!css.includes('http:') && !css.includes('https:'));
  const fonts = template.fontManifest.files;
  assert.ok(fonts.length > 0);
  for (const font of fonts) assert.equal(createHash('sha256').update(readFileSync(path.join(template.assetRoot, font.path))).digest('hex'), font.sha256);
  const declarations = readFileSync(path.join(template.assetRoot, 'public/fonts/fonts.css'), 'utf8');
  assert.equal(createHash('sha256').update(declarations).digest('hex'), template.fontManifest.cssSha256);
  for (const [family, weights] of [['Manrope', [200, 300, 400, 600, 700]], ['JetBrains Mono', [400, 500, 700]], ['Spectral', [500, 600]]]) {
    const found = [...declarations.matchAll(/@font-face\s*\{([^}]+)\}/g)].filter(match => match[1].includes("font-family: '" + family + "'"))
      .map(match => Number(/font-weight:\s*([^;]+)/.exec(match[1])[1]));
    assert.deepEqual([...new Set(found)].sort((a, b) => a - b), weights, 'exact source font weights: ' + family);
  }
});
