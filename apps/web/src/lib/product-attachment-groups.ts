export function productAttachmentGroups<T extends { id: string; category: string; stage: string }>(files: readonly T[], coverFileId?: string | null) {
  const visible = files.filter(file => file.id !== coverFileId);
  // Категория замера важнее прежнего этапа; объекты и порядок не меняются.
  return {
    measurement: files.filter(file => file.category === "MEASUREMENT"),
    production: visible.filter(file => file.category !== "MEASUREMENT" && ["PRODUCTION", "ASSEMBLY"].includes(file.stage)),
    installation: visible.filter(file => file.category !== "MEASUREMENT" && file.stage === "INSTALLATION"),
  };
}
