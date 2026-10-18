'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sourceManifest = require('./source-manifest.json');
const fontManifest = require('./fonts-manifest.json');
const assetRoot = path.join(__dirname, 'assets');
const SheetRender = require('./assets/public/js/sheet-render.js');
const ContractModel = require('./assets/public/js/contract-model.js');
const publicNames = new Set([
  'public/css/app.css', 'public/css/contract.css',
  'public/js/app.js', 'public/js/sheet-render.js', 'public/js/contract-model.js', 'public/js/contract-editor.js',
  'public/js/crm-transport.js', 'public/css/crm.css', 'public/fonts/fonts.css', 'public/icons/apple-touch-icon.png',
  'public/js/kp-list.js',
  ...fontManifest.files.map(font => font.path),
]);
function assetPath(name) {
  if (typeof name !== 'string' || !Object.hasOwn(sourceManifest.files, name) && !publicNames.has(name)) throw Error('KP_ASSET_NOT_FOUND');
  return path.join(assetRoot, name);
}
function browserAsset(name) {
  if (!publicNames.has(name)) throw Error('KP_ASSET_NOT_FOUND');
  return fs.readFileSync(assetPath(name));
}
function fontCss(mode = 'browser') {
  return fs.readFileSync(path.join(assetRoot, 'public/fonts/fonts.css'), 'utf8').replace(/url\(\.\/([a-f0-9]+\.woff2)\)/g, (_, file) => {
    if (!fontManifest.files.some(font => path.basename(font.path) === file)) throw Error('KP_FONT_NOT_CAPTURED');
    return 'url(' + (mode === 'data' ? 'data:font/woff2;base64,' + fs.readFileSync(path.join(assetRoot, 'public/fonts', file)).toString('base64') : '/kp/assets/fonts/' + file) + ')';
  });
}
function offlinePrintHTML(state) {
  return SheetRender.buildFullHTML(state).replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
    .replace('<style>', '<style>' + fontCss('data'));
}
function getKpTemplateIdentity() {
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const sourceManifestHash = digest(fs.readFileSync(path.join(__dirname, 'source-manifest.json')));
  const fontManifestHash = digest(fs.readFileSync(path.join(__dirname, 'fonts-manifest.json')));
  if (digest(fs.readFileSync(path.join(assetRoot, 'public/fonts/fonts.css'))) !== fontManifest.cssSha256) throw Error('KP_FONT_INTEGRITY_FAILED');
  const files = ['public/js/sheet-render.js', 'public/js/contract-model.js', 'lib/contract-docx.js', 'templates/contracts/furniture.docx'];
  const hashes = files.map(name => [name, digest(fs.readFileSync(assetPath(name)))]);
  for (const font of fontManifest.files) {
    if (digest(fs.readFileSync(path.join(assetRoot, font.path))) !== font.sha256) throw Error('KP_FONT_INTEGRITY_FAILED');
  }
  return { version: 'kp-2026-10-18-1', templateHash: digest(JSON.stringify({ hashes, sourceManifestHash, fontManifestHash })), sourceManifestHash,
    fontManifestHash, chromium: '141.0.0', puppeteer: '24.43.1' };
}
module.exports = { SheetRender, ContractModel, sourceManifest, fontManifest, assetRoot, assetPath, browserAsset, fontCss, offlinePrintHTML,
  KP_RENDER_LIMITS: require('./limits.cjs'),
  getKpTemplateIdentity,
  contractFileName: number => 'contract_' + SheetRender.toLatin(number).replace(/[^a-zA-Z0-9_.-]/g, '_') + '_Pero.docx',
  get contractTemplateVersion() { return require('./assets/lib/contract-docx.js').TEMPLATE_VERSION; },
  generateDocx: (...args) => require('./assets/lib/contract-docx.js').generateDocx(...args),
};
