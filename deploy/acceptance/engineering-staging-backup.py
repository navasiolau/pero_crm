"""Root opt-in staging backup/migration readback. Never migrates or deploys.
Uses the frozen, previously accepted identity/PSQL/W07 transport by exact hash.
JSON request on stdin: {operation:backup|verify,runId,revision}; private receipt
stays on crm-staging. stdout contains only counts/hashes, never credentials.
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
SUPPORT = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
MIGRATION = "20260928220000_product_engineering_pay"
SQL_SHA = "0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266"
OLD_REVISION = "13732b696cd8928d25fb895e527c8162b679aae8"
NEW_TABLES = {"ProductStagePayPool", "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare"}
ADDED = {"Work": ["paymentKind", "stagePayPoolId", "poolWeightUnits"], "Task": ["stageShareUnits"],
         "TaskAllocationGroup": ["budgetSource"], "PayrollEntry": ["productId", "settlementShareId", "bynAmount", "projectAmount", "projectCurrency"]}


def check(ok, code):
    if not ok:
        raise RuntimeError(code)


def load_support():
    check(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    check(not SUPPORT.is_symlink() and hashlib.sha256(SUPPORT.read_bytes()).hexdigest() == SUPPORT_SHA, "FROZEN_SUPPORT_MISMATCH")
    spec = importlib.util.spec_from_file_location("accepted_stage_support", SUPPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # New owned backup directory, retaining the reviewed path/permission checks.
    module.BACKUPS = Path("/var/lib/pero-engineering-qa")
    return module


def snapshot_state(s):
    tables = s.query("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'")
    check(all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", t) for t in tables), "TABLE_NAME_INVALID")
    hashes, full = {}, {}
    for table in tables:
        row = "to_jsonb(t)"
        if table in ADDED:
            row += " - ARRAY[" + ",".join("'" + key + "'" for key in ADDED[table]) + "]"
        # Only routine API last-use and the known plugin startup timestamp differ.
        protected = row
        if table == "ApiToken":
            protected = "(" + row + ") - 'lastUsedAt'"
        if table == "Plugin":
            protected = "CASE WHEN t.id IN ('demo','file-stages') THEN (" + row + ") - 'updatedAt' ELSE " + row + " END"
        for destination, expression in ((hashes, protected), (full, row)):
            destination[table] = s.query("SELECT json_build_object('count',count(*)::text,'hash',md5(COALESCE(string_agg(d,'' ORDER BY d COLLATE \"C\"),''))) FROM (SELECT md5((" + expression + ")::text) AS d FROM public.\"" + table + "\" t) q")
    ledger = s.query("SELECT COALESCE(json_agg(r ORDER BY r.migration_name,r.id),'[]') FROM (SELECT id,migration_name,checksum,finished_at,rolled_back_at FROM public.\"_prisma_migrations\") r")
    return {"tables": hashes, "full": full, "migrations": ledger}


def main():
    check(Path(__file__).name == "pero-engineering-backup-" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest() + ".py", "SCRIPT_CHECKSUM_NAME_MISMATCH")
    request = json.load(sys.stdin)
    check(set(request) == {"operation", "runId", "revision"}, "REQUEST_FIELDS_INVALID")
    op, run_id, revision = (request[k] for k in ("operation", "runId", "revision"))
    check(op in ("backup", "verify") and str(uuid.UUID(run_id, version=4)) == run_id and re.fullmatch(r"[a-f0-9]{40}", revision), "REQUEST_INVALID")
    if op == "backup":
        check(revision == OLD_REVISION, "PRE_RELEASE_REVISION_MISMATCH")
    support = load_support()
    with os.fdopen(support.protected_open(support.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        support.require_refresh_idle()
        identity, password = support.identity(revision)
        root = support.BACKUPS
        if not root.exists():
            root.mkdir(mode=0o700)
        support.directory(root, 0o700)
        directory = root / run_id
        if op == "backup":
            directory.mkdir(mode=0o700)
            support.fsync_directory(root)
        support.directory(directory, 0o700)
        with support.Snapshot(password, identity, directory, "export-" + str(uuid.uuid4())) as snap:
            state = snapshot_state(snap)
            check(all(r["finished_at"] or r["rolled_back_at"] for r in state["migrations"]), "FAILED_MIGRATION")
            if op == "backup":
                check(not NEW_TABLES.intersection(state["tables"]) and state["tables"]["PayrollEntry"]["count"] == "0", "PRE_SCHEMA_OR_COVERAGE_CHANGED")
                check(max(r["migration_name"] for r in state["migrations"]) == "20260928140000_universal_work_shares", "PRE_MIGRATION_MISMATCH")
                args, env = support.pg_command(["pg_dump", "-h", "127.0.0.1", "-U", "crm", "-d", "crm", "-Fc", "--snapshot=" + snap.facts["snapshot"]], password, seconds=480)
                with os.fdopen(support.protected_open(directory / "stage-before.dump", os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as output:
                    result = subprocess.run(args, stdout=output, stderr=subprocess.DEVNULL, env=env, check=False)
                    output.flush()
                    os.fsync(output.fileno())
                check(result.returncode == 0, "BACKUP_FAILED")
                archive = support.check_archive(directory, password, state["tables"])
                args, env = support.pg_command(["pg_restore", "--file=-"], password, seconds=120, interactive=True)
                with os.fdopen(support.protected_open(directory / "stage-before.dump", os.O_RDONLY), "rb") as inp:
                    result = subprocess.run(args, stdin=inp, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, check=False)
                check(result.returncode == 0, "BACKUP_READ_FAILED")
                receipt = {"migration": MIGRATION, "sqlSha256": SQL_SHA, "identity": identity, "state": state, "backup": archive}
                receipt_sha = support.write_exclusive(directory / "receipt.json", receipt)
                support.write_exclusive(directory / "receipt.sha256", (receipt_sha + "\n").encode())
                result_summary = {"status": "BACKUP_READY", "runId": run_id, "receiptSha256": receipt_sha, "backup": archive, "tables": len(state["tables"]), "restoreTest": False}
            else:
                raw = support.read_private(directory / "receipt.json")
                check(support.sha(raw) == support.read_private(directory / "receipt.sha256").decode().strip(), "RECEIPT_DRIFT")
                receipt = json.loads(raw)
                support.check_archive(directory, password, receipt["state"]["tables"], receipt["backup"])
                old = dict(state["tables"])
                for table in NEW_TABLES:
                    check(old.pop(table, {}).get("count") == "0", "NEW_TABLE_NOT_EMPTY")
                old.pop("_prisma_migrations", None)
                previous = {k: v for k, v in receipt["state"]["tables"].items() if k != "_prisma_migrations"}
                check(old == previous, "BUSINESS_DATA_DRIFT")
                check([r for r in state["migrations"] if r["migration_name"] != MIGRATION] == receipt["state"]["migrations"], "OLD_LEDGER_DRIFT")
                applied = [r for r in state["migrations"] if r["migration_name"] == MIGRATION]
                check(len(applied) == 1 and applied[0]["checksum"] == SQL_SHA and applied[0]["finished_at"] and not applied[0]["rolled_back_at"], "MIGRATION_CHECKSUM_MISMATCH")
                result_summary = {"status": "MIGRATION_AND_PRESERVATION_PASS", "runId": run_id, "revision": revision, "preservedTables": len(previous), "newTablesEmpty": 4,
                                  "routineMetadataTablesChanged": [t for t in ("ApiToken", "Plugin") if state["full"][t] != receipt["state"]["full"][t]]}
                support.write_exclusive(directory / ("verified-" + revision + ".json"), {"summary": result_summary, "state": state})
        support.require_refresh_idle()
        check(support.identity(revision)[0] == identity, "DEPLOYMENT_DRIFT")
        print(json.dumps(result_summary))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        print(json.dumps({"status": "STOP", "code": code if re.fullmatch(r"[A-Z_]+", code) else "STAGING_BACKUP_REVIEW_REQUIRED"}))
        sys.exit(1)
