import {object,string,uuid,type input} from 'zod';
import type {DeletionReason} from './deletion-plan';

export const movementDeletionSchema=object({movementId:string().min(1),clientMutationId:uuid().transform(id=>id.toLowerCase()),planFingerprint:string().regex(/^[a-f0-9]{64}$/)}).strict();
export type MovementDeletionInput=input<typeof movementDeletionSchema>;
export type MovementDeletionPreview={
  movementId:string;planFingerprint:string;materialName:string;unit:string;
  before:{quantity:string;value:string};after:{quantity:string;value:string};
  movements:{id:string;type:'INCOME'|'EXPENSE'|'RETURN';date:string;quantity:string;money:string;productNumber:string|null;reason:DeletionReason}[];
  refunds:{cashAccountId:string;cashName:string;currency:string;amount:string;bynAmount:string}[];
  projects:{id:string;number:string;expenseDelta:string}[];
};
