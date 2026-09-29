"""Read-only, W07-locked diagnosis of the accepted cash migration projection drift."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import uuid

SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790"
SUPPORT = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
BACKUP_SHA = "d54c7697d7f77d5b79faf75d73247ff950269d5cb3a7890b7d3a1cd18abbbec2"
BACKUP_SCRIPT = Path("/root/pero-cash-staging-backup-" + BACKUP_SHA + ".py")
BACKUP_ROOT = Path("/var/lib/pero-cash-qa")
BACKUP_RUN_ID = "667367d7-83e5-40f1-b06b-b57889170685"
RECEIPT_SHA = "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e"
REVISION = "3f6da0da082cc707370346c9c3a458ba24d1c189"
DATABASE_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a"


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def load_module(path, name, digest):
    require(path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == digest,
            "FROZEN_HELPER_MISMATCH")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def delta(before, after):
    protected = sorted(name for name in before["tables"] if before["tables"][name] != after["tables"].get(name))
    full = sorted(name for name in before["full"] if before["full"][name] != after["full"].get(name))
    columns = {}
    for table in sorted(set(before["columns"]) | set(after["columns"])):
        old = {column["name"]: column for column in before["columns"].get(table, [])}
        new = {column["name"]: column for column in after["columns"].get(table, [])}
        changed = sorted(name for name in set(old) | set(new) if old.get(name) != new.get(name))
        if changed:
            columns[table] = changed
    return {"protectedTables": protected, "fullHashTables": full, "changedColumns": columns,
            "protectedTableCounts": {name: {"before": before["tables"][name]["count"],
                                             "after": after["tables"][name]["count"]} for name in protected},
            "protectedTableHashes": {name: after["tables"][name]["hash"] for name in protected},
            "fullTableHashes": {name: after["full"][name]["hash"] for name in full}}


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    require(Path(__file__).name == "cash-staging-diagnostics-" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest() + ".py",
            "SCRIPT_HASH_NAME_MISMATCH")
    support = load_module(SUPPORT, "accepted_stage_support", SUPPORT_SHA)
    backup = load_module(BACKUP_SCRIPT, "accepted_cash_backup", BACKUP_SHA)
    # Match the frozen backup helper's load_support() pin exactly; Snapshot
    # refuses diagnostic directories outside this reviewed private root.
    support.BACKUPS = BACKUP_ROOT
    backup.BACKUP_ROOT = BACKUP_ROOT
    folder = BACKUP_ROOT / BACKUP_RUN_ID
    require(folder.parent == support.BACKUPS, "PSQL_DIAGNOSTIC_DIRECTORY_INVALID")
    support.directory(BACKUP_ROOT, exact_mode=0o700)
    support.directory(folder, exact_mode=0o700)
    receipt_raw = support.read_private(folder / "receipt.json")
    require(support.sha(receipt_raw) == RECEIPT_SHA and
            support.read_private(folder / "receipt.sha256").decode().strip() == RECEIPT_SHA, "RECEIPT_SEAL_MISMATCH")
    receipt = json.loads(receipt_raw)
    require(receipt.get("migration") == backup.MIGRATION and receipt.get("sqlSha256") == backup.SQL_SHA and
            receipt.get("identity", {}).get("revision") == backup.OLD_REVISION, "RECEIPT_TARGET_MISMATCH")
    diagnostic = folder / ("diagnostic-" + REVISION + ".json")
    require(not diagnostic.exists() and not diagnostic.is_symlink(), "DIAGNOSTIC_ALREADY_EXISTS")
    with os.fdopen(support.protected_open(support.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        import fcntl
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("REFRESH_OR_DEPLOY_BUSY") from None
        support.require_refresh_idle()
        identity, password = support.identity(REVISION)
        backup.verify_backup_identity(receipt["identity"], identity)
        require(identity.get("hostname") == "crm-staging" and identity.get("database") == DATABASE_ID and
                identity.get("revision") == REVISION, "STAGING_TARGET_MISMATCH")
        with support.Snapshot(password, identity, folder, "verify-" + str(uuid.uuid4())) as snapshot:
            state = backup.snapshot_state(snapshot)
        changes = delta(receipt["state"], state)
        prior = receipt["state"]["migrations"]
        current = state["migrations"]
        old_rows_preserved = [row for row in current if row["migration_name"] != backup.MIGRATION] == prior
        applied = [row for row in current if row["migration_name"] == backup.MIGRATION]
        changes["ledger"] = {"priorEntryCount": len(prior), "currentEntryCount": len(current),
                              "oldEntriesPreserved": old_rows_preserved, "cashMigrationEntryCount": len(applied),
                              "cashMigrationChecksumMatches": len(applied) == 1 and applied[0]["checksum"] == backup.SQL_SHA,
                              "cashMigrationFinished": len(applied) == 1 and bool(applied[0]["finished_at"])
                              and not applied[0]["rolled_back_at"]}
        summary = {"status": "READONLY_DIAGNOSTIC", "revision": REVISION, "protectedTableCount": len(state["tables"])-1,
                   "changes": changes, "snapshotSha256": support.write_exclusive(diagnostic, state)}
        support.require_refresh_idle()
        require(support.identity(REVISION)[0] == identity, "STAGING_DEPLOYMENT_CHANGED")
    print(json.dumps(summary, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        value = str(error)
        code = value if value.isascii() and value.replace("_", "").isalnum() and value.isupper() else "DIAGNOSTIC_STOP"
        print(json.dumps({"status": "STOP", "code": code}))
        raise SystemExit(1)
