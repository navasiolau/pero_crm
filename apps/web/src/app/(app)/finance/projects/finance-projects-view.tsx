"use client";
import Link from 'next/link';
import {DataTable,type DataColumn} from '@/components/ui/data-table';
import type {FinanceProjectRef} from '@/server/finance/project-refs';
import {stageLabels} from '@/lib/stages';
export function FinanceProjectsView({projects}:{projects:FinanceProjectRef[]}){
 const columns:DataColumn<FinanceProjectRef>[]=[{id:'number',header:'Проект',sortable:true,sortValue:row=>Number(row.number),cell:row=><Link className="font-semibold underline-offset-4 hover:underline" href={`/finance/projects/${row.number}`}>{row.number}</Link>},{id:'title',header:'Название',sortable:true,sortValue:row=>row.title,cell:row=>row.title},{id:'client',header:'Клиент',sortable:true,sortValue:row=>row.clientLabel,cell:row=>row.clientLabel},{id:'stage',header:'Этап',sortable:true,sortValue:row=>stageLabels[row.stage],cell:row=>stageLabels[row.stage]}];
 return <DataTable columns={columns} rows={projects} searchPlaceholder="Поиск по проекту и клиенту…" emptyText="Проектов пока нет"/>;
}
