import type { DomainActor } from "../projects/core";
import { resolveVisibilityActor, productVisibilityWhere } from "@/server/access/visibility";
import { withTaskTransaction, type TaskTransaction } from "../tasks/transaction";
import { productFinishRow } from "./contracts";
export async function getProductFinishStateFor(actor:DomainActor,productId:string,transaction:TaskTransaction=withTaskTransaction){
 return transaction(async tx=>{const visibility=await resolveVisibilityActor(tx,actor);const product=await tx.product.findFirst({where:{AND:[{id:productId},productVisibilityWhere(visibility)]},select:{finishRevision:true,finishAssignments:{orderBy:[{element:"asc"},{id:"asc"}]}}});return product?{revision:product.finishRevision,rows:product.finishAssignments.map(productFinishRow)}:null;});
}
