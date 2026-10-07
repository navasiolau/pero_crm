import type {Prisma} from '@prisma/client';

// Одинаковый порядок: складская shared-блокировка до блокировок материалов/изделий.
// Заморозка запрещает также изменение норм, в том числе через количество изделия.
export async function warehouseMetadataGate(tx:Prisma.TransactionClient){
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock_shared(18436,94001)`;
 const states=await tx.$queryRaw<{phase:string}[]>`SELECT phase FROM "WarehouseAccountingState" WHERE id='main'`;
 if(states[0]?.phase==='FROZEN'||states[0]?.phase==='VERIFYING')throw Error('Склад временно закрыт для изменений до проверки нового учёта');
}
