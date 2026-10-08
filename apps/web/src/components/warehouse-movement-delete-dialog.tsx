'use client';
import {useEffect,useState,useCallback} from 'react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {ConfirmDeleteDialog} from './confirm-delete-dialog';
import {Button} from './ui/button';
import {createRequestId} from '@/lib/request-id';
import {formatAmount,formatQty,formatDateTime} from '@/lib/format';
import {deleteWarehouseMovement,previewWarehouseMovementDeletion} from '@/server/warehouse/deletion-actions';
import type {MovementDeletionPreview} from '@/server/warehouse/deletion-contracts';

const labels={INCOME:'Приход',EXPENSE:'Выдача',RETURN:'Возврат'};
const reasons={ROOT:'Выбранное движение',SOURCE:'Возврат удаляемой выдачи',STOCK:'Зависит от остатка',VALUATION:'Зависит от учётной стоимости'};
/** Один предпросмотр на журнал, единый server plan для списка и подтверждения. */
export function WarehouseMovementDeleteDialog({movementId,onClose}:{movementId:string;onClose:()=>void}){
  const [clientMutationId]=useState(createRequestId),[attempt,setAttempt]=useState(0);
  const [preview,setPreview]=useState<MovementDeletionPreview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const router=useRouter();
  const refresh=useCallback(()=>{setPreview(null);setLoading(true);setError('');setAttempt(value=>value+1);},[]);
  useEffect(()=>{
    let active=true;
    void previewWarehouseMovementDeletion(movementId).then(result=>{
      if(!active)return;
      if(result.ok)setPreview(result.preview);else setError(result.error);
    }).catch(()=>{if(active)setError('Не удалось получить расчёт. Повторите запрос.');}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[movementId,attempt]);
  return <ConfirmDeleteDialog open onOpenChange={open=>{if(!open)onClose();}} entityLabel="движение и перечисленные зависимые операции"
    warning="Операции сохранятся в истории как удалённые. Их влияние на склад, кассы и проекты будет отменено."
    confirmDisabled={loading||!preview} onConfirm={async()=>{
      if(!preview)return false;
      try{
        const result=await deleteWarehouseMovement({movementId,clientMutationId,planFingerprint:preview.planFingerprint});
        if(!result.ok){setError(result.error);if(result.error.includes('Обновите расчёт'))setPreview(null);return false;}
        toast.success('Движение и связанные операции удалены');router.refresh();return true;
      }catch{setError('Ответ не получен. Повторите подтверждение: запрос сохранён.');return false;}
    }}>
    {loading?<p role="status" className="text-sm">Проверяем связанные операции…</p>:null}
    {error?<div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" onClick={refresh}>Обновить расчёт</Button></div>:null}
    {preview?<div className="min-w-0 space-y-4 text-sm">
      <div><p className="font-semibold">{preview.materialName}</p><p>Остаток: {formatQty(preview.before.quantity)} → {formatQty(preview.after.quantity)} {preview.unit}</p><p>Стоимость запаса: {formatAmount(Number(preview.before.value),'BYN')} → {formatAmount(Number(preview.after.value),'BYN')}</p></div>
      <div><p className="font-semibold">Возврат в кассы</p>{preview.refunds.length?preview.refunds.map(cash=><p key={cash.cashAccountId}>{cash.cashName}: +{formatAmount(Number(cash.amount),cash.currency)}{cash.currency!=='BYN'?` (${formatAmount(Number(cash.bynAmount),'BYN')})`:''}</p>):<p>Кассы не изменятся</p>}</div>
      {preview.projects.length?<div><p className="font-semibold">Изменение расходов проектов</p>{preview.projects.map(project=><p key={project.id}>{project.number}: {Number(project.expenseDelta)>0?'+':''}{formatAmount(Number(project.expenseDelta),'BYN')}</p>)}</div>:null}
      <div><p className="mb-2 font-semibold">Будет удалено движений: {preview.movements.length}</p><ol className="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3">
        {preview.movements.map(row=><li key={row.id} className="border-b pb-2 last:border-0 last:pb-0"><p>{labels[row.type]} · {formatQty(row.quantity)} {preview.unit} · {formatAmount(Number(row.money),'BYN')}</p><p className="text-xs text-muted-foreground">{formatDateTime(row.date)}{row.productNumber?` · Изделие ${row.productNumber}`:''} · {reasons[row.reason]}</p></li>)}
      </ol></div>
    </div>:null}
  </ConfirmDeleteDialog>;
}
