import { prisma } from '@/lib/prisma';
import { clientVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from '@/server/access/visibility';

/** Общий справочник выбора клиента: та же сущность и политика доступа, что в «Клиентах». */
export async function listClientSelection(actor: VisibilityActor, query = '', limit?: number) {
  const current = await resolveVisibilityActor(prisma, actor);
  return prisma.client.findMany({ where: { AND: [clientVisibilityWhere(current), ...(query ? [{ OR: ['name', 'lastName', 'middleName', 'phone'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) }] : [])] },
    select: { id: true, name: true, lastName: true, middleName: true, phone: true, address: true },
    orderBy: [{ lastName: 'asc' }, { name: 'asc' }, { id: 'asc' }], ...(limit ? { take: limit } : {}) });
}
