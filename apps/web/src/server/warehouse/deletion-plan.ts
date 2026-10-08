import {addValue,issuePosition,returnShare,unitCost,valueAtoms,quantityAtoms,moneyText,type WarehousePosition} from '@/lib/warehouse-cost';
import {decimalAtoms,decimalText} from '@/lib/product-quantity';

export type DeletionFact = {
  id:string; type:'INCOME'|'EXPENSE'|'RETURN'; quantity:string; unitCost:string; value:string; money:string;
  sourceId:string|null; revision:number|null; createdAt:string;
};
export type ReturnCounter = {quantity:string;value:string;money:string};
export type DeletionReason = 'ROOT'|'SOURCE'|'STOCK'|'VALUATION';
const empty=():ReturnCounter=>({quantity:'0.000',value:'0.000000000',money:'0.00'});
const moneyAtoms=(value:string)=>decimalAtoms(value,2,12);
function sameCost(row:DeletionFact,result:{cost:string;value:string;money:string}) {
  return valueAtoms(row.unitCost)===valueAtoms(result.cost)&&valueAtoms(row.value)===valueAtoms(result.value)&&moneyAtoms(row.money)===moneyAtoms(result.money);
}

/** Каскад сохраняет снимки выживших движений; порядок не выводится из случайного UUID. */
export function planWarehouseDeletion(facts:readonly DeletionFact[],current:WarehousePosition,rootId:string) {
  if(!facts.some(row=>row.id===rootId))throw Error('Движение не найдено в текущем учёте');
  if(new Set(facts.map(row=>row.id)).size!==facts.length)throw Error('Повтор движения в учёте');
  const legacy=facts.filter(row=>row.revision===null).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  if(legacy.some((row,i)=>!Number.isFinite(Date.parse(row.createdAt))||(i>0&&row.createdAt===legacy[i-1].createdAt)))
    throw Error('Недостаточно данных для безопасной отмены: неоднозначный порядок истории');
  const recent=facts.filter(row=>row.revision!==null).sort((a,b)=>a.revision!-b.revision!);
  if(recent.some((row,i)=>!Number.isSafeInteger(row.revision)||row.revision!<=0||(i>0&&row.revision===recent[i-1].revision)))
    throw Error('Порядок складского учёта повреждён');
  const rows=[...legacy,...recent];
  for(const row of rows)if(quantityAtoms(row.quantity)<=BigInt(0)||valueAtoms(row.value)<=BigInt(0)||valueAtoms(row.unitCost)<=BigInt(0)||(row.sourceId&&row.type!=='RETURN'))
    throw Error('Неполный снимок складского учёта');

  function replay(deleting:boolean){
    let position:WarehousePosition={quantity:'0.000',value:'0.000000000'};
    const sources=new Map<string,DeletionFact>(),returns=new Map<string,ReturnCounter>(),deleted:{id:string;reason:DeletionReason}[]=[];
    for(const row of rows){
      if(deleting&&row.id===rootId){deleted.push({id:row.id,reason:'ROOT'});continue;}
      let result:{position:WarehousePosition;cost:string;value:string;money:string};
      let reason:DeletionReason|undefined;
      const source=row.sourceId?sources.get(row.sourceId):undefined;
      if(row.type==='EXPENSE'){
        if(quantityAtoms(row.quantity)>quantityAtoms(position.quantity))reason='STOCK';
        if(reason){if(!deleting)throw Error('Не пройдена сверка остатков складской истории');deleted.push({id:row.id,reason});continue;}
        try{result=issuePosition(position,row.quantity);}catch(error){if(!deleting)throw error;deleted.push({id:row.id,reason:'VALUATION'});continue;}
      }else if(row.type==='RETURN'&&row.sourceId){
        if(!source){if(!deleting)throw Error('Не найден исходный снимок возврата');deleted.push({id:row.id,reason:'SOURCE'});continue;}
        const returned=returns.get(source.id)!;
        const share=returnShare({quantity:source.quantity,value:source.value,money:source.money,
          returnedQuantity:returned.quantity,returnedValue:returned.value,returnedMoney:returned.money},row.quantity);
        result={...share,position:addValue(position,row.quantity,share.value)};
      }else{
        result={position:addValue(position,row.quantity,row.value),cost:unitCost({quantity:row.quantity,value:row.value}),value:row.value,money:moneyText(valueAtoms(row.value))};
      }
      if(!sameCost(row,result)){
        if(!deleting)throw Error('Не пройдена сверка стоимостных снимков складского учёта');
        deleted.push({id:row.id,reason:'VALUATION'});continue;
      }
      position=result.position;
      if(row.type==='EXPENSE'){sources.set(row.id,row);returns.set(row.id,empty());}
      if(source){const counter=returns.get(source.id)!;returns.set(source.id,{
        quantity:decimalText(quantityAtoms(counter.quantity)+quantityAtoms(row.quantity),3),
        value:decimalText(valueAtoms(counter.value)+valueAtoms(row.value),9),
        money:decimalText(moneyAtoms(counter.money)+moneyAtoms(row.money),2),
      });}
    }
    return {position,returns,deleted};
  }
  const baseline=replay(false);
  if(quantityAtoms(baseline.position.quantity)!==quantityAtoms(current.quantity)||valueAtoms(baseline.position.value)!==valueAtoms(current.value))
    throw Error('Не пройдена сверка текущего складского остатка');
  return {...replay(true),baselineReturns:baseline.returns};
}
