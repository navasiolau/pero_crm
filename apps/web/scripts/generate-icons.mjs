// Генерация иконок PWA для PERO CRM.
// Брендовый знак: перо (как в CRM v1), без подложки, лаймовые штрихи.
// Запуск: node scripts/generate-icons.mjs

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const INK = "#0a0a0a"; // чёрное перо, как основное лого в приложении

// Перо в кадре viewBox 24x24 (как icon.svg / Logo)
function featherSvg({ size, glyphFraction = 0.9 }) {
  const k = (size * glyphFraction) / 24;
  const d = (size - 24 * k) / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${d} ${d}) scale(${k})" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/>
    <path d="M16 8 2 22"/>
    <path d="M17.5 15H9"/>
  </g>
</svg>`;
}

async function render(options, outFile) {
  const out = join(appRoot, outFile);
  await mkdir(dirname(out), { recursive: true });
  await sharp(Buffer.from(featherSvg(options))).png().toFile(out);
  console.log("✔", outFile);
}

await render({ size: 192 }, "public/icons/icon-192.png");
await render({ size: 512 }, "public/icons/icon-512.png");
// Maskable: знак уменьшен в безопасную зону (фон прозрачный)
await render(
  { size: 512, glyphFraction: 0.55 },
  "public/icons/icon-maskable-512.png",
);
// Apple touch icon
await render({ size: 180, glyphFraction: 0.8 }, "src/app/apple-icon.png");

console.log("Иконки сгенерированы.");
