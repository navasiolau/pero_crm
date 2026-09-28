"""Read-only inventory of the existing local/staging databases; never production."""
import json
import os
import re
import socket
import subprocess
import sys

TARGETS = {
    "local": ("pero_crm_pg", "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5", "pero_crm_v2_pgdata", "pero_crm", "pero"),
    "staging": ("crm-staging-db-1", "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a", "crm-staging_pgdata", "crm", "crm"),
}

def main():
    target = sys.argv[1] if len(sys.argv) == 2 else ""
    if target not in TARGETS:
        raise RuntimeError("TARGET_FORBIDDEN")
    if target == "staging":
        if socket.gethostname() != "crm-staging":
            raise RuntimeError("HOST_MISMATCH")
        endpoint = "unix:///var/run/docker.sock"
    else:
        if sys.platform != "win32":
            raise RuntimeError("LOCAL_HOST_MISMATCH")
        context = json.loads(subprocess.check_output(["docker", "context", "inspect"], text=True))[0]
        endpoint = context["Endpoints"]["docker"]["Host"]
        if not re.fullmatch(r"npipe:////\./pipe/[A-Za-z0-9_-]+", endpoint):
            raise RuntimeError("LOCAL_DOCKER_ENDPOINT_MISMATCH")
    name, identity, volume, database_name, database_user = TARGETS[target]
    docker = ["docker", "--host", endpoint]
    database = json.loads(subprocess.check_output(docker + ["inspect", name], text=True))[0]
    if database["Id"] != identity or database["State"]["Status"] != "running":
        raise RuntimeError("DATABASE_IDENTITY_MISMATCH")
    mounts = database["Mounts"]
    if not any(item.get("Name") == volume and item["Destination"] == "/var/lib/postgresql/data" for item in mounts):
        raise RuntimeError("DATABASE_VOLUME_MISMATCH")
    env = dict(item.split("=", 1) for item in database["Config"]["Env"] if "=" in item)
    if env.get("POSTGRES_DB") != database_name or env.get("POSTGRES_USER") != database_user:
        raise RuntimeError("DATABASE_NAME_MISMATCH")
    sql = '''BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT encode(convert_to(json_build_object(
 'database', current_database(),
 'schema6Present', to_regclass('public."ProductStagePayPool"') IS NOT NULL,
 'shareSchemaPresent', to_regclass('public."TaskAllocationGroup"') IS NOT NULL,
 'failedMigrations', (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL),
 'latestMigration', (SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1),
 'projects', (SELECT count(*) FROM "Project"), 'products', (SELECT count(*) FROM "Product"),
 'works', (SELECT count(*) FROM "Work"), 'tasks', (SELECT count(*) FROM "Task"),
 'users', (SELECT count(*) FROM "User"), 'files', (SELECT count(*) FROM "File"),
 'payrollEntries', (SELECT count(*) FROM "PayrollEntry"),
 'potentialLegacyPercentWriters', (SELECT count(*) FROM "User" WHERE "payScheme"='PERCENT_PROJECT' AND "payPercent">0),
 'otherActiveTransactions', (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active'),
 'legacyPaidProjects', (SELECT count(DISTINCT "projectId") FROM "PayrollEntry" WHERE scheme='PERCENT_PROJECT'),
 'legacyProtectedProducts', (SELECT count(*) FROM "Product" p WHERE EXISTS(SELECT 1 FROM "PayrollEntry" e WHERE e."projectId"=p."projectId" AND e.scheme='PERCENT_PROJECT')),
 'legacyMoneyNullOrNaN', (SELECT count(*) FROM "Work" WHERE "priceSnapshot" IS NULL OR total IS NULL OR "priceSnapshot"::text='NaN' OR total::text='NaN'),
 'legacyNonpositiveQuantity', (SELECT count(*) FROM "Work" WHERE quantity<=0 OR quantity::text='NaN'),
 'legacyMismatchedTaskContext', (SELECT count(*) FROM "Task" t JOIN "Work" w ON w.id=t."workId" WHERE t."projectId" IS DISTINCT FROM w."projectId" OR t."productId" IS DISTINCT FROM w."productId"),
 'payrollCurrencies', COALESCE((SELECT json_agg(s) FROM (SELECT currency,count(*) AS count FROM "PayrollEntry" GROUP BY currency) s),'[]'::json),
 'payrollCurrency', COALESCE((SELECT value FROM "OrgSetting" WHERE key='payrollCurrency'),'BYN')
)::text,'UTF8'),'hex');
COMMIT;'''
    process_env = dict(os.environ)
    if env.get("POSTGRES_PASSWORD"):
        process_env["PGPASSWORD"] = env["POSTGRES_PASSWORD"]
    result = subprocess.run(docker + ["exec", "-i", "-e", "PGPASSWORD", identity, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", database_user, "-d", database_name],
                            input=sql, text=True, capture_output=True, env=process_env, timeout=40)
    if result.returncode:
        raise RuntimeError("READ_ONLY_INVENTORY_FAILED: " + result.stderr[:300])
    lines = result.stdout.splitlines()
    if len(lines) != 1 or not re.fullmatch("[0-9a-f]+", lines[0]):
        raise RuntimeError("INVENTORY_ENCODING_MISMATCH")
    inventory = json.loads(bytes.fromhex(lines[0]).decode("utf-8"))
    print(json.dumps({"target": target, "containerId": identity, "databaseStartedAt": database["State"]["StartedAt"], "volume": volume, "readOnly": True, "inventory": inventory}, ensure_ascii=False))

if __name__ == "__main__":
    main()
