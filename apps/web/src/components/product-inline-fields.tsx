"use client";
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { InlineTextField, InlineSelectField } from "@/components/inline-fields";
import { Card, CardContent } from "@/components/ui/card";
import { useProductInline } from "@/components/product-inline-provider";
import {ClientDialog} from "@/components/client-dialog";
import {Button} from "@/components/ui/button";
import {confirmedProductClientContacts,type ProductClientContact} from "@/lib/product-client-contacts";
import {InlineQuantityField} from "@/components/product-quantity-input";
import {productDraftTotal} from "@/lib/product-quantity-input";
import { formatAmount } from "@/lib/format";
export function ProductInlineTitle({ number, canManage }: { number: string; canManage: boolean }) {
  const { controller } = useProductInline();
  const title = controller("title");
  const state = useSyncExternalStore(title.subscribe, title.getSnapshot, title.getServerSnapshot);
  return <div className="min-w-0 flex-1"><h1 className="sr-only">{number} · {state.draft}</h1><InlineTextField id="product-inline-title" label="Название изделия" inputClassName="h-auto text-lg font-semibold" controller={title} readOnly={!canManage} /></div>;
}
export function ProductInlineContacts({canManage,clients}:{canManage:boolean;clients:ProductClientContact[]}){
 const{controller,derived}=useProductInline();const client=controller("project.clientId");
 const selected=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getServerSnapshot);
 const[createOpen,setCreateOpen]=useState(false);const contact=confirmedProductClientContacts(String(selected.baseline),clients,derived);
 const options=clients.map(row=>({value:row.id,label:row.label,hint:row.phone}));
 if(derived.clientId&&derived.clientLabel&&!options.some(row=>row.value===derived.clientId))options.push({value:derived.clientId,label:derived.clientLabel,hint:derived.phone??""});
 return<Card className="min-w-0"><CardContent className="flex min-w-0 flex-col gap-3 p-4 text-sm" data-product-contacts>
  <div className="flex min-w-0 items-start gap-3"><div className="min-w-0 flex-1"><InlineSelectField id="product-inline-client" label="Клиент" controller={client} readOnly={!canManage} options={options}/></div>{canManage?<Button type="button" variant="outline" className="mt-6 shrink-0" onClick={()=>setCreateOpen(true)}>Новый клиент</Button>:null}</div>
  <p id="product-client-phone" className="break-words"><span className="text-muted-foreground">Телефон: </span>{contact.known?contact.phone:"Не определён"}</p>
  <p id="product-client-address" className="break-words"><span className="text-muted-foreground">Адрес: </span>{contact.known?contact.address??"Не указан":"Не определён"}</p>
  <ClientDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={async id=>{client.setDraft(id);await client.commit();}}/>
 </CardContent></Card>;
}
export function ProductInlineDetails({ canManage, canEditTech, showAmount, currency, measurement, engineer, notice }: {
  canManage: boolean; canEditTech: boolean; showAmount: boolean; currency: string;
  notice?: ReactNode; measurement: ReactNode; engineer: ReactNode;
}) {
  const { controller } = useProductInline();
  const price = controller("expectedPrice"); const quantity = controller("quantity");
  const p = useSyncExternalStore(price.subscribe, price.getSnapshot, price.getServerSnapshot);
  const q = useSyncExternalStore(quantity.subscribe, quantity.getSnapshot, quantity.getServerSnapshot);
  const total=productDraftTotal(p.draft,q.draft);
  return <div className="flex min-w-0 flex-col gap-4" data-product-details>
    {notice?<Card className="min-w-0"><CardContent className="p-4 text-sm">{notice}</CardContent></Card>:null}
    <Card className="min-w-0"><CardContent className={showAmount?"grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1fr)] items-start gap-3 p-4 text-sm":"min-w-0 p-4 text-sm"} data-product-price-quantity>
      {showAmount?<InlineTextField id="product-inline-price" label="Цена, BYN" controller={price} inputMode="decimal" readOnly={!canManage}/>:null}
      <InlineQuantityField controller={quantity} readOnly={!canManage}/>
      {showAmount?<div className="min-w-0 break-words pt-6" aria-live="polite">Сумма: {formatAmount(total,currency)}</div>:null}
    </CardContent></Card>
    <Card className="min-w-0"><CardContent className="min-w-0 p-4"><InlineTextField id="product-inline-description" label="Техническое описание" controller={controller("description")} readOnly={!canEditTech} multiline largeDescription /></CardContent></Card>
    {measurement}
    {engineer}
  </div>;
}