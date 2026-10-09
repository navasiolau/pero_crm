import assert from 'node:assert/strict';
import test from 'node:test';
import {plainFileListRequestDecision, isPlainFileListStaticReadPath} from './plain-file-lists-staging-contract.mjs';
import {selectedUiReadRequest} from './plain-file-lists-selected-upload-ui.mjs';
import {warehouseReadonlyRequest} from './plain-file-lists-readonly-supplement.mjs';
const origin = 'https://staging-crm.peromebel.by';
const binding = {origin, paths: {project: '/projects/owned', product: '/products/199.5', financeProject: '/finance/projects/owned'}, finance: null, files: [], financeDocs: []};
const assets = ['/icon.svg?cache-key=20261009', '/_next/static/chunks/app/(app)/layout-abcd1234.js', '/_next/static/chunks/app/(app)/finance/projects/[id]/page-abcd1234.js', '/_next/static/chunks/app/(app)/finance/projects/%5Bid%5D/page-abcd1234.js'];
const forbidden = ['/_next/static/%2fprivate.js', '/_next/static/%5cprivate.js', '/_next/static/%252e%252e/private.js', '/_next/static/%GG/private.js', '/_next/static/%2e%2e/secret', '/api/files/unowned'];
const classifiers = [
 ['common115', request => plainFileListRequestDecision(request, binding).kind, 'continue'],
 ['selected115', request => selectedUiReadRequest(request, binding), 'allow'],
 ['warehouse115', request => warehouseReadonlyRequest(request, origin), 'allow'],
];
for (const [name, classify, allowed] of classifiers) test(name + ' allows actual grouped/dynamic Next assets and preserves read scope', () => {
 for (const pathname of assets) assert.equal(classify({url: origin + pathname, method: 'GET', prefetch: false}), allowed);
 for (const pathname of forbidden) {assert.equal(isPlainFileListStaticReadPath(pathname), false);assert.notEqual(classify({url: origin + pathname, method: 'GET', prefetch: false}), allowed);}
 assert.notEqual(classify({url: 'https://example.invalid' + assets[0], method: 'GET', prefetch: false}), allowed);
 assert.notEqual(classify({url: origin + assets[0], method: 'POST', prefetch: false}), allowed);
 assert.notEqual(classify({url: origin + assets[0], method: 'GET', prefetch: true}), allowed);
});
