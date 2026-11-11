'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { FurnitureSpecifications: furniture, browserAsset } = require('../index.cjs');

test('legacy projection is deterministic and preserves source fields, labels and unknown input', () => {
    const legacy = { description: '  <b>Текст</b>\r\n', size: '200×100', note: ' ', products: [
        { title: 'Каркас', outer: 'Дуб' },
        { title: ' Модуль <1> ', outer: 'Белый', inner: 'Серый', hinges: 'Blum', drawers: 'Ящик', lighting: 'LED', extra: 'сохранено' },
        { title: 'Столешница с накладкой', outer: 'МДФ' },
        { inner: 'Фанера' },
    ] };
    const original = structuredClone(legacy);
    const projected = furniture.fromLegacy(legacy);
    assert.deepEqual(furniture.fromLegacy(legacy), projected);
    assert.deepEqual(furniture.normalize(projected), projected);
    assert.deepEqual(legacy, original);
    assert.deepEqual([projected.description, projected.size, projected.note], ['  <b>Текст</b>\r\n', '200×100', null]);
    assert.deepEqual(furniture.orderedSections(projected.sections).map(row => [row.label, row.value]), [
        ['Корпус', 'Дуб'],
        [' Модуль <1> ', 'Материал наружный: Белый\nМатериал внутренний: Серый'],
        ['Столешница с накладкой', 'Материал наружный: МДФ'],
        ['Материал внутренний', 'Фанера'],
        ['Фурнитура', ' Модуль <1> : Blum'],
        ['Подсветка', ' Модуль <1> : LED'],
        ['Внутреннее наполнение', ' Модуль <1> : Ящик'],
    ]);
});

test('validation rejects duplicate and noncanonical rows; UMD browser output matches server', () => {
    const projected = furniture.fromLegacy({ products: [{ title: 'Корпус', outer: 'X' }] });
    const [row] = projected.sections;
    for (const sections of [[row, row], [row, { ...row, id: 'new-id' }], [{ ...row, label: 'Каркас' }], [{ ...row, id: 'body', type: 'custom' }]]) {
        assert.equal(furniture.normalize({ ...projected, sections }), null);
    }
    assert.equal(furniture.normalize({ sections: [] }), null);
    const browser = vm.createContext({});
    vm.runInContext(browserAsset('public/js/furniture-specifications.js').toString(), browser);
    assert.equal(JSON.stringify(browser.FurnitureSpecifications.fromLegacy({ products: [{ title: 'Корпус', outer: 'X' }] })), JSON.stringify(projected));
});

test('empty recognized legacy titles survive and repeated sections aggregate without blank lines', () => {
    const projected = furniture.fromLegacy({ products: [
        { title: 'Каркас' }, { title: 'Фасад' }, { title: 'Каркас', outer: 'Дуб' },
        { title: 'Корпус' }, { title: 'Корпус', outer: 'Ясень' },
    ] });
    assert.deepEqual(projected.sections.map(section => [section.type, section.value]), [
        ['body', 'Дуб\nЯсень'], ['facade', ''],
    ]);
    assert.deepEqual(furniture.normalize({ ...projected, sections: [{ ...projected.sections[0], id: 'new-lifetime' }] })?.sections[0].id, 'new-lifetime');
});
