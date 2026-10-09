import type {FileSection} from "@prisma/client";

export function productAttachmentGroups<T extends {id: string; section: FileSection}>(files: readonly T[], coverFileId?: string | null) {
  const visible = files.filter(file => file.id !== coverFileId);
  // Общие файлы задачи изделия остаются видимыми в документах производства.
  return {
    measurement: visible.filter(file => file.section === "MEASUREMENT"),
    production: visible.filter(file => file.section === "PRODUCTION" || file.section === "GENERAL"),
    installation: visible.filter(file => file.section === "INSTALLATION"),
  };
}
