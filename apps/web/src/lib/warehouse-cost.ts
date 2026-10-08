import { decimalAtoms, decimalText } from './product-quantity';

export type WarehousePosition = { quantity: string; value: string };
const rounded=(numerator:bigint,denominator:bigint)=>(numerator+denominator/BigInt(2))/denominator;
function input(value:unknown,scale:number):string {
 if(typeof value!=='number'&&typeof value!=='string')throw Error('Укажите число');
 const text=String(value).trim().replace(',','.');
 const atoms=decimalAtoms(text,scale,12);
 if(atoms===BigInt(0))throw Error(scale===2?'Цена должна быть больше нуля':'Количество должно быть больше нуля');
 return decimalText(atoms,scale);
}
export const quantityInput=(value:unknown)=>input(value,3);
export const priceInput=(value:unknown)=>input(value,2);
export const valueAtoms=(value:string)=>decimalAtoms(value,9,30);
export const quantityAtoms=(value:string)=>decimalAtoms(value,3,12);
export const moneyText=(value:bigint)=>{
 const cents=rounded(value,BigInt(10_000_000));
 if(cents>BigInt('999999999999'))throw Error('Сумма превышает допустимый предел');
 return decimalText(cents,2);
};
export function unitCost(position:WarehousePosition):string {
 const q=quantityAtoms(position.quantity),v=valueAtoms(position.value);
 if(q===BigInt(0))return '0.000000000';
 return decimalText(rounded(v*BigInt(1000),q),9);
}
export function averagePrice(position:WarehousePosition):string {return moneyText(valueAtoms(unitCost(position)));}
export function addValue(position:WarehousePosition,quantity:string,value:string):WarehousePosition {
 const q=quantityAtoms(position.quantity)+quantityAtoms(quantity),v=valueAtoms(position.value)+valueAtoms(value);
 if(q>BigInt('999999999999')||v>BigInt('9'.repeat(30)))throw Error('Остаток превышает допустимый предел');
 return {quantity:decimalText(q,3),value:decimalText(v,9)};
}
export function addPosition(position:WarehousePosition,quantity:string,price:string){
 const q=quantityAtoms(quantityInput(quantity)),cost=decimalAtoms(priceInput(price),2,12)*BigInt(10_000_000);
 const v=rounded(q*cost,BigInt(1000));
 return {position:addValue(position,decimalText(q,3),decimalText(v,9)),cost:decimalText(cost,9),value:decimalText(v,9),money:moneyText(v)};
}
/** Cash invoice is rounded once in its currency before FX conversion. */
export function stockPurchaseAmount(quantity:string,price:string) {
 const result=addPosition({quantity:'0',value:'0'},quantity,price).money;
 if(decimalAtoms(result,2,12)===BigInt(0))throw Error('Сумма закупки должна быть больше нуля');
 return result;
}
/** Capitalize the exact saved BYN cash equivalent, not a rounded per-unit FX price. */
export function addPaidPosition(position:WarehousePosition,quantity:string,bynAmount:string) {
 const q=quantityInput(quantity),money=priceInput(bynAmount);
 const value=decimalText(decimalAtoms(money,2,12)*BigInt(10_000_000),9);
 return {position:addValue(position,q,value),cost:unitCost({quantity:q,value}),value,money};
}
export function issuePosition(position:WarehousePosition,quantity:string){
 const q=quantityAtoms(position.quantity),take=quantityAtoms(quantityInput(quantity)),v=valueAtoms(position.value);
 if(take>q)throw Error('Недостаточно материала на складе');
 const cost=unitCost(position),used=take===q?v:rounded(take*valueAtoms(cost),BigInt(1000));
 if(used>v)throw Error('Некорректная стоимость остатка');
 return {position:{quantity:decimalText(q-take,3),value:decimalText(v-used,9)},cost,value:decimalText(used,9),money:moneyText(used)};
}
export function returnShare(source:{quantity:string;value:string;money:string;returnedQuantity:string;returnedValue:string;returnedMoney:string},quantity:string){
 const q=quantityAtoms(source.quantity),take=quantityAtoms(quantityInput(quantity)),returned=quantityAtoms(source.returnedQuantity);
 if(take>q-returned)throw Error('Нельзя вернуть больше выданного');
 const final=take===q-returned;
 const remainingValue=valueAtoms(source.value)-valueAtoms(source.returnedValue);
 const proportionalValue=rounded(valueAtoms(source.value)*take,q);
 const value=final?remainingValue:proportionalValue<remainingValue?proportionalValue:remainingValue;
 const remainingCents=decimalAtoms(source.money,2,12)-decimalAtoms(source.returnedMoney,2,12);
 const proportionalCents=decimalAtoms(moneyText(value),2,12);
 const money=decimalText(final?remainingCents:proportionalCents<remainingCents?proportionalCents:remainingCents,2);
 return {value:decimalText(value,9),money,cost:decimalText(rounded(valueAtoms(source.value)*BigInt(1000),q),9)};
}
