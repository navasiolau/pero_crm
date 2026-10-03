export type ReminderContext={environment:'local'|'staging'|'production';namespace:string;testOwnerIds:string[];enabled:boolean};
export function reminderOwnerAllowed(context:ReminderContext,ownerId:string):boolean{return context.environment==='production'||context.testOwnerIds.includes(ownerId);}
export function resolveReminderContext(env:Record<string,string|undefined>,runtime:{platform:string;container:boolean}):ReminderContext|null{
 const environment=env.CALENDAR_REMINDER_ENVIRONMENT,namespace=env.CALENDAR_REMINDER_NAMESPACE;
 if(!environment&&!namespace&&env.CALENDAR_REMINDERS_ENABLED!=='true'&&!env.CALENDAR_REMINDER_TEST_OWNER_IDS)return null;
 const stop=(condition:unknown)=>{if(!condition)throw new Error('CALENDAR_REMINDER_CONTEXT_INVALID');};
 stop(['local','staging','production'].includes(environment??''));stop(env.CALENDAR_REMINDERS_ENABLED===undefined||['true','false'].includes(env.CALENDAR_REMINDERS_ENABLED));
 const origin=new URL(env.AUTH_URL??env.NEXTAUTH_URL??'');stop(!origin.username&&!origin.password&&!origin.search&&!origin.hash&&(origin.pathname==='/'||origin.pathname===''));
 const db=new URL(env.DATABASE_URL??'');stop(db.protocol==='postgresql:'&&!db.hash&&(!db.searchParams.has('schema')||db.searchParams.get('schema')==='public'));
 let testOwnerIds:string[]=[];
 if(environment==='production'){
 stop(namespace==='production'&&runtime.platform==='linux'&&runtime.container&&origin.origin==='https://crm.peromebel.by'&&db.hostname==='db'&&(db.port||'5432')==='5432'&&db.pathname==='/crm'&&env.S3_BUCKET==='pero-crm'&&!env.CALENDAR_REMINDER_TEST_OWNER_IDS);
 }else{
 stop(new RegExp(`^${environment}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,'i').test(namespace??''));
 const owners=JSON.parse(env.CALENDAR_REMINDER_TEST_OWNER_IDS??'null');stop(Array.isArray(owners)&&owners.length>0&&owners.length<=32&&owners.every((id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id))&&new Set(owners).size===owners.length);testOwnerIds=owners;
 if(environment==='local')stop(runtime.platform==='win32'&&['localhost','127.0.0.1'].includes(origin.hostname)&&origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(db.hostname)&&db.port==='5433'&&db.pathname==='/pero_crm'&&(!env.S3_BUCKET||env.S3_BUCKET==='pero-crm-staging'));
 else stop(runtime.platform==='linux'&&runtime.container&&origin.origin==='https://staging-crm.peromebel.by'&&db.hostname==='db'&&(db.port||'5432')==='5432'&&db.pathname==='/crm'&&env.S3_BUCKET==='pero-crm-staging');
 }
 return {environment:environment as ReminderContext['environment'],namespace:namespace!,testOwnerIds,enabled:env.CALENDAR_REMINDERS_ENABLED==='true'};
}
