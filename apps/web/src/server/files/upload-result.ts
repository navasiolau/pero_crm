export type UploadPhase = "auth"|"request"|"context"|"validation"|"image"|"storage-original"|"storage-thumb"|"persist"|"confirmation";
export type CommitState = "notCommitted"|"committed"|"unknown";
export class UploadError extends Error {
  constructor(public code:string, public status:number, public phase:UploadPhase, message:string,
    public kind="failure", public commitState:CommitState="notCommitted") { super(message); }
}
export function uploadFailure(requestId:string, phase:UploadPhase, error?:unknown, commitState:CommitState="notCommitted") {
  const known=error instanceof UploadError;
  const storage=phase==="storage-original"||phase==="storage-thumb";
  const names:Record<string,string>={AccessDenied:"STORAGE_ACCESS_DENIED",InvalidAccessKeyId:"STORAGE_AUTH_FAILED",SignatureDoesNotMatch:"STORAGE_AUTH_FAILED",
    NoSuchBucket:"STORAGE_BUCKET_MISSING",TimeoutError:"STORAGE_TIMEOUT",ETIMEDOUT:"STORAGE_TIMEOUT",ECONNREFUSED:"STORAGE_UNAVAILABLE",ENOTFOUND:"STORAGE_UNAVAILABLE"};
  const safeName=error instanceof Error?error.name:"";
  const safeCode=error&&typeof error==="object"&&"code"in error&&typeof error.code==="string"?error.code:"";
  const code=known?error.code:error instanceof Error&&error.message==="STORAGE_CONFIG_INVALID"?"STORAGE_CONFIG_INVALID":
    storage?(names[safeName]??names[safeCode]??"STORAGE_WRITE_FAILED"):"UPLOAD_FAILED";
  const message=known?error.message:"Не удалось загрузить файл. Повторите тот же запрос.";
  const explanations:Record<string,string>={
    STORAGE_ACCESS_DENIED:"Хранилище отказало в доступе к записи. Администратору нужно проверить разрешения приложения.",
    STORAGE_AUTH_FAILED:"Хранилище не подтвердило учётные данные приложения. Администратору нужно проверить настройки доступа.",
    STORAGE_BUCKET_MISSING:"Настроенный контейнер файлов не найден в хранилище. Администратору нужно проверить конфигурацию.",
    STORAGE_TIMEOUT:"Хранилище не ответило за отведённое время. Повторите тот же запрос.",
    STORAGE_UNAVAILABLE:"Приложение не смогло соединиться с хранилищем. Повторите тот же запрос или сообщите администратору.",
    STORAGE_CONFIG_INVALID:"Режим или обязательные параметры файлового хранилища настроены неверно. Нужна проверка конфигурации приложения.",
  };
  return {status:known?error.status:code==="STORAGE_TIMEOUT"||code==="STORAGE_UNAVAILABLE"?503:500,body:{ok:false,error:message,kind:known?error.kind:"failure",
    code,
    requestId,details:{phase:known?error.phase:phase,message:explanations[code]??message},commitState:known?error.commitState:commitState}};
}

/** Delivery failures are separate from the already committed file acknowledgement. */
export async function afterUploadCommit(effect:()=>Promise<unknown>,requestId:string){
  try {await effect();} catch {console.warn(JSON.stringify({event:"file.upload.delivery_failed",requestId,phase:"confirmation"}));}
}
