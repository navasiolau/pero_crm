import strictAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import template from '../../../../../packages/kp-template/index.cjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Список определяется настоящим browserAsset исходного пакета, а не копией его whitelist.
function expectedPackage() {
  const candidates = new Set(template.fontManifest.files.map(font => font.path));
  function walk(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + '/' + entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name);
      else if (entry.isFile()) candidates.add(name);
      else throw Error('KP_TEMPLATE_SOURCE_FILE_TYPE');
    }
  }
  walk(path.join(template.assetRoot, 'public'), 'public');
  const assets = [];
  for (const name of [...candidates].sort()) {
    if (!/^public\/[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(part => part === '.' || part === '..')) throw Error('KP_TEMPLATE_SOURCE_PATH');
    try { const bytes = template.browserAsset(name); assets.push({ name, size: bytes.length, sha256: sha(bytes) }); }
    catch (error) { if (error.message !== 'KP_ASSET_NOT_FOUND') throw error; }
  }
  for (const extension of ['.js', '.css', '.woff2']) if (!assets.some(asset => asset.name.endsWith(extension))) throw Error('KP_TEMPLATE_SOURCE_ASSETS');
  return { template: template.getKpTemplateIdentity(), limits: template.KP_RENDER_LIMITS, assets };
}

// Самодостаточная функция: тот же код исполняется Node внутри exact web image.
function verifyPackage(expected, packageRequire, ports = { assert: strictAssert, createHash }) {
  const { assert, createHash } = ports;
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  let phase = 'require', asset;
  try {
    const packaged = packageRequire('@pero/kp-template'); phase = 'identity';
    const identity = packaged.getKpTemplateIdentity(); assert.deepEqual(identity, expected.template);
    phase = 'limits'; assert.deepEqual(packaged.KP_RENDER_LIMITS, expected.limits);
    phase = 'browser_asset';
    for (const row of expected.assets) {
      asset = row.name; const bytes = packaged.browserAsset(asset);
      assert.ok(Buffer.isBuffer(bytes)); assert.equal(bytes.length, row.size); assert.equal(digest(bytes), row.sha256);
    }
    phase = 'private_asset'; asset = undefined;
    for (const name of ['../.env', 'lib/contract-docx.js', 'public/js/../../lib/kp-browser.js'])
      assert.throws(() => packaged.browserAsset(name), /KP_ASSET_NOT_FOUND/);
    phase = 'contract_model';
    const state = { order: { number: '231' }, client: { name: 'CI synthetic customer' }, currency: 'BYN', items: [{ name: 'CI cabinet', price: 100, qty: 2 }] };
    const settings = packaged.ContractModel.defaults(state, 'primary', new Date('2026-10-18T09:00:00Z'));
    settings.deliveryAddress = 'CI synthetic address'; assert.deepEqual(settings.proposalIds, ['primary']);
    const checked = packaged.ContractModel.validate(settings, [{ id: 'primary', state }], [{ id: 'pero-by' }]);
    assert.deepEqual(checked.errors, []);
    return { status: 'PASSED', template: identity, assetsChecked: expected.assets.length,
      assetManifestSha256: digest(JSON.stringify(expected.assets)), limitsChecked: true, contractModelChecked: true, privateAssetsDenied: true };
  } catch (error) { error.kpPhase = phase; error.kpAsset = asset; throw error; }
}

function program(expected) {
  return Buffer.from(`'use strict';try{const r=require('node:module').createRequire('/app/apps/web/package.json');const ports={assert:require('node:assert/strict'),createHash:require('node:crypto').createHash};const result=(${verifyPackage.toString()})(${JSON.stringify(expected)},r,ports);console.log(JSON.stringify(result));}catch(error){console.log(JSON.stringify({status:'FAILED',code:/^(?:ERR_[A-Z_]+|E[A-Z0-9_]+|MODULE_NOT_FOUND)$/.test(error.code??'')?error.code:'KP_TEMPLATE_SMOKE_FAILED',phase:error.kpPhase??'bootstrap',asset:error.kpAsset}));process.exitCode=1;}`);
}
export { expectedPackage, program, verifyPackage };
const smoke = { expectedPackage, program, verifyPackage };
export default smoke;
