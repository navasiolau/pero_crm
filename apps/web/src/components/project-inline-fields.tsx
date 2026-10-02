"use client";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { stageLabels, stageStyles } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { formatAmount, formatMoneyTotal } from "@/lib/format";
import { confirmedProjectTotal } from "@/lib/project-inline-values";
import { useProjectInline } from "@/components/project-inline-provider";
export function ProjectInlineHeading({ number }: { number: string }) {
 const { controller, stage } = useProjectInline();const title=controller("title");
 const state=useSyncExternalStore(title.subscribe,title.getSnapshot,title.getServerSnapshot);
 return <><h1 className="min-w-0 break-words text-2xl font-semibold">{number} · {state.draft}</h1><Badge variant="outline" className={cn("border-transparent",stageStyles[stage].badge)}>{stageLabels[stage]}</Badge></>;
}
export function ProjectConfirmedTotal() {
 const {controller,productsSubtotalBYN,pricingError}=useProjectInline();
 const delivery=controller("delivery"),unloading=controller("unloading"),installation=controller("installation");
 const d=useSyncExternalStore(delivery.subscribe,delivery.getSnapshot,delivery.getServerSnapshot);
 const u=useSyncExternalStore(unloading.subscribe,unloading.getSnapshot,unloading.getServerSnapshot);
 const i=useSyncExternalStore(installation.subscribe,installation.getSnapshot,installation.getServerSnapshot);
 const total=confirmedProjectTotal(productsSubtotalBYN,[d.baseline===null?null:String(d.baseline),u.baseline===null?null:String(u.baseline),i.baseline===null?null:String(i.baseline)]);
 const pending=[d,u,i].some(state=>!["idle","saved"].includes(state.status));
 return <div className="min-w-0 space-y-2 text-sm">{pricingError?<p role="alert" className="break-words text-destructive">{pricingError}</p>:null}<p className="break-words">Изделия: {formatMoneyTotal(productsSubtotalBYN===null?null:Number(productsSubtotalBYN),"BYN")}</p><p className="break-words font-medium">Подтверждённая сумма проекта: {total===null?formatMoneyTotal(null):formatAmount(total,"BYN")}</p>{pending?<p className="break-words text-xs text-muted-foreground">Новый итог появится после подтверждения сохранения услуг.</p>:null}</div>;
}
