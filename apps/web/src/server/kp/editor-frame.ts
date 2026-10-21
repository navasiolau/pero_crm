import { readFile } from 'node:fs/promises';
import { assetPath, type ProposalEditorBootstrap } from '@pero/kp-template';

export async function buildKpEditorFrame(bootstrap: ProposalEditorBootstrap): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(bootstrap.documentId) || !bootstrap.actorId || bootstrap.apiBase !== '/api/kp') throw Error('KP_EDITOR_BOOTSTRAP_INVALID');
  let html = await readFile(assetPath('app/index.html'), 'utf8');
  html = html.replace(/<header class="topbar">[\s\S]*?<\/header>/, '')
    .replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
    .replace(/<link[^>]+rel="manifest"[^>]*>/g, '')
    .replace(/href="\/css\//g, 'href="/kp/assets/css/').replace(/src="\/js\//g, 'src="/kp/assets/js/')
    .replace('href="/icons/apple-touch-icon.png"', 'href="/kp/assets/icons/apple-touch-icon.png"')
    .replace('</head>', '<link rel="stylesheet" href="/kp/assets/fonts/fonts.css"><link rel="stylesheet" href="/kp/assets/css/crm.css"></head>')
    .replace('<body>', '<body class="crm-loading"><div id="crmReadOnly" class="crm-readonly" role="status" hidden></div>');
  const json = JSON.stringify(bootstrap).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return html.replace('<script src="/kp/assets/js/sheet-render.js">', '<script id="peroCrmBootstrap" type="application/json">' + json + '</script><script src="/kp/assets/js/kp-list.js"></script><script src="/kp/assets/js/crm-transport.js"></script><script src="/kp/assets/js/sheet-render.js">');
}

export const kpPrivateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
};
