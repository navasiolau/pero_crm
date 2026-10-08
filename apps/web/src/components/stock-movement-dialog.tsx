"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StockMaterialPicker } from "@/components/stock-material-fields";
import { createRequestId } from "@/lib/request-id";
import { quantityInput, priceInput } from "@/lib/warehouse-cost";
import { formatQty, formatDate } from "@/lib/format";
import { requestMaterial, returnMaterial } from "@/server/warehouse/actions";
import type { MaterialOption, ProjectMaterialLine, WarehouseReturnSource } from "@/server/warehouse/contracts";

/** Mounted once per opened command: retry keeps its UUID and selected snapshots. */
export function StockMovementDialog({ mode, productId, options, sources, lines, initialMaterialId, initialSourceId, warehouseReady, showMoney, onClose }: {
 mode:"issue"|"return";productId:string;options:MaterialOption[];sources:WarehouseReturnSource[];lines:ProjectMaterialLine[];
 initialMaterialId?:string;initialSourceId?:string;warehouseReady:boolean;showMoney:boolean;onClose:()=>void;
}) {
 const [pending,startTransition]=useTransition(),[clientMutationId]=useState(createRequestId);
 const [materials]=useState(options),[returnSources]=useState(()=>sources.filter(source=>!initialMaterialId||source.materialId===initialMaterialId));
 const [legacyLines]=useState(()=>lines.filter(line=>line.legacyReturnQuantity>0&&(!initialMaterialId||line.materialId===initialMaterialId)));
 const [materialId,setMaterialId]=useState(initialMaterialId??"");
 const [sourceId,setSourceId]=useState(initialSourceId??returnSources[0]?.id??(legacyLines[0]?"legacy:"+legacyLines[0].id:""));
 const source=mode==="return"?returnSources.find(row=>row.id===sourceId):undefined;
 const legacy=mode==="return"?legacyLines.find(row=>"legacy:"+row.id===sourceId):undefined;
 const material=materials.find(row=>row.id===materialId);
 const maximum=mode==="issue"?material?.stock??0:source?.quantity??legacy?.legacyReturnQuantity??0;
 const unit=mode==="issue"?material?.unit:source?.unit??legacy?.unit;
 const [quantity,setQuantity]=useState(mode==="return"?String(maximum||""):""),[unitPrice,setUnitPrice]=useState(""),[comment,setComment]=useState("");
 let valid=false;
 try{const value=Number(quantityInput(quantity));valid=value<=maximum&&(mode==="issue"?Boolean(material):Boolean(source||legacy));if(legacy)priceInput(unitPrice);}catch{valid=false;}
 const canSubmit=valid&&!pending&&warehouseReady;
 return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose();}}>
  <DialogContent><DialogHeader><DialogTitle>{mode==="issue"?"Выдать материал на изделие":"Вернуть материал на склад"}</DialogTitle>
   <DialogDescription>{mode==="issue"?"Количество и стоимость спишутся со склада и попадут в расходы проекта.":legacy?"Исторический возврат по указанной фактической оценке.":"Стоимость возврата определяется исходной выдачей."}</DialogDescription></DialogHeader>
   <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
    {mode==="issue"?<StockMaterialPicker id="stock-material" materials={materials} value={materialId} onChange={setMaterialId} disabled={pending}/>:<div className="flex min-w-0 flex-col gap-1.5">
     <Label htmlFor="stock-source">Исходная выдача *</Label>
     <SearchableSelect id="stock-source" value={sourceId} disabled={pending} onChange={value=>{setSourceId(value);setQuantity("");setUnitPrice("");}}
      options={[...returnSources.map(item=>({value:item.id,label:`${item.materialName} · ${formatDate(item.createdAt)}`,hint:`можно вернуть ${formatQty(item.quantity)} ${item.unit}`})),
       ...legacyLines.map(line=>({value:"legacy:"+line.id,label:line.materialName+" · до нового учёта",hint:`можно вернуть ${formatQty(line.legacyReturnQuantity)} ${line.unit}`}))]}
      placeholder="Выберите выдачу…" searchPlaceholder="Поиск по материалу…" emptyText="Нет доступных возвратов"/>
    </div>}
    <div className="flex flex-col gap-1.5"><Label htmlFor="stock-quantity">Количество на всю партию{unit?", "+unit:""} *</Label>
     <Input id="stock-quantity" inputMode="decimal" value={quantity} onChange={event=>setQuantity(event.target.value)} placeholder="0"/>
     <p className="text-xs text-muted-foreground">{mode==="issue"?"На складе":"Можно вернуть"}: {formatQty(maximum)} {unit??""}</p>
    </div>
    {legacy?<div className="flex flex-col gap-1.5"><Label htmlFor="stock-legacy-price">Фактическая цена, BYN *</Label><Input id="stock-legacy-price" inputMode="decimal" value={unitPrice} onChange={event=>setUnitPrice(event.target.value)}/></div>
      :source?.unitPrice&&showMoney?<p className="text-sm text-muted-foreground">Цена исходной выдачи: {new Intl.NumberFormat("ru-RU",{maximumFractionDigits:9}).format(Number(source.unitPrice))} BYN</p>:null}
    <div className="flex flex-col gap-1.5"><Label htmlFor="stock-comment">Комментарий</Label><Input id="stock-comment" value={comment} onChange={event=>setComment(event.target.value)}/></div>
    {!warehouseReady?<p role="note" className="text-sm text-muted-foreground">Склад временно закрыт для операций.</p>:null}
   </fieldset>
   <DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>Отмена</Button><Button disabled={!canSubmit} onClick={()=>startTransition(async()=>{
    try{
     const common={clientMutationId,quantity,comment:comment.trim()||undefined};
     const result=mode==="issue"?await requestMaterial({...common,productId,materialId})
       :legacy?await returnMaterial({...common,projectMaterialId:legacy.id,unitPrice})
       :await returnMaterial({...common,productId,sourceMovementId:source!.id});
     if(result.ok){toast.success(mode==="issue"?"Материал выдан на изделие":"Материал возвращён на склад");onClose();}
     else toast.error(result.error??"Ошибка операции");
    }catch{toast.error("Ответ не получен. Повторите сохранение: идентификатор операции сохранён.");}
   })}>{pending?"Сохранение…":mode==="issue"?"Выдать":"Вернуть"}</Button></DialogFooter>
  </DialogContent>
 </Dialog>;
}
