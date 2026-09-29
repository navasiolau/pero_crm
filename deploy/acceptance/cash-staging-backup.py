"""Root opt-in staging backup and migration-preservation readback for cash advances.

This script only performs a protected pg_dump/verify under the existing W07
workflow lock. It never applies migrations or deploys. The remote copy must be
named `pero-cash-staging-backup-<sha256>.py` for its own exact source hash.
JSON request on stdin: {operation:backup|verify,runId,revision}. Stdout contains
only summaries, hashes, table names, and counts; credentials remain private.
"""
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
BACKUP_ROOT = Path("/var/lib/pero-cash-qa")
OLD_REVISION = "8ed48388a8df06c10b58d3e2b6d7a4cf72a29f66"
PRE_MIGRATION = "20260928220000_product_engineering_pay"
MIGRATION = "20260929120000_manager_cash_advances"
SQL_SHA = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd"
MIGRATION_TABLE = "_prisma_migrations"
BUSINESS_TABLE_COUNT = 38
NEW_TABLES = frozenset()

# Keep the legacy Payout row projection stable. These are exactly the nine
# nullable columns in the reviewed additive cash-advances migration.
PAYOUT_ADDITIONS = (
    {"name": "cashAccountId", "dataType": "text", "udtName": "text", "nullable": "YES",
     "numericPrecision": None, "numericScale": None, "columnDefault": None},
    {"name": "cashAmount", "dataType": "numeric", "udtName": "numeric", "nullable": "YES",
     "numericPrecision": 12, "numericScale": 2, "columnDefault": None},
    {"name": "cashCurrency", "dataType": "text", "udtName": "text", "nullable": "YES",
     "numericPrecision": None, "numericScale": None, "columnDefault": None},
    {"name": "bynAmount", "dataType": "numeric", "udtName": "numeric", "nullable": "YES",
     "numericPrecision": 18, "numericScale": 2, "columnDefault": None},
    {"name": "cashRate", "dataType": "numeric", "udtName": "numeric", "nullable": "YES",
     "numericPrecision": 14, "numericScale": 6, "columnDefault": None},
    {"name": "payrollRate", "dataType": "numeric", "udtName": "numeric", "nullable": "YES",
     "numericPrecision": 14, "numericScale": 6, "columnDefault": None},
    {"name": "cashRateDate", "dataType": "date", "udtName": "date", "nullable": "YES",
     "numericPrecision": None, "numericScale": None, "columnDefault": None},
    {"name": "payrollRateDate", "dataType": "date", "udtName": "date", "nullable": "YES",
     "numericPrecision": None, "numericScale": None, "columnDefault": None},
    {"name": "payrollCurrency", "dataType": "text", "udtName": "text", "nullable": "YES",
     "numericPrecision": None, "numericScale": None, "columnDefault": None},
)
PAYOUT_ADDITION_NAMES = tuple(column["name"] for column in PAYOUT_ADDITIONS)
METADATA_VOLATILE_FIELDS = {"ApiToken": ("lastUsedAt",), "Plugin": ("updatedAt",)}
IDENTITY_FIELDS = frozenset(("hostname", "web", "image", "revision", "webStartedAt", "database",
                             "databaseStartedAt", "databaseVolume", "pgdata", "outerW07Sha256"))
STABLE_IDENTITY_FIELDS = ("hostname", "database", "databaseStartedAt", "databaseVolume", "pgdata", "outerW07Sha256")


def check(ok, code):
    if not ok:
        raise RuntimeError(code)


def row_projection(table):
    """Return the protected legacy projection and the unfiltered full row."""
    row = "to_jsonb(t)"
    if table == "Payout":
        quoted = ",".join("'" + column + "'" for column in PAYOUT_ADDITION_NAMES)
        row += " - ARRAY[" + quoted + "]"
    protected = row
    if table == "ApiToken":
        protected = "(" + row + ") - 'lastUsedAt'"
    if table == "Plugin":
        protected = "CASE WHEN t.id IN ('demo','file-stages') THEN (" + row + ") - 'updatedAt' ELSE " + row + " END"
    return protected, "to_jsonb(t)"


def validate_backup_identity(identity):
    check(isinstance(identity, dict) and set(identity) == IDENTITY_FIELDS, "STAGING_IDENTITY_FIELDS_INVALID")
    check(identity["revision"] == OLD_REVISION, "BACKUP_REVISION_MISMATCH")


