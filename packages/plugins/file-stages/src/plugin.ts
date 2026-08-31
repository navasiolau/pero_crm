import { definePlugin } from "@pero/plugin-sdk";

import {
  DEFAULT_EXTENSIONS,
  FILE_CATEGORIES,
  FILE_CATEGORY_LABELS,
} from "./lib/file-stages";

// Плагин «Файловая конфигурация для мебельного производства»:
// группирует файлы проекта по этапам (Производство/Сборка/Монтаж) и
// проверяет расширение файла при загрузке согласно настраиваемым белым
// спискам по каждой категории.
export const fileStagesPlugin = definePlugin({
  id: "file-stages",
  name: "Файловая конфигурация для мебельного производства",
  version: "0.1.0",
  apiVersion: 1,
  description:
    "Группирует файлы проекта по этапам (Производство, Сборка, Монтаж) и проверяет расширение при загрузке. Белые списки расширений настраиваются по каждой категории файлов.",
  permissions: ["files:read", "files:write"],
  settingsSchema: FILE_CATEGORIES.map((category) => ({
    key: `ext_${category}`,
    label: `Расширения — ${FILE_CATEGORY_LABELS[category]}`,
    type: "string",
    description:
      "Список допустимых расширений через запятую (без точки). Пустое значение — разрешены любые файлы.",
    default: DEFAULT_EXTENSIONS[category],
  })),
});
