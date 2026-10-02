import type {ClientInput,ClientBaseline} from "@/server/clients/core";
type Result={ok:boolean;id?:string;error?:string};
type Editing=ClientBaseline&{id:string};
// Один адаптер справочника и Product: update получает только настоящие семь baseline полей.
export async function submitClientEditor(input:ClientInput,editing:Editing|null,actions:{create:(input:ClientInput)=>Promise<Result>;update:(id:string,input:ClientInput,baseline:ClientBaseline)=>Promise<Result>}){
 if(!editing)return actions.create(input);
 const{name,lastName,middleName,phone,email,address,comment}=editing;
 return actions.update(editing.id,input,{name,lastName,middleName,phone,email,address,comment});
}
