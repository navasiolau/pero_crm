import type { ProductPercentageState } from "./product-percentage-view";
import { previewProductPercentageShare } from "./product-percentage-ui";
import { PERCENTAGE_SHARE_UNITS, parsePercentageRate } from "./product-percentage-pay";
export function productPercentageBase(unitPrice:string|null,quantity:number|null):string|null{
  if(unitPrice===null||quantity===null||!Number.isSafeInteger(quantity)||quantity<1||!/^\d+(?:\.\d{1,2})?$/.test(unitPrice))return null;
  const [whole,fraction=""]=unitPrice.split(".");
  const cents=(BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0")))*BigInt(quantity);
  return `${cents/BigInt(100)}.${String(cents%BigInt(100)).padStart(2,"0")}`;
}
export function singleProductPercentagePreview(input:{state:ProductPercentageState;version:1|2;unitPrice:string|null;quantity:number|null;rate:string|null;frozenTotal:string|null}):string|null{
  if(input.state!=="DRAFT")return input.frozenTotal;
  if(input.version===1)return previewProductPercentageShare(input.unitPrice,input.rate,PERCENTAGE_SHARE_UNITS);
  const base=productPercentageBase(input.unitPrice,input.quantity);
  if(base===null||input.rate===null)return null;
  let rate:string|null;try{rate=parsePercentageRate(input.rate)}catch{return null}
  if(rate===null)return null;
  const cents=BigInt(base.replace(".",""));
  const result=(cents*BigInt(rate.replace(".",""))+BigInt(5000))/BigInt(10000);
  return `${result/BigInt(100)}.${String(result%BigInt(100)).padStart(2,"0")}`;
}
