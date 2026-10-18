// Однократная фиксация публичных шрифтов исходного шаблона; build не использует сеть.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
try { await access(path.join(root, 'fonts-manifest.json')); throw Error('FONT_MANIFEST_ALREADY_CAPTURED'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const source = 'https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;600;700&family=JetBrains+Mono:wght@400;500;700&family=Spectral:wght@500;600&display=swap';
const response = await fetch(source, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw Error('FONT_CSS_DOWNLOAD_FAILED');
let css = await response.text();
const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(match => match[1]))];
if (!urls.length) throw Error('FONT_CSS_HAS_NO_ASSETS');
await mkdir(path.join(root, 'assets/public/fonts'), { recursive: true });
const files = [];
for (const url of urls) {
  const font = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!font.ok) throw Error('FONT_BINARY_DOWNLOAD_FAILED');
  const bytes = Buffer.from(await font.arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== 'wOF2') throw Error('FONT_WOFF2_REQUIRED');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const relative = 'public/fonts/' + sha256.slice(0, 24) + '.woff2';
  if (!files.some(font => font.path === relative)) {
    await writeFile(path.join(root, 'assets', relative), bytes, { flag: 'wx' });
    files.push({ path: relative, sha256, bytes: bytes.length, source: url });
  }
  css = css.split(url).join('./' + path.basename(relative));
}
for (const family of ['manrope', 'jetbrainsmono', 'spectral']) {
  const url = `https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/OFL.txt`;
  const license = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!license.ok) throw Error('FONT_LICENSE_DOWNLOAD_FAILED');
  await writeFile(path.join(root, 'assets/public/fonts', family + '-OFL.txt'), await license.text(), { flag: 'wx' });
}
await writeFile(path.join(root, 'assets/public/fonts/fonts.css'), css);
await writeFile(path.join(root, 'fonts-manifest.json'), JSON.stringify({ source, capturedAt: '2026-10-18', cssSha256: createHash('sha256').update(css).digest('hex'), files }, null, 2) + '\n');
const check = await readFile(path.join(root, 'assets/public/fonts/fonts.css'), 'utf8');
if (/url\(https?:/i.test(check)) throw Error('FONT_EXTERNAL_URL_REMAINS');
console.log(JSON.stringify({ fontsCaptured: files.length, bytes: files.reduce((sum, font) => sum + font.bytes, 0) }));
