// Файловая конфигурация для мебельного производства (плагин file-stages).
// Чистые константы и функции валидации — без React/серверного кода, чтобы
// модуль можно было импортировать и в серверном роуте загрузки, и в
// клиентской вкладке файлов проекта.

/** Этапы (группы) файлов проекта. */
export const FILE_STAGES = [
  "PRODUCTION",
  "ASSEMBLY",
  "INSTALLATION",
] as const;
export type FileStageKey = (typeof FILE_STAGES)[number];

export const FILE_STAGE_LABELS: Record<FileStageKey, string> = {
  PRODUCTION: "Производство",
  ASSEMBLY: "Сборка",
  INSTALLATION: "Монтаж",
};

/** Типы файлов (категории) — совпадают с FileCategory из схемы Prisma. */
export const FILE_CATEGORIES = [
  "PHOTO",
  "DRAWING",
  "QUOTE",
  "MEASUREMENT",
  "DOCUMENT",
  "OTHER",
] as const;
export type FileCategoryKey = (typeof FILE_CATEGORIES)[number];

export const FILE_CATEGORY_LABELS: Record<FileCategoryKey, string> = {
  PHOTO: "Фото",
  DRAWING: "Чертёж",
  QUOTE: "КП",
  MEASUREMENT: "Замер",
  DOCUMENT: "Документ",
  OTHER: "Прочее",
};

/** Допустимые расширения по умолчанию (без точки, нижний регистр).
 *  Пустая строка = любые файлы. */
export const DEFAULT_EXTENSIONS: Record<FileCategoryKey, string> = {
  PHOTO: "jpg,jpeg,png,webp,heic,gif,bmp",
  DRAWING: "dwg,dxf,pdf,png,cdr,svg",
  QUOTE: "pdf,doc,docx,xls,xlsx,csv",
  MEASUREMENT: "jpg,jpeg,png,pdf,webp,heic",
  DOCUMENT: "pdf,doc,docx,xls,xlsx,csv,txt,rtf",
  OTHER: "",
};

function parseExtensions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") return [];
  return trimmed
    .split(/[,\s;]+/)
    .map((entry) => entry.replace(/^\./, "").trim().toLowerCase())
    .filter(Boolean);
}

/** Строит карту «категория → допустимые расширения» из настроек плагина. */
export function buildExtensionsMap(
  settings: Record<string, unknown>,
): Record<FileCategoryKey, string[]> {
  const map = {} as Record<FileCategoryKey, string[]>;
  for (const category of FILE_CATEGORIES) {
    const raw = settings[`ext_${category}`];
    const value = typeof raw === "string" ? raw : DEFAULT_EXTENSIONS[category];
    map[category] = parseExtensions(value);
  }
  return map;
}

/** Проверяет расширение файла по допустимому списку категории.
 *  Возвращает текст ошибки или null, если всё в порядке. */
export function validateFileForCategory(
  category: string,
  fileName: string,
  allowed: string[] | null | undefined,
): string | null {
  if (!allowed || allowed.length === 0) return null; // пусто = любые
  const ext = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const label = FILE_CATEGORY_LABELS[category as FileCategoryKey] ?? category;
  const list = allowed.join(", ");
  if (allowed.includes(ext)) return null;
  return ext
    ? `Файл с расширением .${ext} не подходит для категории «${label}». Допустимые расширения: ${list}.`
    : `У файла нет расширения, а для категории «${label}» оно обязательно. Допустимые: ${list}.`;
}
