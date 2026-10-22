"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {ChevronRight} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {DataTable,type DataColumn} from "@/components/ui/data-table";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {ReportDocumentButton} from "@/components/report-document-button";
import {formatExactMoney,formatDate,formatDateTime} from "@/lib/format";
import {cn} from "@/lib/utils";
import type {CashStatement,CashStatementQuery,CashStatementRow,CashStatementEntry,CashStatementTotals} from "@/server/finance/cash-statement";

function Money({value,currency}:{value:string|null;currency:string}){
 return <span className={cn("tabular-nums",value===null?"text-muted-foreground":value.startsWith("-")?"text-red-600":"")}>{formatExactMoney(value,currency)}</span>;
}
const names={opening:"Начальный остаток",income:"Приходы",expense:"Расходы",revaluation:"Курсовая разница",closing:"Конечный остаток"};
const totalKeys=(showRevaluation:boolean)=>(Object.keys(names) as (keyof CashStatementTotals)[]).filter(key=>showRevaluation||key!=="revaluation");
function TotalsGrid({totals,currency,showRevaluation}:{totals:CashStatementTotals;currency:string;showRevaluation:boolean}){
 return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{totalKeys(showRevaluation).map(key=><div key={key}><dt className="text-muted-foreground">{names[key]}</dt><dd className={cn(key==="closing"&&"font-semibold")}><Money value={totals[key]} currency={currency}/></dd></div>)}</dl>;
}
function ValuationDetails({row}:{row:CashStatementRow}){
 const {valuation}=row;
 if(!valuation)return null;
 return <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">{(["opening","closing"] as const).map(key=>{
  const value=valuation[key];
  return <div key={key} className="min-w-0 space-y-1"><p className="font-medium">{names[key]} · {formatDate(value.date)}</p>
   <p>В валюте кассы: <Money value={value.nativeAmount} currency={value.nativeCurrency}/></p>
   {value.rate?<p className="break-words text-xs text-muted-foreground">Курс НБ РБ на {formatDate(value.rateDate??value.date)}: {value.rate.replace(".",",")} BYN за 1 {value.nativeCurrency}</p>:null}
   {value.issue?<p className="text-xs text-amber-700 dark:text-amber-400">{value.issue}</p>:!value.rate?<p className="text-xs text-muted-foreground">Нулевой остаток: курс не требуется.</p>:null}
  </div>;
 })}</div>;
}
export function CashStatementView({query,report,error}:{query:CashStatementQuery;report?:CashStatement;error?:string}){
 const [selected,setSelected]=useState<CashStatementRow|null>(null),heading=useRef<HTMLHeadingElement>(null);
 const columns:DataColumn<CashStatementRow>[]=[
  {id:"name",header:"Наименование",searchValue:row=>row.name,cell:row=><div className="flex items-center gap-2"><ChevronRight className="size-4 shrink-0 text-muted-foreground"/><div><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.valuation&&!row.unassigned?`${row.valuation.opening.nativeCurrency} · оценка BYN`:row.currency==="UNKNOWN"?"Валюта не указана":row.currency}{!row.active&&!row.unassigned?" · неактивна":""}</p>{row.unknownAmounts>0?<Badge variant="outline" className="mt-1">Неполная история</Badge>:row.valuation&&(row.valuation.opening.issue||row.valuation.closing.issue)?<Badge variant="outline" className="mt-1">Оценка недоступна</Badge>:null}</div></div>},
  ...totalKeys(query.mode==="BYN").map(key=>({id:key,header:names[key],headerClassName:"text-right",className:"text-right whitespace-nowrap",cell:(row:CashStatementRow)=><Money value={row.totals[key]} currency={row.currency}/>}))
 ];
 const details:DataColumn<CashStatementEntry>[]=[
  {id:"date",header:"Дата",sortable:true,sortValue:row=>row.at,cell:row=>formatDateTime(row.at)},
  {id:"label",header:"Операция",searchValue:row=>row.label,cell:row=><div><p>{row.label}</p>{row.issues.map(issue=><p key={issue} className="text-xs text-amber-700 dark:text-amber-400">{issue}</p>)}</div>},
  {id:"project",header:"Проект",searchValue:row=>row.project?.number??"",cell:row=>row.project?<Link href={`/finance/projects/${encodeURIComponent(row.project.id)}`} className="hover:underline">{row.project.number}</Link>:"—"},
  {id:"comment",header:"Комментарий",searchValue:row=>row.comment??"",cell:row=><span className="break-words">{row.comment??"—"}</span>},
  {id:"change",header:"Изменение",className:"text-right whitespace-nowrap",headerClassName:"text-right",cell:row=><div><Money value={row.change} currency={row.currency}/>{query.mode==="BYN"&&row.nativeCurrency&&row.nativeCurrency!=="BYN"&&row.nativeAmount!==null?<p className="text-xs text-muted-foreground">{formatExactMoney(row.nativeAmount,row.nativeCurrency)}</p>:null}</div>},
  {id:"document",header:"Отчётные документы",searchValue:row=>(row.documents??(row.document?[row.document]:[])).map(file=>file.fileName).join(" "),cell:row=>row.document||row.documents?.length?<ReportDocumentButton document={row.document} documents={row.documents}/>:"—"},
 ];
 return <div className="flex min-w-0 flex-col gap-5">
  <div><Link href="/finance/accounts" className="text-sm text-muted-foreground hover:underline">К кассам</Link><h1 className="mt-2 text-2xl font-semibold">Отчёт по кассам</h1><p className="text-sm text-muted-foreground">Остатки и движение денег, включая зарплаты и авансы. Расходы показаны со знаком минус.</p></div>
  <form method="get" action="/finance/accounts/report" className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
   <div className="min-w-0"><Label htmlFor="cash-from">С даты</Label><Input id="cash-from" name="from" type="date" defaultValue={query.from} required className="mt-1 w-full"/></div>
   <div className="min-w-0"><Label htmlFor="cash-to">По дату включительно</Label><Input id="cash-to" name="to" type="date" defaultValue={query.to} required className="mt-1 w-full"/></div>
   <div className="flex min-w-0 flex-col gap-1"><Label htmlFor="cash-mode">Показать суммы</Label><select id="cash-mode" name="mode" defaultValue={query.mode} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"><option value="BYN">BYN · оценка остатков</option><option value="NATIVE">В валютах касс</option></select></div>
   <Button type="submit">Показать</Button>
  </form>
  <p className="text-xs text-muted-foreground">Даты учитываются по времени Москвы. Для детализации откройте кассу.</p>
  {query.mode==="BYN"?<p className="text-sm text-muted-foreground">Приходы и расходы — по сохранённым BYN-эквивалентам. Начальный остаток оценён по курсу НБ РБ на день перед началом периода, конечный — на последний день. Курсовая разница согласует эти оценки с движением денег; использованные курсы доступны в детализации кассы.</p>:null}
  {error?<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>:null}
  {report?<>
   {report.unknownAmounts>0?<p role="note" className="rounded-lg border border-amber-500/30 p-3 text-sm">Неполная история: у {report.unknownAmounts} операций до конца периода нет подтверждённой суммы{query.mode==="BYN"?" BYN или суммы в валюте кассы":" в валюте кассы"}. Связанные итоги отмечены «Нет данных».</p>:null}
   {report.valuationUnavailable>0?<p role="note" className="rounded-lg border border-amber-500/30 p-3 text-sm">Для {report.valuationUnavailable} касс недоступна оценка остатка. Причина показана в детализации; известные движения сохранены.</p>:null}
   {report.unassignedOperations>0?<p className="text-sm text-muted-foreground">Операции без указанной кассы ({report.unassignedOperations}) показаны отдельной строкой и не распределяются по кассам автоматически.</p>:null}
   <DataTable columns={columns} rows={report.rows} searchPlaceholder="Поиск по кассам…" emptyText="Касс и денежных операций пока нет" defaultPageSize={20} onRowClick={setSelected}
    renderMobileCard={row=><div className="space-y-3"><div className="flex items-center justify-between gap-2"><b>{row.name}</b><ChevronRight className="size-4"/></div>{row.unknownAmounts>0?<p className="text-xs text-amber-700 dark:text-amber-400">Неполная история</p>:null}{row.valuation&&(row.valuation.opening.issue||row.valuation.closing.issue)?<p className="text-xs text-amber-700 dark:text-amber-400">Оценка недоступна · откройте кассу</p>:null}<TotalsGrid totals={row.totals} currency={row.currency} showRevaluation={query.mode==="BYN"}/></div>}/>
   <div className="grid gap-3 lg:grid-cols-2">{report.totals.map(total=><section key={total.currency} className="rounded-xl border bg-muted/30 p-4"><h2 className="mb-3 font-semibold">Итого · {total.currency==="UNKNOWN"?"валюта не указана":total.currency}</h2><TotalsGrid totals={total} currency={total.currency} showRevaluation={query.mode==="BYN"}/></section>)}</div>
  </>:null}
  <Dialog open={selected!==null} onOpenChange={open=>{if(!open)setSelected(null);}}>
   <DialogContent initialFocus={heading} className="sm:max-w-5xl"><DialogHeader><DialogTitle ref={heading} tabIndex={-1} className="outline-none">{selected?.name}</DialogTitle><DialogDescription>{formatDate(query.from)} — {formatDate(query.to)} · {selected?.currency==="UNKNOWN"?"валюта не указана":selected?.currency}</DialogDescription></DialogHeader>
    {selected?<><TotalsGrid totals={selected.totals} currency={selected.currency} showRevaluation={query.mode==="BYN"}/><ValuationDetails row={selected}/>
     <DataTable columns={details} rows={selected.entries} searchPlaceholder="Поиск по операциям…" emptyText="В этом периоде операций нет" defaultPageSize={10}
      renderMobileCard={row=><div className="space-y-2"><div className="flex items-start justify-between gap-2"><b>{row.label}</b><Money value={row.change} currency={row.currency}/></div><p className="text-xs text-muted-foreground">{formatDateTime(row.at)}{row.project?" · Проект "+row.project.number:""}</p>{row.comment?<p className="break-words text-sm">{row.comment}</p>:null}{row.issues.map(issue=><p key={issue} className="text-xs text-amber-700 dark:text-amber-400">{issue}</p>)}{row.document||row.documents?.length?<ReportDocumentButton document={row.document} documents={row.documents}/>:null}</div>}/></>:null}
   </DialogContent>
  </Dialog>
 </div>;
}
