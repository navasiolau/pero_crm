import assert from 'node:assert/strict';
import test from 'node:test';
import {warehouseReadonlyRequest, inspectWarehouseFilenameRow, warehouseRowMetricsValid, warehouseCoverageStatus} from './plain-file-lists-readonly-supplement.mjs';
const origin = 'https://staging-crm.peromebel.by';
const decision = (path, method = 'GET', prefetch = false) => warehouseReadonlyRequest({url: origin + path, method, prefetch}, origin);
function node(tagName, textContent, attrs = {}, disabled = false) {return {tagName, textContent, disabled, scrollWidth: 100, clientWidth: 120, getAttribute: key => attrs[key] ?? null};}
function row({image = false, printable = false, extraText = '', media = 0, overflow = false, enabledTrash = false, extension = 'pdf'} = {}) {
 const name = `SYNTHETIC-DO-NOT-EXPORT.${extension}`, first = node(image ? 'BUTTON' : 'A', name, {href: '/api/finance/documents/synthetic-private-id', download: name});if (overflow) first.scrollWidth = 140;
 const buttons = [...(image ? [first] : []), ...(printable ? [node('BUTTON', '', {'aria-label': `Распечатать ${name}`})] : []), node('BUTTON', '', {'aria-label': `Удалить файл ${name}`}, !enabledTrash)];
 return {firstElementChild: first, textContent: name + extraText, querySelectorAll: query => query === 'button' ? buttons : Array(media).fill(node('IMG', ''))};
}
const previousStyle = globalThis.getComputedStyle;
globalThis.getComputedStyle = () => ({textOverflow: 'clip'});
test.after(() => {if (previousStyle === undefined) delete globalThis.getComputedStyle;else globalThis.getComputedStyle = previousStyle;});

test('warehouse read guard allows only warehouse/static/health/session GETHEAD and refuses original file bytes details exports and every write', () => {
 for (const path of ['/warehouse/movements', '/warehouse/movements?_rsc=bounded', '/api/auth/session', '/api/health', '/_next/static/chunks/synthetic.js']) for (const method of ['GET', 'HEAD']) assert.equal(decision(path, method), 'allow');
 for (const path of ['/api/files/original', '/api/finance/documents/original', '/warehouse/movements/export', '/projects/original', '/_next/image?url=original', '/warehouse/movements?materialId=original']) assert.equal(decision(path), 'deny');
 for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(decision('/warehouse/movements', method), 'block-write');
 assert.equal(decision('/warehouse/movements', 'GET', true), 'block-prefetch');assert.equal(warehouseReadonlyRequest({url: 'https://crm.peromebel.by/warehouse/movements', method: 'GET'}, origin), 'deny');
});

test('actual DOM probe produces only safe scalar booleans and never exports original name ID href HTML or text', () => {
 const result = inspectWarehouseFilenameRow(row({printable: true}), true);assert.equal(warehouseRowMetricsValid(result), true);
 assert.ok(Object.values(result).every(value => typeof value === 'boolean'));const encoded = JSON.stringify(result);for (const privateValue of ['DO-NOT-EXPORT', 'private-id', '/api/', 'textContent', 'href']) assert.equal(encoded.includes(privateValue), false);
});

test('image filename is a button with disabled financial trash; unsupported extension does not invent a printer', () => {
 assert.equal(warehouseRowMetricsValid(inspectWarehouseFilenameRow(row({image: true, extension: 'png', printable: true}), true)), true);
 assert.equal(warehouseRowMetricsValid(inspectWarehouseFilenameRow(row({extension: 'dwg'}), true)), true);
 assert.equal(warehouseRowMetricsValid(inspectWarehouseFilenameRow(row({extension: 'pdf'}), true)), false);
});

test('thumbnail metadata extra text enabled financial urn and clipped filename all fail closed', () => {
 for (const value of [{media: 1}, {extraText: ' 5MB'}, {enabledTrash: true}, {overflow: true}]) assert.equal(warehouseRowMetricsValid(inspectWarehouseFilenameRow(row(value), false)), false);
});

test('missing existing report rows is NOTEXERCISED and never a fabricated PASS', () => {
 assert.equal(warehouseCoverageStatus([]), 'NOT_EXERCISED_NO_EXISTING_REPORT_ROWS');assert.equal(warehouseCoverageStatus([{fileRows: 0, allRowsValid: true}]), 'NOT_EXERCISED_NO_EXISTING_REPORT_ROWS');assert.equal(warehouseCoverageStatus([{fileRows: 1, allRowsValid: false}]), 'STOP');assert.equal(warehouseCoverageStatus([{fileRows: 2, allRowsValid: true}]), 'PASS');
});