import type { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { OFFICE_ROLES } from "@/server/projects/queries";
import { taskDetailsInclude } from "@/server/tasks/queries";

// Видимость изделий = видимость родительских проектов (§4):
// офисные роли — все; работник/монтажник — изделия проектов со своими задачами.
function productVisibilityFilter(userId: string, role: Role) {
  if (OFFICE_ROLES.includes(role)) return {};
  return { project: { tasks: { some: { assigneeId: userId } } } };
}

// Общая таблица изделий (/products): номер, название, проект, клиент,
// статус, цена.
export async function listProducts(userId: string, role: Role) {
  return prisma.product.findMany({
    where: productVisibilityFilter(userId, role),
    include: {
      project: {
        select: {
          id: true,
          number: true,
          title: true,
          currency: true,
          client: { select: { name: true, lastName: true, middleName: true } },
        },
      },
    },
    orderBy: { number: "asc" },
  });
}

// Изделия проекта — опции для селектов (задача/работа/файл, вкладка «Задачи»)
export async function listProductOptions(projectId: string) {
  return prisma.product.findMany({
    where: { projectId },
    select: { id: true, number: true, title: true },
    orderBy: { number: "asc" },
  });
}

export async function getProductFor(
  userId: string,
  role: Role,
  productId: string,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, ...productVisibilityFilter(userId, role) },
    include: {
      project: {
        select: {
          id: true,
          number: true,
          title: true,
          currency: true,
          client: { select: { name: true, lastName: true, middleName: true } },
        },
      },
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
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  return product;
}