def verify_backup_identity(backup_identity, current_identity):
    """Allow the accepted web deployment to change; bind verify to stable DB/host identity."""
    validate_backup_identity(backup_identity)
    check(isinstance(current_identity, dict) and set(current_identity) == IDENTITY_FIELDS,
          "STAGING_IDENTITY_FIELDS_INVALID")
    check(all(backup_identity[key] == current_identity[key] for key in STABLE_IDENTITY_FIELDS),
          "BACKUP_TARGET_MISMATCH")


def normalize_columns(rows):
    """Convert information_schema rows to a stable table/column projection."""
    columns = {}
    for row in rows:
        table = row["tableName"]
        columns.setdefault(table, []).append({
            "name": row["columnName"],
            "dataType": row["dataType"],
            "udtName": row["udtName"],
            "nullable": row["nullable"],
            "numericPrecision": row["numericPrecision"],
            "numericScale": row["numericScale"],
            "columnDefault": row["columnDefault"],
        })
    return columns


def validate_prior_state(state):
    """Guard the backup snapshot before migration; Payout count may be nonzero."""
    tables = set(state["tables"])
    check(MIGRATION_TABLE in tables, "MIGRATION_LEDGER_MISSING")
    check(len(tables - {MIGRATION_TABLE}) == BUSINESS_TABLE_COUNT, "BUSINESS_TABLE_COUNT_MISMATCH")
    check(not NEW_TABLES.intersection(tables), "NEW_TABLE_PRESENT_BEFORE_MIGRATION")
    check(set(state["columns"]) == tables, "TABLE_COLUMN_LAYOUT_MISMATCH")
    check("Payout" in state["columns"], "PAYOUT_TABLE_MISSING")
    payout_names = {column["name"] for column in state["columns"]["Payout"]}
    check(not payout_names.intersection(PAYOUT_ADDITION_NAMES), "PAYOUT_SCHEMA_ALREADY_EXTENDED")
    check(state["payoutCashFields"] is None, "PAYOUT_CASH_FIELDS_PRESENT_BEFORE_MIGRATION")
    ledger = state["migrations"]
    check(bool(ledger), "MIGRATION_LEDGER_EMPTY")
    check(all(row["finished_at"] or row["rolled_back_at"] for row in ledger), "FAILED_MIGRATION")
    check(max(row["migration_name"] for row in ledger) == PRE_MIGRATION, "PRE_MIGRATION_MISMATCH")
    check(not any(row["migration_name"] == MIGRATION for row in ledger), "CASH_MIGRATION_ALREADY_PRESENT")


def validate_column_extension(before, after):
    """Require identical schema except the exact ordered nine nullable Payout fields."""
    check(set(before) == set(after), "TABLE_SET_DRIFT")
    check(MIGRATION_TABLE in before and len(set(before) - {MIGRATION_TABLE}) == BUSINESS_TABLE_COUNT,
          "BUSINESS_TABLE_COUNT_MISMATCH")
    check(not NEW_TABLES.intersection(after), "NEW_TABLE_PRESENT")
    for table in before:
        if table == "Payout":
            old_columns = before[table]
            new_columns = after[table]
            old_names = {column["name"] for column in old_columns}
            check(not old_names.intersection(PAYOUT_ADDITION_NAMES), "PAYOUT_PREIMAGE_ALREADY_EXTENDED")
            check(new_columns[:len(old_columns)] == old_columns, "PAYOUT_OLD_COLUMN_LAYOUT_DRIFT")
            check(new_columns[len(old_columns):] == list(PAYOUT_ADDITIONS), "PAYOUT_ADDITIONS_MISMATCH")
        else:
            check(before[table] == after[table], "COLUMN_LAYOUT_DRIFT")


