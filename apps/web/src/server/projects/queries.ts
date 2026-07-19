import type { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { taskDetailsInclude } from "@/server/tasks/queries";

// Правила видимости (§4): офисные роли — все проекты;
// работник/монтажник — только проекты со своими задачами.
export const OFFICE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"];
export const MANAGER_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER"];

function projectVisibilityFilter(userId: string, role: Role) {
  if (OFFICE_ROLES.includes(role)) return {};
  return { tasks: { some: { assigneeId: userId } } };
}

export async function listProjects(userId: string, role: Role) {
  return prisma.project.findMany({
    where: projectVisibilityFilter(userId, role),
    include: {
      client: { select: { id: true, name: true, lastName: true, middleName: true } },
      manager: { select: { id: true, name: true } },
      _count: { select: { tasks: true, files: true } },
    },
    orderBy: [{ stage: "asc" }, { stageChangedAt: "asc" }],
  });
}

export async function getProjectFor(
  userId: string,
  role: Role,
  projectId: string,
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectVisibilityFilter(userId, role) },
    include: {
      client: true,
      manager: { select: { id: true, name: true } },
      tasks: {
        include: taskDetailsInclude,
        orderBy: { createdAt: "desc" },
      },
      works: {
        include: {
          tasks: { select: { id: true, title: true, status: true, quantity: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      files: { orderBy: { createdAt: "desc" } },
      communications: { orderBy: { happenedAt: "desc" } },
      stageHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  return project;
}

export async function listClients() {
  return prisma.client.findMany({
    include: { _count: { select: { projects: true } } },
    orderBy: { name: "asc" },
  });
}

export async function listManagers() {
  return prisma.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "DIRECTOR", "MANAGER"] } },
    select: { id: true, name: true, role: true, position: true },
    orderBy: { name: "asc" },
  });
}

export async function listWorkers() {
  return prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["WORKER", "MOUNTER", "ENGINEER", "MANAGER"] },
    },
    select: { id: true, name: true, role: true, position: true },
    orderBy: { name: "asc" },
  });
}
