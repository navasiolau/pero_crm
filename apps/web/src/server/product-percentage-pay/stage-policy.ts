import type { ProductPercentageKind,Role } from '@prisma/client';
export const PERCENTAGE_STAGE_POLICY={
 ENGINEERING:{recipient:'engineer',assignment:'engineerId',role:'ENGINEER',scheme:'PRODUCT_PERCENT_ENGINEERING',label:'Проектирование',recipientError:'Назначьте активного инженера'},
 ASSEMBLY:{recipient:'assembler',assignment:'assemblerId',role:'WORKER',scheme:'PRODUCT_PERCENT_ASSEMBLY',label:'Сборка',recipientError:'Назначьте активного сборщика с ролью рабочего'},
 INSTALLATION:{recipient:'mounter',assignment:'mounterId',role:'MOUNTER',scheme:'PRODUCT_PERCENT_INSTALLATION',label:'Монтаж',recipientError:'Назначьте активного монтажника'},
} as const satisfies Record<ProductPercentageKind,{recipient:string;assignment:string;role:Role;scheme:string;label:string;recipientError:string}>;

