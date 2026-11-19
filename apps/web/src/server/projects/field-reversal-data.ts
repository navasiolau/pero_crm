import type { Project } from "@prisma/client";
import { cardFieldRevision, fieldCommand } from "@/server/changelog/field-reversal";
import { projectServiceSnapshot } from "@/lib/project-services";

export const PROJECT_CARD_FIELDS = ["title", "managerId", "address", "contactBinding", "services"] as const;
export type ProjectCardField = typeof PROJECT_CARD_FIELDS[number];
export type ProjectCardRow = Pick<Project, "title" | "managerId" | "address" | "clientId" | "contactPerson" |
  "servicesTotal" | "delivery" | "unloading" | "installation" | "fieldRevisions">;
type ContactBinding = Pick<ProjectCardRow, "clientId" | "contactPerson" | "fieldRevisions">;
export function projectContactState(project: ContactBinding) {
  return { value: { clientId: project.clientId, contactPerson: project.contactPerson },
    revision: cardFieldRevision(project.fieldRevisions, "clientId,contactPerson") };
}
export function projectContactCommand(before: ContactBinding, after: ContactBinding) {
  return fieldCommand(projectFieldKind("contactBinding"), projectContactState(before), projectContactState(after));
}

export const projectFieldKind = (field: ProjectCardField) => `project.${field}`;

type ServicesRow = Pick<ProjectCardRow, "servicesTotal" | "delivery" | "unloading" | "installation" | "fieldRevisions">;
export function projectServiceState(project: ServicesRow) {
  return { value: projectServiceSnapshot(project), revision: cardFieldRevision(project.fieldRevisions, "servicesTotal,delivery,unloading,installation") };
}

export function projectFieldState(field: ProjectCardField, project: ProjectCardRow) {
  if (field === "contactBinding") return projectContactState(project);
  if (field === "services") return projectServiceState(project);
  return { value: project[field], revision: cardFieldRevision(project.fieldRevisions, field) };
}

export function projectFieldCommand(field: ProjectCardField, before: ProjectCardRow, after: ProjectCardRow) {
  return fieldCommand<ReturnType<typeof projectFieldState>["value"]>(projectFieldKind(field), projectFieldState(field, before), projectFieldState(field, after));
}
