import {ProjectStage} from '@prisma/client';
import {z} from 'zod';
export const stageExtrasSchema=z.object({refusalReason:z.string().optional(),refusalComment:z.string().optional(),reclamationReason:z.string().optional(),reclamationDescription:z.string().optional(),reclamationFault:z.string().optional()}).strict();
export type StageExtras=z.infer<typeof stageExtrasSchema>;
export const projectStagePatchSchema=z.object({projectId:z.string().min(1),toStage:z.enum(ProjectStage),expectedStage:z.enum(ProjectStage),clientMutationId:z.uuid(),extras:stageExtrasSchema.optional()}).strict();
export type ProjectStagePatch=z.infer<typeof projectStagePatchSchema>;
export type ProjectStageResult={ok:boolean;kind:'saved'|'validation'|'conflict'|'forbidden'|'not-found'|'failure';clientMutationId?:string;stage?:ProjectStage;error?:string;errors?:Record<string,string>;noOp?:boolean;replayed?:boolean};
export function validateStageExtras(stage:ProjectStage,extras:StageExtras={}):Record<string,string>{
 const errors:Record<string,string>={};
 if(stage==='REFUSED'&&!extras.refusalReason?.trim())errors.refusalReason='Укажите причину отказа';
 if(stage==='RECLAMATION')for(const [key,label] of [['reclamationReason','Укажите причину рекламации'],['reclamationDescription','Опишите рекламацию'],['reclamationFault','Укажите виновную сторону']] as const)if(!extras[key]?.trim())errors[key]=label;
 return errors;
}
