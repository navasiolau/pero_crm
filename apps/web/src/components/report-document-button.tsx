"use client";
import {FileText} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {ViewableFile} from '@/lib/viewable-file';
/** Один элемент действия для таблицы, мобильной строки и деталей операции. */
export function ReportDocumentButton({document,onOpen}:{document:ViewableFile|null|undefined;onOpen:(file:ViewableFile)=>void}){
 if(!document)return null;
 return <Button type="button" variant="outline" size="sm" title={document.fileName} onClick={event=>{event.stopPropagation();onOpen(document);}}><FileText className="size-4"/>Отчетный документ</Button>;
}
