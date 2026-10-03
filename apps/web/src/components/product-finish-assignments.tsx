"use client";
import {useEffect,useState,useSyncExternalStore} from "react";
import {Trash2} from "lucide-react";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {SearchableSelect,type SearchableOption} from "@/components/ui/searchable-select";
import {InlineTextField,InlineSelectField} from "@/components/inline-fields";
import {ConfirmDeleteDialog} from "@/components/confirm-delete-dialog";
import {useProductInline} from "@/components/product-inline-provider";
import {getProductFinishController} from "@/lib/product-finish-controller";
import {invokeProductFinishPatch} from "@/lib/independent-product-finish-action";
import {FINISH_KIND_LABELS,type FinishView} from "@/server/finishes/contracts";
import type {ProductFinishInitial,ProductFinishRow} from "@/server/product-finishes/contracts";
const label=(row:Pick<FinishView,"name"|"code"|"color">)=>`${row.name} · ${row.code} · ${row.color}`;
const snapshotLabel=(row:ProductFinishRow)=>label({name:row.finishName,code:row.finishCode,color:row.finishColor});
export function ProductFinishAssignments({productId,initial,choices,canEdit}:{productId:string;initial:ProductFinishInitial;choices:FinishView[];canEdit:boolean}){
 const inline=useProductInline();const group=getProductFinishController(inline.controller("quantity"),{productId,initial,save:invokeProductFinishPatch});
 const state=useSyncExternalStore(group.subscribe,group.getSnapshot,group.getServerSnapshot);const[deleteId,setDeleteId]=useState<string|null>(null);
 useEffect(()=>{group.receive(initial);},[group,initial]);
 useEffect(()=>inline.registerGuard("finish-assignments",group.flush),[inline,group]);
 const active=choices.filter(row=>row.active),newOptions=active.map(row=>({value:row.id,label:label(row)}));
 const deleteRow=state.rows.find(row=>row.id===deleteId);
 return <Card className="min-w-0" data-product-finishes><CardHeader><CardTitle>Покрытия элементов</CardTitle></CardHeader><CardContent className="flex min-w-0 flex-col gap-4">
  {state.rows.map(row=>{const options:SearchableOption[]=active.map(choice=>({value:choice.id,label:choice.id===row.finishId?snapshotLabel(row):label(choice)}));if(!options.some(choice=>choice.value===row.finishId))options.push({value:row.finishId,label:snapshotLabel(row),disabled:true});
   return <div key={row.id} data-finish-assignment={row.id} className="min-w-0 space-y-2 rounded-lg border p-3"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><InlineTextField id={`finish-element-${row.id}`} label="Элемент" controller={group.controller(row.id,"element")} readOnly={!canEdit}/><InlineSelectField id={`finish-choice-${row.id}`} label="Покрытие" controller={group.controller(row.id,"finishId")} options={options} readOnly={!canEdit}/></div>
    <p className="break-words text-sm text-muted-foreground">{FINISH_KIND_LABELS[row.finishKind]} · {row.finishName} · {row.finishCode} · {row.finishColor}</p>
    {state.removeErrors[row.id]?<p role="alert" className="break-words text-sm text-destructive">{state.removeErrors[row.id]}</p>:null}
    {canEdit?<Button type="button" variant="ghost" size="sm" onClick={()=>setDeleteId(row.id)}><Trash2 className="size-4"/>Удалить элемент</Button>:null}
   </div>;
  })}
  {Object.entries(state.removeErrors).filter(([id])=>!state.rows.some(row=>row.id===id)).map(([id,error])=><div key={id} className="min-w-0 space-y-2"><p role="alert" className="break-words text-sm text-destructive">{error}</p>{canEdit?<Button variant="outline" onClick={()=>void group.remove(id)}>Проверить прежнее удаление</Button>:null}</div>)}
  {!state.rows.length?<p className="text-sm text-muted-foreground">Покрытия элементов пока не заданы.</p>:null}
  {canEdit?<div className="min-w-0 space-y-3 rounded-lg border border-dashed p-3"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-1.5"><Label htmlFor={`finish-new-element-${productId}`}>Новый элемент</Label><Input id={`finish-new-element-${productId}`} list={`finish-elements-${productId}`} value={state.newElement} maxLength={100} onChange={event=>group.setNew("newElement",event.target.value)} placeholder="Корпус, фасады, столешница…"/><datalist id={`finish-elements-${productId}`}><option value="Корпус"/><option value="Фасады"/><option value="Столешница"/></datalist></div><div className="min-w-0 space-y-1.5"><Label>Покрытие</Label><SearchableSelect id={`finish-new-choice-${productId}`} value={state.newFinishId} options={newOptions} onChange={value=>group.setNew("newFinishId",value??"")} placeholder="Выберите вариант…" className="min-w-0 max-w-full"/></div></div>
   {state.error?<p role="alert" className="break-words text-sm text-destructive">{state.error}</p>:null}
   <div className="flex flex-wrap gap-2"><Button disabled={state.newStatus==="saving"} onClick={()=>void group.add()}>{state.newStatus==="saving"?"Сохраняется…":"Добавить элемент"}</Button>{state.newStatus==="error"?<Button variant="outline" onClick={()=>void group.retryAdd()}>Повторить запрос</Button>:null}{state.newStatus==="conflict"?<Button variant="outline" onClick={()=>void group.rebaseAdd()}>Подтвердить и повторить</Button>:null}<Button variant="ghost" onClick={()=>group.clearNew()}>Очистить новую строку</Button></div>
  </div>:null}
  <ConfirmDeleteDialog open={deleteId!==null} onOpenChange={open=>{if(!open){if(deleteId)group.cancelRemove(deleteId);setDeleteId(null);}}} entityLabel={`элемент «${deleteRow?.element??""}»`} warning="Будет удалено только назначение покрытия этого элемента. Каталог и финансовые данные сохранятся." onConfirm={async()=>deleteId?group.remove(deleteId):false}/>
 </CardContent></Card>;
}
