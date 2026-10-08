export const CALENDAR_TIMEZONE='Europe/Moscow';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:CALENDAR_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function calendarLocalValue(value:Date|string):string{
 const date=typeof value==='string'?new Date(value):value;
 if(!Number.isFinite(date.getTime()))throw new Error('CALENDAR_DATE_INVALID');
 const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function parseCalendarDateTime(value:string):Date{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('CALENDAR_DATE_INVALID');
 const [year,month,day,hour,minute]=value.split(/[-T:]/).map(Number);
 if(year<2000||year>2100||month<1||month>12||hour>23||minute>59)throw new Error('CALENDAR_DATE_INVALID');
 const wall=Date.UTC(year,month-1,day,hour,minute),verify=new Date(wall);
 if(verify.getUTCMonth()!==month-1||verify.getUTCDate()!==day)throw new Error('CALENDAR_DATE_INVALID');
 let utc=wall;
 for(let i=0;i<3;i++){
 const [y,m,d,h,min]=calendarLocalValue(new Date(utc)).split(/[-T:]/).map(Number);
 utc+=wall-Date.UTC(y,m-1,d,h,min);
 }
 const candidates=[utc-3600000,utc,utc+3600000].filter(timestamp=>calendarLocalValue(new Date(timestamp))===value);
 if(candidates.length!==1)throw new Error('CALENDAR_DATE_INVALID');
 return new Date(candidates[0]);
}
export function calendarMonthRange(month:string):{start:Date;end:Date}{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('CALENDAR_MONTH_INVALID');
 const [y,m]=month.split('-').map(Number);
 return {start:parseCalendarDateTime(`${month}-01T00:00`),end:parseCalendarDateTime(`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01T00:00`)};
}
export function calendarMonthDays(month:string):{date:string;inMonth:boolean}[]{
 calendarMonthRange(month);const [y,m]=month.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1));
 const offset=(first.getUTCDay()+6)%7;return Array.from({length:42},(_,i)=>{
 const date=new Date(Date.UTC(y,m-1,1-offset+i)).toISOString().slice(0,10);return {date,inMonth:date.startsWith(month)};
 });
}
export function calendarDisplay(value:Date|string):string{
 return new Intl.DateTimeFormat('ru-RU',{timeZone:CALENDAR_TIMEZONE,dateStyle:'long',timeStyle:'short'}).format(typeof value==='string'?new Date(value):value);
}

/** Inclusive local dates, represented as a half-open instant range. */
export function calendarDateRange(from:string,to:string):{start:Date;end:Date}{
 const start=parseCalendarDateTime(from+"T00:00"),last=parseCalendarDateTime(to+"T00:00");
 if(start.getTime()>last.getTime())throw Error("Начало периода позже окончания");
 const [year,month,day]=to.split("-").map(Number);
 const next=new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
 return {start,end:parseCalendarDateTime(next+"T00:00")};
}