def validate_migrated_state(before, after):
    """Verify the exact new migration and preserve all pre-migration projections."""
    validate_prior_state(before)
    validate_column_extension(before["columns"], after["columns"])

    check(set(before["tables"]) == set(after["tables"]), "TABLE_SET_DRIFT")
    for table in before["tables"]:
        if table == MIGRATION_TABLE:
            continue
        check(before["tables"][table] == after["tables"][table], "BUSINESS_PROJECTION_DRIFT")

    cash_fields = after["payoutCashFields"]
    check(isinstance(cash_fields, dict), "PAYOUT_CASH_FIELDS_UNAVAILABLE")
    check(cash_fields.get("rowCount") is not None, "PAYOUT_ROW_COUNT_UNAVAILABLE")
    non_null_counts = cash_fields.get("nonNullCounts", {})
    check(set(non_null_counts) == set(PAYOUT_ADDITION_NAMES), "PAYOUT_NULL_CHECK_FIELDS_MISMATCH")
    check(all(str(non_null_counts[name]) == "0" for name in PAYOUT_ADDITION_NAMES), "LEGACY_PAYOUT_FIELDS_NOT_NULL")

    old_ledger = before["migrations"]
    current_ledger = after["migrations"]
    check(all(row["finished_at"] or row["rolled_back_at"] for row in current_ledger), "FAILED_MIGRATION")
    check([row for row in current_ledger if row["migration_name"] != MIGRATION] == old_ledger,
          "OLD_LEDGER_DRIFT")
    applied = [row for row in current_ledger if row["migration_name"] == MIGRATION]
    check(len(applied) == 1 and applied[0]["checksum"] == SQL_SHA and applied[0]["finished_at"]
          and not applied[0]["rolled_back_at"], "MIGRATION_CHECKSUM_MISMATCH")
    check(len(current_ledger) == len(old_ledger) + 1, "UNEXPECTED_MIGRATION_RECORD")

    full_hash_drift = sorted(table for table in before["full"]
                             if before["full"][table] != after["full"].get(table))
    allowed_full_drift = {"Payout", MIGRATION_TABLE, "ApiToken", "Plugin"}
    check(set(full_hash_drift) <= allowed_full_drift, "UNEXPECTED_FULL_HASH_DRIFT")
    return {
        "businessTablesPreserved": BUSINESS_TABLE_COUNT,
        "newTables": [],
        "payoutRows": str(cash_fields["rowCount"]),
        "payoutCashFieldNonNullCounts": {name: str(non_null_counts[name]) for name in PAYOUT_ADDITION_NAMES},
        "migration": MIGRATION,
        "sqlSha256": SQL_SHA,
        "fullHashDriftTables": full_hash_drift,
        "routineMetadataFullHashDrift": [table for table in ("ApiToken", "Plugin") if table in full_hash_drift],
    }


def snapshot_state(snapshot):
    tables = snapshot.query("SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'")
    check(all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table) for table in tables), "TABLE_NAME_INVALID")
    column_rows = snapshot.query(
        "SELECT COALESCE(json_agg(json_build_object('tableName',table_name,'columnName',column_name,"
        "'dataType',data_type,'udtName',udt_name,'nullable',is_nullable,'numericPrecision',numeric_precision,"
        "'numericScale',numeric_scale,'columnDefault',column_default) ORDER BY table_name,ordinal_position),'[]') "
        "FROM information_schema.columns WHERE table_schema='public'"
    )
    columns = normalize_columns(column_rows)
    check(set(columns) == set(tables), "TABLE_COLUMN_LAYOUT_MISMATCH")

    hashes, full = {}, {}
    for table in tables:
        protected, row = row_projection(table)
        for destination, expression in ((hashes, protected), (full, row)):
            destination[table] = snapshot.query(
                "SELECT json_build_object('count',count(*)::text,'hash',md5(COALESCE(string_agg(d,'' ORDER BY d COLLATE \"C\"),''))) "
                "FROM (SELECT md5((" + expression + ")::text) AS d FROM public.\"" + table + "\" t) q"
            )

    payout_cash_fields = None
    payout_column_names = {column["name"] for column in columns.get("Payout", [])}
    if set(PAYOUT_ADDITION_NAMES).issubset(payout_column_names):
        fields = ",".join("'" + name + "',count(\"" + name + "\")::text" for name in PAYOUT_ADDITION_NAMES)
        payout_cash_fields = snapshot.query(
            "SELECT json_build_object('rowCount',count(*)::text,'nonNullCounts',json_build_object(" + fields + ")) FROM public.\"Payout\""
        )
    ledger = snapshot.query(
        "SELECT COALESCE(json_agg(r ORDER BY r.migration_name,r.id),'[]') FROM "
        "(SELECT id,migration_name,checksum,finished_at,rolled_back_at FROM public.\"_prisma_migrations\") r"
    )
    return {"tables": hashes, "full": full, "columns": columns, "payoutCashFields": payout_cash_fields,
            "migrations": ledger}


