import {z} from 'zod';
const identity={namespace:z.string().min(1).max(64),botId:z.string().regex(/^[1-9]\d{0,15}$/)};
export const telegramClaimSchema=z.object({...identity,requestId:z.uuid()}).strict();
export const telegramAuthorizeSchema=z.object({...identity,id:z.string().min(1).max(128),claimId:z.uuid()}).strict();
export const telegramAckSchema=z.discriminatedUnion('outcome',[
 z.object({...identity,id:z.string().min(1).max(128),claimId:z.uuid(),outcome:z.literal('sent'),messageId:z.string().regex(/^[1-9]\d{0,15}$/)}).strict(),
 z.object({...identity,id:z.string().min(1).max(128),claimId:z.uuid(),outcome:z.literal('rate-limit'),retryAfterSeconds:z.number().int().min(1).max(3600)}).strict(),
 z.object({...identity,id:z.string().min(1).max(128),claimId:z.uuid(),outcome:z.enum(['rejected','unknown'])}).strict(),
]);
export type TelegramClaim={id:string;claimId:string;namespace:string;ownerId:string;chatId:string;text:string};
