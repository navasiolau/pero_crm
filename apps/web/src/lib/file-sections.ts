import type {FileSection} from "@prisma/client";

export const FILE_SECTIONS = ["GENERAL", "MEASUREMENT", "PRODUCTION", "INSTALLATION"] as const satisfies readonly FileSection[];
export const PRODUCT_FILE_SECTIONS = ["MEASUREMENT", "PRODUCTION", "INSTALLATION"] as const;
export const FILE_SECTION_LABELS: Record<FileSection, string> = {
  GENERAL: "Файлы",
  MEASUREMENT: "Замер",
  PRODUCTION: "Производство",
  INSTALLATION: "Монтаж",
};
export function isFileSection(value: unknown): value is FileSection {
  return typeof value === "string" && FILE_SECTIONS.some(section => section === value);
}
