"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from 'next/navigation';
import { InlineSelectField, InlineTextField } from "@/components/inline-fields";
import { ClientDialog } from "@/components/client-dialog";
import { Button } from "@/components/ui/button";
import type { ProductClientContact } from "@/lib/product-client-contacts";
import { Badge } from "@/components/ui/badge";
import { stageLabels, stageStyles } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { formatAmount, formatMoneyTotal } from "@/lib/format";
import { confirmedProjectTotal } from "@/lib/project-inline-values";
import { useProjectInline } from "@/components/project-inline-provider";
import type { InlineSaveController } from "@/lib/inline-save-controller";
export function ProjectInlineHeading({ number }: { number: string }) {
 const { controller, stage } = useProjectInline();const title=controller("title");
 const state=useSyncExternalStore(title.subscribe,title.getSnapshot,title.getServerSnapshot);
 return <><h1 className="min-w-0 break-words text-2xl font-semibold">{number} · {state.draft}</h1><Badge variant="outline" className={cn("border-transparent",stageStyles[stage].badge)}>{stageLabels[stage]}</Badge></>;
}
function useConfirmedService(controller: InlineSaveController) {
 const baseline=useSyncExternalStore(controller.subscribe,()=>controller.getSnapshot().baseline,()=>controller.getServerSnapshot().baseline);
 const pending=useSyncExternalStore(controller.subscribe,()=>!["idle","saved"].includes(controller.getSnapshot().status),()=>!["idle","saved"].includes(controller.getServerSnapshot().status));
 return {baseline,pending};
}
export function ProjectConfirmedTotal() {
 const {controller,productsSubtotalBYN,pricingError,services,roundingAdjustment}=useProjectInline();
 const delivery=controller("delivery"),unloading=controller("unloading"),installation=controller("installation"),general=controller("servicesTotal");
 const d=useConfirmedService(delivery),u=useConfirmedService(unloading),i=useConfirmedService(installation),g=useConfirmedService(general);
 const total=confirmedProjectTotal(productsSubtotalBYN,[services.servicesTotal,services.delivery,services.unloading,services.installation],roundingAdjustment);
 const pending=[d,u,i,g].some(state=>state.pending);
 return <div className="min-w-0 space-y-2 text-sm">{pricingError?<p role="alert" className="break-words text-destructive">{pricingError}</p>:null}<p className="break-words">Изделия: {formatMoneyTotal(productsSubtotalBYN===null?null:Number(productsSubtotalBYN),"BYN")}</p>{roundingAdjustment!=="0.00"?<p className="break-words text-muted-foreground">Округление КП: {formatAmount(roundingAdjustment,"BYN")}</p>:null}<p className="break-words font-medium">Подтверждённая сумма проекта: {total===null?formatMoneyTotal(null):formatAmount(total,"BYN")}</p>{pending?<p className="break-words text-xs text-muted-foreground">Новый итог появится после подтверждения сохранения услуг.</p>:null}</div>;
}

export function ProjectInlineContacts({canManage,clients}:{canManage:boolean;clients:ProductClientContact[]}){
 const router=useRouter();
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')router.refresh();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[router]);
 const{controller,derived,switchingClient}=useProjectInline();const client=controller("clientId");
 const[createOpen,setCreateOpen]=useState(false);
 const options=clients.map(row=>({value:row.id,label:row.label,hint:row.phone}));
 if(derived.clientId&&derived.clientLabel&&!options.some(row=>row.value===derived.clientId))options.push({value:derived.clientId,label:derived.clientLabel,hint:derived.phone??""});
 return <div className="flex min-w-0 flex-col gap-3 text-sm" data-project-contacts>
 <div className="flex min-w-0 items-start gap-3"><div className="min-w-0 flex-1"><InlineSelectField id="project-inline-client" label="Клиент" clientDirectory controller={client} readOnly={!canManage} options={options}/></div>{canManage?<Button type="button" variant="outline" className="mt-6 shrink-0" onClick={()=>setCreateOpen(true)}>Новый клиент</Button>:null}</div>
 <InlineTextField id="project-client-phone" label="Телефон клиента" inputMode="tel" controller={controller('client.phone')} readOnly={!canManage||switchingClient}/>
 <InlineTextField id="project-client-address" label="Адрес клиента" controller={controller('client.address')} readOnly={!canManage||switchingClient}/>
 <ClientDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={async id=>{client.setDraft(id);if(await client.commit())router.refresh();}}/>
 </div>;
}
