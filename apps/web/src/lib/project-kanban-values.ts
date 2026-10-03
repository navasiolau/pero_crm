import type { ProjectStage } from "@prisma/client";
type StageAgeSource = { stage: ProjectStage; createdAt: string | Date; stageChangedAt: string | Date; latestTransition?: { toStage: ProjectStage; createdAt: string | Date } | null };
function validDate(value: string | Date): boolean { return Number.isFinite(new Date(value).getTime()); }
export function projectStageAgeStart(project: StageAgeSource): string | Date {
  if (project.latestTransition?.toStage === project.stage && validDate(project.latestTransition.createdAt)) return project.latestTransition.createdAt;
  if (!project.latestTransition && project.stage === "LEAD") return project.createdAt;
  return project.stageChangedAt;
}
export function projectStageDays(start: string | Date, now = Date.now()): number | null {
  const elapsed = now - new Date(start).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 86_400_000) : null;
}
export function projectKanbanAmount(value: string | null, currency: string): string {
  if (value === null || currency !== "BYN" || value.trim() === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? new Intl.NumberFormat("ru-RU").format(amount) : "—";
}
