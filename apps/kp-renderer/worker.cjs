'use strict';
const { renderPdf, renderPdfFile, rasterizePdf, renderDocx } = require('./render.cjs');
const { workingDirectory } = require('./pdf-stream.cjs');
async function launch({ spoolDirectory = process.env.PERO_KP_BROWSER_SPOOL_DIR } = {}) {
  const chromium = require('@sparticuz/chromium');
  const executablePath = process.env.PERO_KP_CHROMIUM_PATH || await chromium.executablePath();
  const args = process.env.PERO_KP_CHROMIUM_PATH ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] : chromium.args;
  const userDataDir = await workingDirectory(spoolDirectory, 'browser'), cache = await workingDirectory(spoolDirectory, 'cache');
  const browser = await require('puppeteer-core').launch({ executablePath, args: [...args, '--disk-cache-dir=' + cache, '--crash-dumps-dir=' + cache],
    userDataDir, env: { ...process.env, TMPDIR: cache, TMP: cache, TEMP: cache, XDG_CACHE_HOME: cache }, headless: true, timeout: 0, protocolTimeout: 0 });
  process.send({ type: 'browser', pid: browser.process()?.pid });
  return browser;
}
process.once('message', async input => {
  try {
    const result = input.kind === 'pdf-stream' ? await renderPdfFile(input, launch)
      : input.kind === 'rasterize' ? await rasterizePdf(input) : input.kind === 'docx' ? await renderDocx(input) : await renderPdf(input, launch);
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    const code = typeof error?.message === 'string' && /^KP_RENDER_[A-Z_]+$/.test(error.message) ? error.message : 'KP_RENDER_FAILED';
    process.send({ ok: false, code }, () => process.exit(1));
  }
});
