'use strict';
const { renderPdf, rasterizePdf, renderDocx } = require('./render.cjs');
async function launch() {
  const chromium = require('@sparticuz/chromium');
  const executablePath = process.env.PERO_KP_CHROMIUM_PATH || await chromium.executablePath();
  const args = process.env.PERO_KP_CHROMIUM_PATH ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] : chromium.args;
  const browser = await require('puppeteer-core').launch({ executablePath, args, headless: true, protocolTimeout: 30_000 });
  process.send({ type: 'browser', pid: browser.process()?.pid });
  return browser;
}
process.once('message', async input => {
  try {
    const result = input.kind === 'rasterize' ? await rasterizePdf(input) : input.kind === 'docx' ? await renderDocx(input) : await renderPdf(input, launch);
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    const code = typeof error?.message === 'string' && /^KP_RENDER_[A-Z_]+$/.test(error.message) ? error.message : 'KP_RENDER_FAILED';
    process.send({ ok: false, code }, () => process.exit(1));
  }
});