def load_support():
    check(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    check(not SUPPORT.is_symlink() and hashlib.sha256(SUPPORT.read_bytes()).hexdigest() == SUPPORT_SHA,
          "FROZEN_SUPPORT_MISMATCH")
    spec = importlib.util.spec_from_file_location("accepted_stage_support", SUPPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.BACKUPS = BACKUP_ROOT
    return module


def parse_request():
    request = json.load(sys.stdin)
    check(set(request) == {"operation", "runId", "revision"}, "REQUEST_FIELDS_INVALID")
    operation, run_id, revision = (request[key] for key in ("operation", "runId", "revision"))
    check(operation in ("backup", "verify") and str(uuid.UUID(run_id, version=4)) == run_id
          and re.fullmatch(r"[a-f0-9]{40}", revision), "REQUEST_INVALID")
    if operation == "backup":
        check(revision == OLD_REVISION, "PRE_RELEASE_REVISION_MISMATCH")
    return operation, run_id, revision


def main():
    remote_name = "pero-cash-staging-backup-" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest() + ".py"
    check(Path(__file__).name == remote_name, "SCRIPT_CHECKSUM_NAME_MISMATCH")
    operation, run_id, revision = parse_request()
    support = load_support()
    import fcntl

    with os.fdopen(support.protected_open(support.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        support.require_refresh_idle()
        identity, password = support.identity(revision)
        if operation == "backup":
            validate_backup_identity(identity)
        root = support.BACKUPS
        if not root.exists():
            root.mkdir(mode=0o700)
        support.directory(root, 0o700)
        directory = root / run_id
        if operation == "backup":
            directory.mkdir(mode=0o700)
            support.fsync_directory(root)
        support.directory(directory, 0o700)
        with support.Snapshot(password, identity, directory, "export-" + str(uuid.uuid4())) as snapshot:
            state = snapshot_state(snapshot)
            if operation == "backup":
                validate_prior_state(state)
                args, env = support.pg_command(
                    ["pg_dump", "-h", "127.0.0.1", "-U", "crm", "-d", "crm", "-Fc",
                     "--snapshot=" + snapshot.facts["snapshot"]], password, seconds=480)
                with os.fdopen(support.protected_open(directory / "stage-before.dump", os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as output:
                    result = subprocess.run(args, stdout=output, stderr=subprocess.DEVNULL, env=env, check=False)
                    output.flush()
                    os.fsync(output.fileno())
                check(result.returncode == 0, "BACKUP_FAILED")
                archive = support.check_archive(directory, password, state["tables"])
                args, env = support.pg_command(["pg_restore", "--file=-"], password, seconds=120, interactive=True)
                with os.fdopen(support.protected_open(directory / "stage-before.dump", os.O_RDONLY), "rb") as source:
                    result = subprocess.run(args, stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, check=False)
                check(result.returncode == 0, "BACKUP_READ_FAILED")
                receipt = {"migration": MIGRATION, "sqlSha256": SQL_SHA, "identity": identity,
                           "state": state, "backup": archive}
                receipt_sha = support.write_exclusive(directory / "receipt.json", receipt)
                support.write_exclusive(directory / "receipt.sha256", (receipt_sha + "\n").encode())
                result_summary = {"status": "BACKUP_READY", "runId": run_id, "receiptSha256": receipt_sha,
                                  "backup": archive, "businessTables": BUSINESS_TABLE_COUNT, "restoreTest": False}
            else:
                raw = support.read_private(directory / "receipt.json")
                check(support.sha(raw) == support.read_private(directory / "receipt.sha256").decode().strip(), "RECEIPT_DRIFT")
                receipt = json.loads(raw)
                check(receipt.get("migration") == MIGRATION and receipt.get("sqlSha256") == SQL_SHA,
                      "RECEIPT_TARGET_MISMATCH")
                verify_backup_identity(receipt.get("identity"), identity)
                support.check_archive(directory, password, receipt["state"]["tables"], receipt["backup"])
                result_summary = validate_migrated_state(receipt["state"], state)
                result_summary.update({"status": "MIGRATION_AND_PRESERVATION_PASS", "runId": run_id,
                                       "revision": revision, "restoreTest": False})
                support.write_exclusive(directory / ("verified-" + revision + ".json"),
                                        {"summary": result_summary, "state": state})
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
