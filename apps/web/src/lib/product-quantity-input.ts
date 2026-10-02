import {productLineTotal} from './product-quantity';

export const acceptsQuantityDraft=(value:string)=>/^[0-9]{0,10}$/.test(value);
export function stepQuantityDraft(value:string,direction:1|-1):string|null{
 if(!acceptsQuantityDraft(value))return null;
 if(value==='')return '1';
 return String(Math.max(1,Math.min(2_147_483_647,Number(value)+direction)));
}
export function productDraftTotal(price:string,quantity:string):string|null{
 if(!/^[0-9]{1,10}$/.test(quantity))return null;
 const unit=price.trim();if(unit!==''&&!/^[0-9]{1,10}(?:[.,][0-9]{1,2})?$/.test(unit))return null;
 try{return productLineTotal(unit===''?null:unit.replace(',','.'),Number(quantity));}catch{return null;}
}
