"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Trash2} from 'lucide-react';
import {Button} from './ui/button';
import {ConfirmDeleteDialog} from './confirm-delete-dialog';
import {useOptionalProductInline} from './product-inline-provider';
import {createRequestId} from '@/lib/request-id';
import {isConfirmedProductDelete} from '@/lib/product-delete-ui';
import {readProductDeleteBaseline,deleteProductAction} from '@/server/products/actions';
import type {ProductDeleteBaseline,ProductDeleteInput} from '@/server/products/delete-contract';
export function ProductDeleteButton({productId,canManage,returnHref}:{productId:string;canManage:boolean;returnHref:string}){
 const [baseline,setBaseline]=useState<ProductDeleteBaseline|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const active=useRef(false),attempt=useRef<ProductDeleteInput|null>(null),preflight=useRef(false),inline=useOptionalProductInline(),router=useRouter();
 useEffect(()=>inline?.registerGuard('product-delete',async()=>preflight.current||(!active.current&&!attempt.current)),[inline]);
 async function open(){if(active.current||!canManage)return;active.current=true;setBusy(true);setError(null);try{
  if(attempt.current){if(attempt.current.productId!==productId)throw Error('Подтверждение относится к другому изделию');return;}
  preflight.current=true;try{if(inline&&!await inline.flush())throw Error('Сначала сохраните изменения изделия');}finally{preflight.current=false;}
  const result=await readProductDeleteBaseline(productId);if(!result.ok)throw Error(result.error);setBaseline(result.baseline);
 }catch(e){setError(e instanceof Error?e.message:'Не удалось открыть подтверждение');}finally{active.current=false;setBusy(false);}}
 async function confirm(){if(active.current||!baseline||!canManage)return false;active.current=true;setBusy(true);setError(null);try{
  attempt.current??={productId:baseline.productId,expectedUpdatedAt:baseline.expectedUpdatedAt,clientMutationId:createRequestId()};const current=attempt.current;
  if(current.productId!==productId)throw Error('Подтверждение относится к другому изделию');
  const result=await deleteProductAction(current);
  if(!result.ok){if(result.kind!=='failure')attempt.current=null;throw Error(result.error);}
  if(!isConfirmedProductDelete(result,current))throw Error('Не получено подтверждение удаления. Повторите тот же запрос');
  attempt.current=null;router.push(returnHref);router.refresh();return true;
 }catch(e){setError(e instanceof Error?e.message:'Не получено подтверждение удаления');return false;}finally{active.current=false;setBusy(false);}}
 if(!canManage)return null;
 return <div className="min-w-0"><Button variant="destructive" disabled={busy} className="min-h-11 gap-2 bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:text-white dark:hover:bg-destructive/90" onClick={()=>void open()}><Trash2 className="size-4"/>Удалить</Button>{error?<p role="alert" className="mt-2 break-words text-sm text-destructive">{error}</p>:null}
 <ConfirmDeleteDialog open={!!baseline} entityLabel={`изделие ${baseline?.number??''} «${baseline?.title??''}»`} warning="Изделие исчезнет из рабочих списков. Записи, файлы и финансовая история сохранятся." onOpenChange={value=>{if(!value&&!active.current&&!attempt.current)setBaseline(null);}} onConfirm={confirm}/></div>;
}
