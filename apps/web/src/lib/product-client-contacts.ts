import type {ProductPatchDerived} from "@/server/products/patch-contract";
export type ProductClientContact={id:string;label:string;phone:string;address:string|null};
// Draft выбора не является подтверждённым клиентом; Project.address не участвует.
export function confirmedProductClientContacts(clientId:string,clients:readonly ProductClientContact[],derived:ProductPatchDerived){
 const actual=clients.find(client=>client.id===clientId);if(actual)return{...actual,known:true};
 if(derived.clientId===clientId&&typeof derived.phone==="string"&&derived.clientAddress!==undefined)return{id:clientId,label:derived.clientLabel??"Клиент",phone:derived.phone,address:derived.clientAddress,known:true};
 return{id:clientId,label:null,phone:null,address:null,known:false};
}
