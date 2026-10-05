import {parsePercentageRate} from './product-percentage-pay';

export const acceptsPercentageDraft=(value:string)=>/^[0-9]{0,3}(?:\.[0-9]{0,2})?$/.test(value);
export function parsePercentageInput(value:string){
 if(!acceptsPercentageDraft(value))throw Error('Введите только цифры и точку, не более двух знаков после точки');
 return parsePercentageRate(value===''?null:value);
}
export function stepPercentageDraft(value:string,direction:1|-1):string|null{
 if(!acceptsPercentageDraft(value)||value!==''&&!/^[0-9]{1,3}(?:\.[0-9]{0,2})?$/.test(value))return null;
 const [whole='0',fraction='']=value.split('.');
 const hundredths=Number(whole||'0')*100+Number(fraction.padEnd(2,'0')||'0');
 const next=Math.max(0,Math.min(10000,hundredths+direction*50));
 return `${Math.floor(next/100)}.${String(next%100).padStart(2,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
}
