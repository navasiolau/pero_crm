export const MAX_PLANNED_MINUTES=2147483647;
/** The form accepts decimal hours; all domain operations receive whole minutes. */
export function parseCalendarHours(input:string):number|null{
 const value=input.trim();if(!value)return null;
 if(!/^\d+(?:[.,]\d+)?$/.test(value))throw Error('Укажите неотрицательное количество часов, например 1,5');
 const minutes=Math.round(Number(value.replace(',','.'))*60);
 if(!Number.isSafeInteger(minutes)||minutes>MAX_PLANNED_MINUTES)throw Error('Слишком большая длительность');
 return minutes;
}
export function calendarHoursInput(minutes:number|null):string{
 return minutes===null?'':String(Number((minutes/60).toFixed(2)));
}
export function formatPlannedMinutes(minutes:number|null):string{
 if(minutes===null)return 'Не указана';
 if(minutes===0)return '0 ч';
 const hours=Math.floor(minutes/60),rest=minutes%60;
 return [hours?`${new Intl.NumberFormat('ru-RU').format(hours)} ч`:'',rest?`${rest} мин`:''].filter(Boolean).join(' ');
}
