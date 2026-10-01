"""Guest-side read-only backup and post-autodeploy preservation proof for crm-staging.

Uses the already accepted W07 support by exact SHA. No fixture, SQL DML, DDL,
SSH, deploy, restore or production access. Backup writes only private evidence.
SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
Install as /root/pero-percentage-readonly-<sha256>.py after root review.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import uuid

SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790"
SUPPORT = Path(f"/root/pero-work-shares-{SUPPORT_SHA}.py")
ROOT = Path("/var/lib/pero-percentage-readonly")
OLD_REVISION = "3f6da0da082cc707370346c9c3a458ba24d1c189"
PRE_MIGRATION = "20260929120000_manager_cash_advances"
MIGRATIONS = {
    "20260930145000_product_percentage_enum_values": "2d5ea9ef028cf9c38dff0bd4030846a8bca5f39d197e473cc7731ee73d017f17",
    "20260930150000_product_percentage_pay": "7c0b2bf77c10418a534fca63a4d7b7c4d77c4c3ac7033aa69ff433bf14a42a6a",
}
NEW_TABLES = {"ProductPercentageConfig", "ProductPercentageParticipant", "ProductPercentageCompletion",
              "ProductPercentageCompletionShare"}
BASE_TABLES = {"User", "Client", "Project", "Product", "ProductStatusHistory", "ProjectStageHistory",
               "Task", "TaskAllocationGroup", "TaskDependency", "PriceItem", "Work", "TimeEntry",
               "PayrollEntry", "ProductStagePayPool", "WorkPaymentConversion", "ProductStageSettlement",
               "ProductStageSettlementShare", "Payout", "CashAccount", "ExpenseArticle", "Payment", "OrgSetting",
               "MaterialCategory", "Material", "ProjectMaterial", "StockMovement", "File", "Communication",
               "Notification", "NotificationPreference", "UserPreference", "Plugin", "PluginSetting",
               "PluginRunLog", "DomainEvent", "ApiToken", "ChangeLog", "TelegramLink"}
ADDED = {"Product": ("noModel",), "Task": ("physicalOnlyShare",),
         "PayrollEntry": ("percentageCompletionShareId",)}
OPTIONAL = {"ProductCompositionRevision", "ProductCompositionItem"}
STABLE_IDENTITY = ("hostname", "database", "databaseStartedAt", "databaseVolume", "pgdata", "outerW07Sha256")
S3_JS = r"""
import { ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
const endpoint = new URL(process.env.S3_ENDPOINT || '');
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '192.168.0.33' || endpoint.port !== '9000' ||
    process.env.S3_BUCKET !== 'pero-crm-staging' || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY)
  throw new Error('STORAGE_TARGET_FORBIDDEN');
