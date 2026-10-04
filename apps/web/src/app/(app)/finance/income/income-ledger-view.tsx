"use client";
import Link from 'next/link';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {DataTable,type DataColumn} from '@/components/ui/data-table';
import {ConfirmDeleteDialog} from '@/components/confirm-delete-dialog';
import {PaymentDialog} from '@/app/(app)/projects/[id]/finance-tab';
import {formatAmount,formatDate} from '@/lib/format';
import {deletePayment} from '@/server/payments/actions';
import type {loadOrganizationIncome} from '@/server/finance/income-ledger';
type Data=Awaited<ReturnType<typeof loadOrganizationIncome>>;
type Row=Data['rows'][number];
export function IncomeLedgerView({rows,cashAccounts,projects,expenseArticles}:Data){
 const [open,setOpen]=useState(false),[deleting,setDeleting]=useState<Row|null>(null);const router=useRouter();
 const columns:DataColumn<Row>[]=[{id:'date',header:'Дата',sortable:true,sortValue:r=>r.paidAt,cell:r=>formatDate(r.paidAt)},{id:'project',header:'Проект',cell:r=>r.project?<Link className="hover:underline" href={`/finance/projects/${r.project.id}`}>{r.project.number} · {r.project.title}</Link>:'Общий приход организации'},{id:'cash',header:'Касса',cell:r=>r.cashName??'—'},{id:'amount',header:'Сумма',className:'text-right',cell:r=>formatAmount(r.amount,r.currency)},{id:'rate',header:'Курс / дата',cell:r=>`${r.rate} / ${r.rateDate?formatDate(r.rateDate):'—'}`},{id:'byn',header:'Эквивалент BYN',className:'text-right',cell:r=>formatAmount(r.bynAmount,'BYN')},{id:'comment',header:'Комментарий',cell:r=>r.comment??'—'},{id:'actions',header:'',cell:r=><Button variant="ghost" onClick={()=>setDeleting(r)}>Удалить</Button>}];
 return <div className="flex min-w-0 flex-col gap-6"><Link href="/finance" className="text-sm text-muted-foreground">Назад к финансам</Link><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Приходы организации</h1><Button onClick={()=>setOpen(true)}>Добавить приход</Button></div><p className="text-sm text-muted-foreground">Общий приход без проекта входит в баланс и оборот организации; экономика отдельных проектов не меняется.</p><DataTable columns={columns} rows={rows} searchPlaceholder="Поиск по приходам…" emptyText="Приходов пока нет"/><PaymentDialog direction="INCOME" open={open} onOpenChange={setOpen} projectCurrency="BYN" projectOptions={projects} cashAccounts={cashAccounts} expenseArticles={expenseArticles}/><ConfirmDeleteDialog open={deleting!==null} onOpenChange={next=>{if(!next)setDeleting(null)}} entityLabel="приход" warning="Удаление возможно только без отрицательного остатка кассы и организации." onConfirm={async()=>{if(!deleting)return false;const result=await deletePayment(deleting.id);if(!result.ok){toast.error(result.error??'Ошибка удаления');return false;}setDeleting(null);router.refresh();return true;}}/></div>;
}
