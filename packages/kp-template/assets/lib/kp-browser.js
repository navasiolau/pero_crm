'use strict';

const { buildFullHTML } = require('../public/js/sheet-render');

async function launchBrowser() {
    if (process.env.VERCEL === '1' && process.env.VERCEL_ENV !== 'development' && process.platform === 'linux') {
        const chromium = require('@sparticuz/chromium');
        return require('puppeteer-core').launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
    }
    return require('puppeteer').launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
}

async function preparePage(browser, state, strictImages) {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: strictImages ? 2 : 1 });
    await page.emulateMediaType('print');
    await page.setContent(buildFullHTML(state), { waitUntil: 'networkidle0', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    const failed = await page.evaluate(async () => {
        const failures = [];
        await Promise.all(Array.from(document.images).map(async (image, index) => {
            if (!image.complete) await new Promise(resolve => {
                const timer = setTimeout(resolve, 10000);
                image.onload = image.onerror = () => { clearTimeout(timer); resolve(); };
            });
            if (!image.complete || image.naturalWidth === 0) failures.push(index);
        }));
        return failures;
    });
    if (strictImages && failed.length) {
        const error = new Error('Не удалось загрузить изображения КП №' + (state.order && state.order.number || 'без номера'));
        error.userMessage = error.message;
        throw error;
    }
    return page;
}

async function renderProposalImages(proposals) {
    const browser = await launchBrowser();
    const output = [];
    const deadline = Date.now() + 45000;
    try {
        for (const proposal of proposals) {
            const page = await preparePage(browser, proposal.state, true);
            const elements = await page.$$('.page');
            const images = [];
            for (const element of elements) {
                if (Date.now() > deadline) {
                    const error = new Error('Подготовка приложений заняла слишком много времени. Повторите скачивание');
                    error.userMessage = error.message;
                    throw error;
                }
                images.push(Buffer.from(await element.screenshot({ type: 'png' })));
            }
            output.push({ id: proposal.id, images: images });
            await page.close();
        }
        return output;
    } finally {
        await browser.close();
    }
}

module.exports = { launchBrowser, preparePage, renderProposalImages };
