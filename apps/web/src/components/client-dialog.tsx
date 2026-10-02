"use client";
import {useEffect,useState,useTransition} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {createClient,updateClient} from "@/server/clients/actions";
import {submitClientEditor} from "@/lib/client-editor-submit";
import type {ClientBaseline} from "@/server/clients/core";
const EMPTY={name:"",lastName:"",middleName:"",phone:"",email:"",address:"",comment:""};
type Editing=ClientBaseline&{id:string};
export function ClientDialog({open,onOpenChange,editing=null,onCreated}:{open:boolean;onOpenChange:(open:boolean)=>void;editing?:Editing|null;onCreated?:(id:string)=>Promise<void>|void}){
 const[form,setForm]=useState(EMPTY),[pending,startTransition]=useTransition(),[error,setError]=useState<string|null>(null);
 useEffect(()=>{if(open){setForm(editing?{name:editing.name,lastName:editing.lastName??"",middleName:editing.middleName??"",phone:editing.phone,email:editing.email??"",address:editing.address??"",comment:editing.comment??""}:EMPTY);setError(null);}},[open,editing]);
 const fields=[["lastName","Фамилия"],["name","Имя *"],["middleName","Отчество"],["phone","Телефон *"],["email","Email"],["address","Адрес"],["comment","Комментарий"]] as const;
 return<Dialog open={open} onOpenChange={value=>{if(!pending)onOpenChange(value);}}><DialogContent><DialogHeader><DialogTitle>{editing?"Редактировать клиента":"Новый клиент"}</DialogTitle><DialogDescription>Для юрлица название пишем в поле «Имя» — например, «ООО Альфа».</DialogDescription></DialogHeader><div className="grid min-w-0 gap-3 sm:grid-cols-2">{fields.map(([key,label])=><div key={key} className={`min-w-0 space-y-1.5 ${key==="address"||key==="comment"?"sm:col-span-2":""}`}><Label htmlFor={`c-${key}`}>{label}</Label>{key==="comment"?<Textarea id={`c-${key}`} value={form[key]} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}/>:<Input id={`c-${key}`} value={form[key]} onChange={event=>setForm(previous=>({...previous,[key]:event.target.value}))}/>}</div>)}</div>{error?<p role="alert" className="break-words text-sm text-destructive">{error}</p>:null}<DialogFooter><Button variant="outline" disabled={pending} onClick={()=>onOpenChange(false)}>Отмена</Button><Button disabled={pending||!form.name.trim()||!form.phone.trim()} onClick={()=>startTransition(async()=>{setError(null);try{const payload={name:form.name.trim(),phone:form.phone.trim(),lastName:form.lastName.trim()||undefined,middleName:form.middleName.trim()||undefined,email:form.email.trim()||undefined,address:form.address.trim()||undefined,comment:form.comment.trim()||undefined};const result=await submitClientEditor(payload,editing,{create:createClient,update:updateClient});if(!result.ok){setError(result.error??"Не удалось сохранить клиента");return;}onOpenChange(false);if(!editing&&"id" in result&&typeof result.id==="string")await onCreated?.(result.id);}catch(failure){setError(failure instanceof Error?failure.message:"Не удалось сохранить клиента");}})}>{pending?"Сохранение…":editing?"Сохранить":"Создать"}</Button></DialogFooter></DialogContent></Dialog>;
}
