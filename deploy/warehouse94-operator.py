"""Reviewed guest-only warehouse operator. No restic or live full restore.

Production backups require the expected deployed revision. Fresh backup and a
real isolated recovery proof are mandatory before zero/restore. Staging never
creates a dump. Copy this file by checksum and run it as a file, never inline SSH.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import socket
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit

NEW_TABLES = {'WarehouseAccountingState', 'WarehouseBalance', 'WarehouseMovementValuation'}
TARGETS = {'production': ('crm','15fee2f9002f17118ad148331a3b5ba61bd4d0969deb3913f6fa55f76ff9d624'),
           'staging': ('crm-staging','27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a')}

def check(ok, code):
    if not ok: raise RuntimeError(code)

def call(args, data=None, seconds=120):
    if os.name=='posix' and args[0]=='docker':args=['docker','--host','unix:///var/run/docker.sock',*args[1:]]
    result=subprocess.run(args,input=data,capture_output=True,text=True,encoding='utf-8',timeout=seconds)
    check(result.returncode==0,'COMMAND_FAILED_'+Path(args[0]).name.upper().replace('-','_'))
    return result.stdout.strip()

def sha(path):
    check(path.is_file() and not path.is_symlink(),'ARTIFACT_TYPE_MISMATCH')
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def read_json(path):
    check(path.is_file() and not path.is_symlink(),'ARTIFACT_TYPE_MISMATCH')
    return json.loads(path.read_text(encoding='utf-8'))

def save(path, value):
    with path.open('x',encoding='utf-8') as stream:json.dump(value,stream,sort_keys=True,indent=2)
    if os.name=='posix':path.chmod(0o600)

def inspect(name):return json.loads(call(['docker','inspect',name]))[0]

def identity(options):
    host,dbid=TARGETS[options.target]
    check(os.name=='posix' and os.geteuid()==0 and socket.gethostname()==host,'GUEST_HOST_REQUIRED')
    check(Path('/opt/'+host).is_dir(),'STACK_REQUIRED')
    web,db,proxy=[inspect(host+'-'+service+'-1') for service in ['web','db','proxy']]
    for service,item in [('web',web),('db',db),('proxy',proxy)]:
        labels=item['Config'].get('Labels') or {}
        check(labels.get('com.docker.compose.project')==host and labels.get('com.docker.compose.service')==service and
              labels.get('com.docker.compose.project.working_dir')=='/opt/'+host and item['State']['Running'],'CONTAINER_OWNERSHIP_MISMATCH')
        check(item['State'].get('Health',{}).get('Status')=='healthy','CONTAINER_HEALTH_REQUIRED')
    check(web['Config']['Labels'].get('org.opencontainers.image.revision')==options.revision,'DEPLOYED_REVISION_MISMATCH')
    check(db['Id']==dbid and len(db['Mounts'])==1 and db['Mounts'][0].get('Name')==host+'_pgdata','DATABASE_IDENTITY_MISMATCH')
    env=dict(value.split('=',1) for value in web['Config']['Env'] if '=' in value)
    binding=urlsplit(env.get('DATABASE_URL',''))
    check(binding.hostname=='db' and binding.path=='/crm' and binding.port in (None,5432),'DATABASE_BINDING_MISMATCH')
    check(env.get('S3_BUCKET')==('pero-crm' if host=='crm' else 'pero-crm-staging'),'STORAGE_BINDING_MISMATCH')
    if host=='crm-staging':check(hashlib.sha256(Path('/opt/crm-staging/watch-staging.sh').read_bytes()).hexdigest()=='27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139','W07_CHANGED')
    return {'hostname':host,'revision':options.revision,'image':web['Image'],'database':dbid,'mounts':db['Mounts']}

def psql(container):return ['docker','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','crm','-d','crm']
def query(container,sql,write=False):
    return call(psql(container),'BEGIN ISOLATION LEVEL REPEATABLE READ '+('' if write else 'READ ONLY')+';\nSET LOCAL statement_timeout=\'90s\';\n'+sql+';\nCOMMIT;\n')

class Snapshot:
    def __init__(self,container):
        args=psql(container)
        if os.name=='posix':args=['docker','--host','unix:///var/run/docker.sock',*args[1:]]
        self.p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        self.buffer=b'';self.n=0;self.sel=selectors.DefaultSelector();self.sel.register(self.p.stdout,selectors.EVENT_READ)
        self.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    def query(self,sql):
        self.n+=1;marker=('WH94_END_'+str(self.n)).encode();lines=[];deadline=time.monotonic()+120
        self.p.stdin.write(sql.encode()+b';\n\\echo '+marker+b'\n');self.p.stdin.flush()
        while True:
            while b'\n' in self.buffer:
                line,self.buffer=self.buffer.split(b'\n',1)
                if line==marker:return b'\n'.join(lines).decode().strip()
                lines.append(line)
            check(self.p.poll() is None and time.monotonic()<deadline,'SNAPSHOT_QUERY_FAILED')
            if self.sel.select(2):
                data=os.read(self.p.stdout.fileno(),65536);check(bool(data),'SNAPSHOT_EOF');self.buffer+=data
    def close(self):
        if self.p.poll() is None:self.p.stdin.write(b'ROLLBACK;\n\\q\n');self.p.stdin.flush();self.p.wait(timeout=15)
        self.sel.close()

def state(q):
    tables=json.loads(q("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"))
    hashes={}
    for name in tables:
        quoted='"'+name.replace('"','""')+'"'
        hashes[name]=json.loads(q("SELECT json_build_object('rows',count(*),'hash',md5(COALESCE(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public."+quoted+' t) x'))
    columns=json.loads(q("SELECT json_agg(r ORDER BY r.table_name,r.position) FROM (SELECT table_name,column_name,row_number() OVER(PARTITION BY table_name ORDER BY ordinal_position) position,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public') r"))
    constraints=json.loads(q("SELECT json_agg(r ORDER BY r.table_name,r.name) FROM (SELECT c.conrelid::regclass::text table_name,c.conname name,c.contype type,c.convalidated validated,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') r"))
    functions=json.loads(q("SELECT COALESCE(json_agg(r ORDER BY r.name,r.args),'[]') FROM (SELECT proname name,pg_get_function_identity_arguments(p.oid) args,md5(pg_get_functiondef(p.oid)) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') r"))
    triggers=json.loads(q("SELECT COALESCE(json_agg(r ORDER BY r.table_name,r.name),'[]') FROM (SELECT c.relname table_name,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) r"))
    indexes=json.loads(q("SELECT COALESCE(json_agg(r ORDER BY r.table_name,r.name),'[]') FROM (SELECT tablename table_name,indexname name,indexdef definition FROM pg_indexes WHERE schemaname='public') r"))
    return {'tables':hashes,'columns':columns,'constraints':constraints,'functions':functions,'triggers':triggers,'indexes':indexes}

def original_stock(q):
    return json.loads(q("SELECT json_build_object('rows',count(*),'hash',md5(COALESCE(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(jsonb_build_object('id',m.id,'price',m.\"purchasePrice\",'quantity',COALESCE(s.quantity,0))::text) h FROM \"Material\" m LEFT JOIN (SELECT \"materialId\",sum(CASE WHEN type='EXPENSE' THEN -quantity ELSE quantity END) quantity FROM \"StockMovement\" GROUP BY \"materialId\") s ON s.\"materialId\"=m.id) x"))

def restored_state_matches(actual, expected, parse_check):
    if {k:v for k,v in actual.items() if k!='constraints'}!={k:v for k,v in expected.items() if k!='constraints'}:return False
    constraints={(row['table_name'],row['name']):row for row in actual['constraints']}
    if len(constraints)!=len(actual['constraints']) or len(actual['constraints'])!=len(expected['constraints']):return False
    for original in expected['constraints']:
        restored=constraints.get((original['table_name'],original['name']))
        if original==restored:continue
        if restored is None or original['type']!='c' or {k:v for k,v in original.items() if k!='definition'}!={k:v for k,v in restored.items() if k!='definition'}:return False
        reference=original['table_name'];table=reference[1:-1].replace('""','"') if reference.startswith('"') and reference.endswith('"') else reference
        check(table in actual['tables'],'RESTORED_PUBLIC_TABLE_REQUIRED')
        # PostgreSQL may flatten associative AND groups when reparsing a dump.
        # Reparse the ORIGINAL full CHECK on an empty TEMP clone, preserving all
        # casts/operators/precedence; do not strip parentheses or skip a check.
        identifier='"'+table.replace('"','""')+'"'
        sql='CREATE TEMP TABLE warehouse94_expected_table (LIKE public.'+identifier+'); ALTER TABLE warehouse94_expected_table ADD CONSTRAINT warehouse94_expected_check '+original['definition']+"; SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pg_temp.warehouse94_expected_table'::regclass AND conname='warehouse94_expected_check'"
        if parse_check(sql)!=restored['definition']:return False
    return True

def frozen_archive_guard(receipt, allow_repeated=False):
    # Проверка архивного склада и исходных снимков в той же транзакции, что и zero.
    clauses=[]
    for name in ['Material','StockMovement','ProjectMaterial','WarehouseBalance','WarehouseMovementValuation']:
        expected=receipt['state']['tables'][name]
        check(type(expected['rows']) is int and re.fullmatch('[a-f0-9]{32}',expected['hash']),'RECEIPT_HASH_INVALID')
        clauses.append("IF (SELECT jsonb_build_object('rows',count(*),'hash',md5(COALESCE(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM \"%s\" t) x) IS DISTINCT FROM '%s'::jsonb THEN RAISE EXCEPTION 'WAREHOUSE_ARCHIVE_SNAPSHOT_CHANGED'; END IF;"%(name,json.dumps(expected,separators=(',',':'))))
    guard=receipt['warehouseGuard']
    check(re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',guard['runId']) and guard['runId']==receipt['runId'] and all(re.fullmatch('[a-f0-9]{32}',guard[k]) for k in ['prices','balances']),'FROZEN_RECEIPT_INVALID')
    clauses.append("IF NOT EXISTS(SELECT 1 FROM \"WarehouseAccountingState\" WHERE id='main' AND phase='FROZEN' AND \"runId\"='%s' AND md5(\"beforePrices\"::text)='%s' AND md5(\"beforeBalances\"::text)='%s') THEN RAISE EXCEPTION 'WAREHOUSE_FROZEN_SNAPSHOT_CHANGED'; END IF;"%(guard['runId'],guard['prices'],guard['balances']))
    body=''.join(clauses)
    if allow_repeated:body="IF EXISTS(SELECT 1 FROM \"WarehouseAccountingState\" WHERE id='main' AND phase='FROZEN') THEN "+body+' END IF;'
    return 'DO $warehouse94$ BEGIN PERFORM pg_advisory_xact_lock(18436,94001); '+body+' END; $warehouse94$;\n'

def recovery_snapshot_guard(receipt):
    guard=receipt['warehouseGuard']
    check(re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',guard['runId']) and guard['runId']==receipt['runId'] and all(re.fullmatch('[a-f0-9]{32}',guard[k]) for k in ['prices','balances']),'FROZEN_RECEIPT_INVALID')
    return "DO $warehouse94$ BEGIN PERFORM pg_advisory_xact_lock(18436,94001); IF NOT EXISTS(SELECT 1 FROM \"WarehouseAccountingState\" WHERE id='main' AND \"runId\"='%s' AND md5(\"beforePrices\"::text)='%s' AND md5(\"beforeBalances\"::text)='%s') THEN RAISE EXCEPTION 'WAREHOUSE_RECOVERY_SNAPSHOT_CHANGED'; END IF; END; $warehouse94$;\n"%(guard['runId'],guard['prices'],guard['balances'])

def owned_directory(options):
    path=Path('/root/pero-warehouse94-'+options.run)
    if not path.exists():path.mkdir(mode=0o700)
    info=path.lstat();check(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o700,'PRIVATE_DIRECTORY_REQUIRED')
    return path

def run_remote(options):
    before=identity(options);host=before['hostname'];container=host+'-db-1'
    if options.action=='inspect':
        value=query(container,"SELECT to_regclass('public.\"WarehouseAccountingState\"') IS NOT NULL")
        result={'identity':before,'warehouseSchema':value=='t'}
        if value=='t':
            result['warehouse']=json.loads(query(container,"SELECT json_build_object('runId',s.\"runId\",'phase',s.phase,'materials',(SELECT count(*) FROM \"Material\"),'newMovements',(SELECT count(*) FROM \"WarehouseMovementValuation\" WHERE \"runId\"=s.\"runId\"),'nonzeroBalances',(SELECT count(*) FROM \"WarehouseBalance\" WHERE quantity<>0 OR \"valueByn\"<>0),'nonzeroPrices',(SELECT count(*) FROM \"Material\" WHERE \"purchasePrice\" IS DISTINCT FROM 0)) FROM \"WarehouseAccountingState\" s WHERE s.id='main'"))
        print(json.dumps(result));return
    if options.action in ('pre-migration-backup','pre-zero-backup'):check(options.target=='production','NO_LOCAL_OR_STAGING_DUMPS')
    folder=owned_directory(options)
    if options.action in ('pre-migration-backup','pre-zero-backup'):
        check(options.target=='production','NO_LOCAL_OR_STAGING_DUMPS')
        kind='pre-zero' if options.action=='pre-zero-backup' else 'pre-migration'
        if kind=='pre-zero':
            frozen=json.loads(query(container,"SELECT row_to_json(s) FROM \"WarehouseAccountingState\" s WHERE id='main'"))
            check(frozen is not None,'FROZEN_RUN_REQUIRED')
            check(frozen.get('phase')=='FROZEN' and frozen.get('runId')==options.run,'FROZEN_RUN_REQUIRED')
        snapshot=Snapshot(container)
        try:
            token=snapshot.query('SELECT pg_export_snapshot()');captured=state(snapshot.query)
            path=folder/(kind+'.dump')
            with path.open('xb') as stream:
                path.chmod(0o600)
                result=subprocess.run(['docker','--host','unix:///var/run/docker.sock','exec',container,'pg_dump','-U','crm','-d','crm','-Fc','--snapshot='+token],stdout=stream,stderr=subprocess.PIPE,timeout=300)
            check(result.returncode==0 and path.stat().st_size>1000,'BACKUP_FAILED')
            check(identity(options)==before,'IDENTITY_CHANGED_DURING_BACKUP')
            receipt={'runId':options.run,'kind':kind,'identity':before,'revision':options.revision,'archiveSha256':sha(path),'bytes':path.stat().st_size,'state':captured}
            if kind=='pre-zero':
                receipt['warehouseGuard']=json.loads(snapshot.query("SELECT json_build_object('runId',\"runId\",'prices',md5(\"beforePrices\"::text),'balances',md5(\"beforeBalances\"::text)) FROM \"WarehouseAccountingState\" WHERE id='main' AND phase='FROZEN'"))
                receipt['originalStock']=original_stock(snapshot.query)
            save(folder/(kind+'-receipt.json'),receipt)
            print(json.dumps({'status':'BACKED_UP','kind':kind,'path':str(path),'sha256':receipt['archiveSha256'],'tables':len(captured['tables'])}))
        finally:snapshot.close()
        return
    expressions={'freeze':"warehouse_freeze('%s')",'activate':"warehouse_activate('%s')"}
    if options.action in expressions:sql='SELECT '+(expressions[options.action]%options.run)
    elif options.action in ('attach-proof','zero','restore'):
        receipt=read_json(folder/'pre-zero-receipt.json')
        proof_path=folder/'pre-zero-proof.json';proof=read_json(proof_path)
        check(receipt['runId']==options.run and receipt['revision']==options.revision and receipt['archiveSha256']==sha(folder/'pre-zero.dump'),'ARCHIVE_OWNERSHIP_MISMATCH')
        check(proof.get('runId')==options.run and proof.get('revision')==options.revision and proof.get('operatorSha256')==sha(Path(__file__)) and proof.get('archiveSha256')==receipt['archiveSha256'] and proof.get('restoredRowsMatched') is True and proof.get('schemaAndForeignKeysMatched') is True and proof.get('zeroRehearsal') is True and proof.get('targetedRestore') is True and proof.get('originalStockAndPricesRestored') is True,'REAL_RECOVERY_PROOF_REQUIRED')
        function={'attach-proof':'warehouse_attach_recovery_proof','zero':'warehouse_zero_start','restore':'warehouse_restore_start'}[options.action]
        sql="SELECT %s('%s','%s','%s')"%(function,options.run,receipt['archiveSha256'],sha(proof_path))
        if options.action=='attach-proof':sql=frozen_archive_guard(receipt)+sql
        if options.action=='zero':sql=frozen_archive_guard(receipt,allow_repeated=True)+sql
        if options.action=='restore':sql=recovery_snapshot_guard(receipt)+sql
    else:raise RuntimeError('UNKNOWN_OPERATOR_ACTION')
    result=json.loads(query(container,sql,write=True));check(identity(options)==before,'IDENTITY_CHANGED_DURING_OPERATION')
    print(json.dumps({'identity':before,'operation':options.action,'result':result}))

def verify_local(options):
    check(os.name=='nt','LOCAL_WINDOWS_REQUIRED')
    context=json.loads(call(['docker','context','inspect']))[0]
    check(context['Endpoints']['docker']['Host'].startswith('npipe:') and not os.environ.get('DOCKER_HOST'),'LOCAL_DOCKER_REQUIRED')
    archive=Path(options.archive).resolve();check('.playwright-mcp' in archive.parts,'OWNED_LOCAL_ARCHIVE_DIRECTORY_REQUIRED')
    kind=archive.stem;check(kind in ('pre-migration','pre-zero'),'ARCHIVE_KIND_INVALID')
    receipt=read_json(archive.parent/(kind+'-receipt.json'))
    check(receipt['runId']==options.run and receipt['revision']==options.revision and sha(archive)==receipt['archiveSha256'],'ARCHIVE_SHA_MISMATCH')
    name='pero-wh94-restore-'+options.run[:8]
    check(name not in call(['docker','ps','-a','--format','{{.Names}}']).splitlines(),'ISOLATED_CONTAINER_ALREADY_EXISTS')
    call(['docker','run','-d','--name',name,'--network','none','--label','pero.warehouse94.run='+options.run,'--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=1g','-e','POSTGRES_USER=crm','-e','POSTGRES_DB=crm','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
    try:
        item=inspect(name);check(item['Config']['Labels'].get('pero.warehouse94.run')==options.run and item['HostConfig']['NetworkMode']=='none' and not item['HostConfig'].get('PortBindings') and not [m for m in item['Mounts'] if m['Type'] in ('bind','volume')],'RESTORE_ISOLATION_REQUIRED')
        deadline=time.monotonic()+60
        while True:
            # pg_isready also sees the temporary init server that is stopped
            # before the final server starts. Wait for completed init first.
            initialized='PostgreSQL init process complete; ready for start up.' in call(['docker','logs',name])
            ready=subprocess.run(['docker','exec',name,'pg_isready','-U','crm','-d','crm'],capture_output=True).returncode==0
            if initialized and ready:break
            check(time.monotonic()<deadline,'RESTORE_DATABASE_NOT_READY');time.sleep(1)
        with archive.open('rb') as stream:
            result=subprocess.run(['docker','exec','-i',name,'pg_restore','--exit-on-error','--no-owner','-U','crm','-d','crm'],stdin=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        check(result.returncode==0,'ISOLATED_RESTORE_FAILED')
        q=lambda sql:query(name,sql)
        restored=state(q);check(restored_state_matches(restored,receipt['state'],lambda sql:query(name,sql,True)),'RESTORED_ROWS_SCHEMA_MISMATCH')
        report={'runId':options.run,'revision':receipt['revision'],'operatorSha256':sha(Path(__file__)),'archiveSha256':receipt['archiveSha256'],'restoredRowsMatched':True,'schemaAndForeignKeysMatched':True,'constraintDefinitionsParsedByPostgres':True,'zeroRehearsal':False,'targetedRestore':False}
        if kind=='pre-zero':
            check(original_stock(q)==receipt['originalStock'],'RESTORED_ORIGINAL_STOCK_MISMATCH')
            provisional='a'*64;backup=receipt['archiveSha256'];prefix="SELECT warehouse_attach_recovery_proof('%s','%s','%s')"%(options.run,backup,provisional)
            query(name,frozen_archive_guard(receipt)+prefix,True)
            query(name,frozen_archive_guard(receipt)+"SELECT warehouse_zero_start('%s','%s','%s')"%(options.run,backup,provisional),True)
            check(q('SELECT count(*) FROM "Material" WHERE "purchasePrice" IS DISTINCT FROM 0')=='0','REHEARSAL_ZERO_PRICE_FAILED')
            check(q('SELECT count(*) FROM "WarehouseBalance" WHERE quantity<>0 OR "valueByn"<>0')=='0','REHEARSAL_ZERO_BALANCE_FAILED')
            query(name,recovery_snapshot_guard(receipt)+"SELECT warehouse_restore_start('%s','%s','%s')"%(options.run,backup,provisional),True)
            after=state(q)
            check({k:v for k,v in after['tables'].items() if k not in NEW_TABLES}=={k:v for k,v in restored['tables'].items() if k not in NEW_TABLES},'TARGETED_RESTORE_CHANGED_BUSINESS_DATA')
            check(after['tables']['WarehouseBalance']==restored['tables']['WarehouseBalance'],'TARGETED_BALANCE_RESTORE_MISMATCH')
            check(original_stock(q)==receipt['originalStock'],'TARGETED_ORIGINAL_STOCK_MISMATCH')
            report.update(zeroRehearsal=True,targetedRestore=True,originalStockAndPricesRestored=True)
        save(archive.parent/(kind+'-proof.json'),report);print(json.dumps(report))
    finally:
        item=inspect(name);check(item['Config']['Labels'].get('pero.warehouse94.run')==options.run and item['HostConfig']['NetworkMode']=='none','RESTORE_CONTAINER_DELETE_GUARD')
        call(['docker','rm','-f',name])

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--target',choices=TARGETS,default='production');parser.add_argument('--revision',required=True);parser.add_argument('--run',required=True)
    parser.add_argument('--action',required=True,choices=['inspect','freeze','pre-migration-backup','pre-zero-backup','verify-archive','attach-proof','zero','activate','restore']);parser.add_argument('--archive')
    options=parser.parse_args();check(re.fullmatch('[a-f0-9]{40}',options.revision),'FULL_REVISION_REQUIRED');check(re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',options.run),'RUN_UUID_REQUIRED')
    if options.action=='verify-archive':verify_local(options)
    else:run_remote(options)

if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch('[A-Z0-9_]+',str(error)) else type(error).__name__
        print(json.dumps({'status':'STOP','code':code}));sys.exit(1)
