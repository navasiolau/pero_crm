import {requireFinance} from "@/server/require-role";
import {calendarLocalValue,calendarDateRange} from "@/lib/calendar-dates";
import {getCashStatement,type CashStatementQuery} from "@/server/finance/cash-statement";
import {CashStatementView} from "@/components/cash-statement-view";
export const dynamic="force-dynamic";
export default async function CashStatementPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const session=await requireFinance(),params=await searchParams,today=calendarLocalValue(new Date()).slice(0,10);
 const from=typeof params.from==="string"?params.from:today.slice(0,7)+"-01",to=typeof params.to==="string"?params.to:today;
 const mode=typeof params.mode==="string"?params.mode:"BYN";
 const query:CashStatementQuery={from,to,mode:mode==="NATIVE"?"NATIVE":"BYN"};
 try{calendarDateRange(from,to);if(mode!=="BYN"&&mode!=="NATIVE")throw Error("mode");}
 catch{return <CashStatementView query={query} error="Укажите корректный период: начальная дата не должна быть позже конечной."/>;}
 const report=await getCashStatement(session.user,query);
 return <CashStatementView query={query} report={report}/>;
}
