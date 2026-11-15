import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";

const knownNames = [
  ...FurnitureSpecifications.CATALOG.map(row => row.label),
  "Каркас", "Фасадная часть", "Петли / механизмы", "Ящики / наполнение",
  "Вставки/ручки", "Вставки / ручки", "Вставки", "Ручки", "Вставка в ручки",
  "Наполнение внутреннее", "Наполнение мягкое",
].sort((left, right) => right.length - left.length);

function namedLine(line: string): { label: string; value: string } | null {
  const numbered = /^\s*\d+[.)]\s*/.exec(line);
  const content = numbered ? line.slice(numbered[0].length) : line;
  const colon = /^([^:]+):[ \t]?(.*)$/.exec(content);
  if (colon) {
    const label = colon[1].trim();
    // URL, время и разметка остаются буквальным текстом, а не именами материалов.
    if (label.length <= 120 && /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 _()/–—-]*$/.test(label) &&
      !colon[2].startsWith("//")) return { label, value: colon[2] };
  }
  if (!numbered) return null;
  const lower = content.toLocaleLowerCase("ru");
  const known = knownNames.find(name => lower === name.toLocaleLowerCase("ru") ||
    lower.startsWith(`${name.toLocaleLowerCase("ru")} `) || lower.startsWith(`${name.toLocaleLowerCase("ru")}\t`));
  return known ? { label: content.slice(0, known.length), value: content.slice(known.length).replace(/^[ \t]/, "") } : null;
}

/** Только проекция старого текста: raw description никогда не переписывается. */
export function parseLegacyProductDescription(rawDescription: string | null): TechnicalSpecifications {
  const result = FurnitureSpecifications.empty();
  if (rawDescription === null || rawDescription === "") return result;
  let current: FurnitureSection | undefined;
  for (const match of rawDescription.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match[0] === "") continue;
    const named = namedLine(match[1]);
    if (named || !current) {
      current = { id: `legacy-${result.sections.length}`, type: "custom", group: "construction",
        label: named?.label ?? "", value: named ? named.value + match[2] : match[0] };
      result.sections.push(current);
    } else current.value += match[0];
  }
  return result;
}

/** Явный JSON, в том числе пустой, всегда важнее сохранённого старого текста. */
export function effectiveProductSpecifications(input: unknown, rawDescription: string | null): TechnicalSpecifications | null {
  return input == null ? parseLegacyProductDescription(rawDescription) : FurnitureSpecifications.normalizeProduct(input);
}
