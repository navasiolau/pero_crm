import type {Role} from './roles';
import {moneyAtoms,type DecimalInput} from './work-shares';
/** Только чистый инженер исключён из новых обычных начислений; совмещённые роли сохраняют выбранную схему. */
export function canAccrueOrdinarySalary(roles:Role[]):boolean{
 return !(roles.length===1 && roles[0]==='ENGINEER');
}
/** Старый денежный снимок остаётся обязательством; физическая/процентная доля сама по себе его не создаёт. */
export function hasFrozenTaskPieceObligation(task:{allocationGroupId:string|null;workId:string|null;shareUnits:number|null;shareAmount:DecimalInput|null;physicalOnlyShare:boolean;allocationGroup:{id:string;workId:string|null;budgetSource:string;budget:DecimalInput|null}|null}):boolean{
 const group=task.allocationGroup;
 if(!task.allocationGroupId||!group||group.id!==task.allocationGroupId||!task.workId||group.workId!==task.workId||group.budgetSource!=='TASK_FIXED'||task.physicalOnlyShare||task.shareAmount===null||group.budget===null||!Number.isSafeInteger(task.shareUnits)||task.shareUnits!<1||task.shareUnits!>1_000_000)return false;
 try{return moneyAtoms(task.shareAmount)<=moneyAtoms(group.budget);}catch{return false;}
}