const client = new S3Client({ endpoint: endpoint.href, region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }});
const rows = []; let keyMarker, versionIdMarker;
do {
  const page = await client.send(new ListObjectVersionsCommand({ Bucket: process.env.S3_BUCKET,
    KeyMarker: keyMarker, VersionIdMarker: versionIdMarker, MaxKeys: 1000 }));
  for (const v of page.Versions || []) rows.push([v.Key,v.ETag,v.Size,v.VersionId || null,v.IsLatest === true,false]);
  for (const v of page.DeleteMarkers || []) rows.push([v.Key,'delete-marker',0,v.VersionId || null,v.IsLatest === true,true]);
  if (!page.IsTruncated) break;
  if (!page.NextKeyMarker || !page.NextVersionIdMarker) throw new Error('STORAGE_PAGINATION_INVALID');
  keyMarker = page.NextKeyMarker; versionIdMarker = page.NextVersionIdMarker;
} while (true);
rows.sort((a,b) => String(a[0]+'|'+a[3]).localeCompare(String(b[0]+'|'+b[3])));
process.stdout.write(JSON.stringify(rows)+'\n');
"""


def check(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def support():
    check(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    check(SUPPORT.is_file() and not SUPPORT.is_symlink() and sha(SUPPORT.read_bytes()) == SUPPORT_SHA,
          "FROZEN_W07_SUPPORT_MISMATCH")
    spec = importlib.util.spec_from_file_location("accepted_w07_support", SUPPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.BACKUPS = ROOT
    return module


def request():
    name = f"pero-percentage-readonly-{sha(Path(__file__).read_bytes())}.py"
    check(Path(__file__).name == name, "SCRIPT_HASH_NAME_MISMATCH")
    value = json.load(sys.stdin)
    check(isinstance(value, dict) and set(value) == {"operation", "runId", "revision"}, "REQUEST_FIELDS_INVALID")
    op, run_id, revision = value["operation"], value["runId"], value["revision"]
    check(op in ("backup", "verify") and str(uuid.UUID(run_id, version=4)) == run_id and
          re.fullmatch(r"[a-f0-9]{40}", revision), "REQUEST_INVALID")
    if op == "backup":
        check(revision == OLD_REVISION, "BEFORE_REVISION_NOT_REVIEWED")
    else:
        check(revision != OLD_REVISION, "AFTER_REVISION_NOT_NEW")
    return op, run_id, revision


def table_set(snapshot, after):
    names = snapshot.query("SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'")
    check(all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) for name in names), "TABLE_NAME_INVALID")
    source = set(names) - (NEW_TABLES if after else set())
    extra = source - BASE_TABLES - {"_prisma_migrations"}
    check(extra <= OPTIONAL and source == BASE_TABLES | extra | {"_prisma_migrations"} and
          (NEW_TABLES <= set(names) if after else not NEW_TABLES.intersection(names)), "TABLE_SET_INVALID")
    return names


def default_counts(snapshot):
    return snapshot.query(
        "SELECT json_build_object('product',"
        "(SELECT count(*)::text FROM public.\"Product\" WHERE \"noModel\" IS DISTINCT FROM false),"
        "'task',(SELECT count(*)::text FROM public.\"Task\" WHERE \"physicalOnlyShare\" IS DISTINCT FROM false),"
        "'payroll',(SELECT count(*)::text FROM public.\"PayrollEntry\" WHERE \"percentageCompletionShareId\" IS NOT NULL))"
    )


def fingerprint(snapshot, names, after):
    result = {}
    for table in names:
        row = "to_jsonb(t)"
        if after and table in ADDED:
            row += " - ARRAY[" + ",".join("'" + key + "'" for key in ADDED[table]) + "]"
        if table == "ApiToken":
            row = "(" + row + ") - 'lastUsedAt'"  # accepted volatile use timestamp only
        result[table] = snapshot.query(
            "SELECT json_build_object('count',count(*)::text,'hash',"
            "md5(COALESCE(string_agg(d,'' ORDER BY d COLLATE \"C\"),''))) "
            "FROM (SELECT md5((" + row + ")::text) AS d FROM public.\"" + table + "\" t) q")
    return result


def columns(snapshot):
    values = snapshot.query("SELECT COALESCE(json_agg(json_build_object('table',table_name,'name',column_name,"
                            "'nullable',is_nullable,'default',column_default) ORDER BY table_name,ordinal_position),'[]') "
                            "FROM information_schema.columns WHERE table_schema='public'")
    result = {}
    for row in values:
        result.setdefault(row["table"], []).append(row)
    return result


def markers(snapshot, after):
    expected = snapshot.query(
        "SELECT json_build_object('count',count(*)::text,'hash',md5(COALESCE(string_agg(k,'' ORDER BY k COLLATE \"C\"),''))) "
        "FROM (SELECT p.id || '|ENGINEERING|' || COALESCE(p.\"expectedPrice\"::text,'NULL') || '|' || pr.currency AS k "
        "FROM public.\"Product\" p JOIN public.\"Project\" pr ON pr.id=p.\"projectId\" WHERE "
        "p.status IN ('PRODUCTION','DELIVERY','INSTALLATION','DONE') OR "
        "EXISTS (SELECT 1 FROM public.\"ProductStatusHistory\" h WHERE h.\"productId\"=p.id AND h.\"toStatus\" IN ('PRODUCTION','DELIVERY','INSTALLATION','DONE')) OR "
        "EXISTS (SELECT 1 FROM public.\"ProductStagePayPool\" pool WHERE pool.\"productId\"=p.id AND pool.kind='ENGINEERING' AND pool.state IN ('SETTLED','LEGACY_PROTECTED')) OR "
        "EXISTS (SELECT 1 FROM public.\"PayrollEntry\" pay WHERE pay.\"projectId\"=p.\"projectId\" AND pay.scheme='PERCENT_PROJECT') "
        "UNION ALL SELECT p.id || '|INSTALLATION|' || COALESCE(p.\"expectedPrice\"::text,'NULL') || '|' || pr.currency AS k "
        "FROM public.\"Product\" p JOIN public.\"Project\" pr ON pr.id=p.\"projectId\" WHERE p.status='DONE' OR "
        "EXISTS (SELECT 1 FROM public.\"ProductStatusHistory\" h WHERE h.\"productId\"=p.id AND h.\"toStatus\"='DONE')) q")
    if not after:
        return expected
    actual = snapshot.query(
        "SELECT json_build_object('count',count(*)::text,'hash',md5(COALESCE(string_agg(k,'' ORDER BY k COLLATE \"C\"),''))) "
        "FROM (SELECT c.\"productId\" || '|' || c.kind || '|' || COALESCE(c.\"priceSnapshot\"::text,'NULL') || '|' || c.\"productCurrency\" AS k "
        "FROM public.\"ProductPercentageCompletion\" c WHERE c.state='LEGACY_PROTECTED' AND c.amount IS NULL "
        "AND c.\"bynAmount\" IS NULL AND c.\"projectAmount\" IS NULL AND c.\"ratePercentSnapshot\" IS NULL "
        "AND c.\"payrollCurrency\" IS NULL) q")
    check(actual == expected, "COMPATIBILITY_MARKER_SET_DRIFT")
    return actual


def storage_inventory(old, web_id, directory, label):
    command = old.DOCKER + ["exec", "-w", "/app/apps/web", web_id,
                            "timeout", "-s", "KILL", "120", "node", "--input-type=module", "-e", S3_JS]
    result = subprocess.run(command, capture_output=True, env=old.SAFE_ENV, check=False)
    check(result.returncode == 0 and 0 < len(result.stdout) <= 1536 * 1024 and
          len(result.stderr) <= 128 * 1024, "STORAGE_METADATA_READ_FAILED")
    data = json.loads(result.stdout)
    check(isinstance(data, list) and all(isinstance(row, list) and len(row) == 6 and
          isinstance(row[0], str) and row[0] and isinstance(row[1], str) and row[1] and
          isinstance(row[2], int) and row[2] >= 0 and (row[3] is None or isinstance(row[3], str))
          for row in data), "STORAGE_METADATA_INVALID")
    data.sort(key=lambda row: (row[0], row[3] or ""))
    check(len({(row[0], row[3]) for row in data}) == len(data), "STORAGE_VERSION_DUPLICATE")
    path = directory / ("storage-" + label + ".json")
    old.write_exclusive(path, data)
    return {"count": len(data), "sha256": sha(canonical(data))}


def main():
    op, run_id, revision = request()
    old = support()
    old.directory(old.REFRESH)
    with os.fdopen(old.protected_open(old.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old.require_refresh_idle()
        identity, password = old.identity(revision)
        if not ROOT.exists():
            ROOT.mkdir(mode=0o700)
        old.directory(ROOT, 0o700)
        directory = ROOT / run_id
        if op == "backup":
            check(not directory.exists(), "BACKUP_RUN_ALREADY_ATTEMPTED")
            directory.mkdir(mode=0o700)
        old.directory(directory, 0o700)
        with old.Snapshot(password, identity, directory, "export-" + str(uuid.uuid4())) as snapshot:
            names = table_set(snapshot, op == "verify")
            data = fingerprint(snapshot, names, op == "verify")
            layout = columns(snapshot)
            marker_set = markers(snapshot, op == "verify")
            ledger = snapshot.query("SELECT COALESCE(json_agg(r ORDER BY r.migration_name,r.id),'[]') FROM "
                                    "(SELECT id,migration_name,checksum,finished_at,rolled_back_at FROM public.\"_prisma_migrations\") r")
            check(all(row["finished_at"] or row["rolled_back_at"] for row in ledger), "FAILED_MIGRATION")
            if op == "backup":
                check(not any(row["migration_name"] in MIGRATIONS for row in ledger), "MIGRATION_ALREADY_APPLIED")
                check(ledger and max(row["migration_name"] for row in ledger) == PRE_MIGRATION,
                      "PRE_MIGRATION_LEDGER_MISMATCH")
                command, env = old.pg_command(["pg_dump", "-h", "127.0.0.1", "-U", "crm", "-d", "crm", "-Fc",
                                                "--snapshot=" + snapshot.facts["snapshot"]], password, seconds=480)
                with os.fdopen(old.protected_open(directory / "stage-before.dump", os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as output:
                    result = subprocess.run(command, stdout=output, stderr=subprocess.DEVNULL, env=env, check=False)
                    output.flush(); os.fsync(output.fileno())
                check(result.returncode == 0, "BACKUP_FAILED")
                archive = old.check_archive(directory, password, names)
                command, env = old.pg_command(["pg_restore", "--file=-"], password, seconds=120, interactive=True)
                with os.fdopen(old.protected_open(directory / "stage-before.dump", os.O_RDONLY), "rb") as inp:
                    read_result = subprocess.run(command, stdin=inp, stdout=subprocess.DEVNULL,
                                                 stderr=subprocess.DEVNULL, env=env, check=False)
                check(read_result.returncode == 0, "BACKUP_FULL_READ_FAILED")
                storage = storage_inventory(old, identity["web"], directory, "before")
                receipt = {"runId": run_id, "identity": identity, "tables": data, "columns": layout,
                           "ledger": ledger, "markerExpected": marker_set, "backup": archive,
                           "fullReadVerified": True, "storage": storage, "sqlSha256": MIGRATIONS}
                receipt_sha = old.write_exclusive(directory / "receipt.json", receipt)
                old.write_exclusive(directory / "receipt.sha256", (receipt_sha + "\n").encode())
                summary = {"status": "BACKUP_VERIFIED_READONLY", "runId": run_id, "revision": revision,
                           "receiptSha256": receipt_sha, "archiveSha256": archive["sha256"],
                           "tableCount": len(names) - 1, "storageKeyVersions": storage["count"],
                           "restoreTest": "NOT_RUN"}
            else:
                raw = old.read_private(directory / "receipt.json")
                check(sha(raw) == old.read_private(directory / "receipt.sha256").decode().strip(), "RECEIPT_DRIFT")
                receipt = json.loads(raw)
                check(receipt["sqlSha256"] == MIGRATIONS and receipt["fullReadVerified"] is True,
                      "BACKUP_PROOF_MISMATCH")
                old.check_archive(directory, password, list(receipt["tables"]), receipt["backup"])
                check(all(identity[key] == receipt["identity"][key] for key in STABLE_IDENTITY),
                      "STAGE_TARGET_CHANGED")
                check(set(names) == set(receipt["tables"]) | NEW_TABLES, "POST_TABLE_SET_DRIFT")
                check(default_counts(snapshot) == {"product": "0", "task": "0", "payroll": "0"},
                      "OLD_ROW_NEW_DEFAULT_CHANGED")
                for table in receipt["tables"]:
                    if table == "_prisma_migrations":
                        continue
                    check(data[table] == receipt["tables"][table], "OLD_BUSINESS_ROWS_CHANGED")
                    old_cols, new_cols = receipt["columns"][table], layout[table]
                    extra = set(ADDED.get(table, ()))
                    check([row for row in new_cols if row["name"] not in extra] == old_cols and
                          {row["name"] for row in new_cols if row["name"] in extra} == extra,
                          "OLD_COLUMN_LAYOUT_DRIFT")
                check(all(data[table]["count"] == "0" for table in NEW_TABLES - {"ProductPercentageCompletion"}),
                      "NEW_CONFIG_OR_SHARE_ROWS_UNEXPECTED")
                check(marker_set == receipt["markerExpected"] and
                      data["ProductPercentageCompletion"]["count"] == marker_set["count"],
                      "COMPATIBILITY_MARKERS_CHANGED")
                old_ledger = receipt["ledger"]
                check([row for row in ledger if row["migration_name"] not in MIGRATIONS] == old_ledger,
                      "OLD_LEDGER_CHANGED")
                for name, sql_sha in MIGRATIONS.items():
                    applied = [row for row in ledger if row["migration_name"] == name]
                    check(len(applied) == 1 and applied[0]["checksum"] == sql_sha and applied[0]["finished_at"] and
                          not applied[0]["rolled_back_at"], "MIGRATION_LEDGER_MISMATCH")
                storage = storage_inventory(old, identity["web"], directory, "after")
                check(storage == receipt["storage"], "STORAGE_METADATA_DRIFT")
                summary = {"status": "READONLY_PRESERVATION_PASS", "runId": run_id, "revision": revision,
                           "oldTablesPreserved": len(receipt["tables"]) - 1,
                           "compatibilityMarkers": marker_set["count"], "newEarnedEntries": 0,
                           "storageKeyVersions": storage["count"]}
                old.write_exclusive(directory / ("verified-" + revision + ".json"),
                                    {"summary": summary, "schemaTables": names, "storage": storage})
        old.require_refresh_idle()
        check(old.identity(revision)[0] == identity, "DEPLOYMENT_CHANGED_DURING_PROOF")
        print(json.dumps(summary, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        print(json.dumps({"status": "STOP", "code": code if re.fullmatch(r"[A-Z][A-Z0-9_]{2,100}", code)
                                                       else "STAGE_READONLY_REVIEW_REQUIRED"}))
        sys.exit(2)
