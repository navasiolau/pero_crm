"""Guest-only, W07-held read-only proof for one archived/fresh OrgSetting row.

SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md.
This uses pg_restore only to READ a custom archive's COPY stream. It never
restores into PostgreSQL, changes the backup guard, or prints OrgSetting.value.
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
BACKUP_SHA = "d54c7697d7f77d5b79faf75d73247ff950269d5cb3a7890b7d3a1cd18abbbec2"
SUPPORT = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
BACKUP = Path("/root/pero-cash-staging-backup-" + BACKUP_SHA + ".py")
ROOT = Path("/var/lib/pero-cash-qa")
RUN_ID = "667367d7-83e5-40f1-b06b-b57889170685"
RECEIPT_SHA = "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e"
ARCHIVE_SHA = "a13745d410579ade5bb2035183fdb502de28e69162a2e5cb0cfa0323cb87c3c8"
DIAGNOSTIC_SHA = "c28b355cffb86ba35941d913b700e8e59c62b43a2e0099de2a83cb30674d40d5"
REVISION = "3f6da0da082cc707370346c9c3a458ba24d1c189"
DATABASE_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a"
COPY_HEADER = re.compile(rb'^COPY public\."OrgSetting" \((?:key|"key"), (?:value|"value"), "updatedAt"\) FROM stdin;$')
SAFE_KEY = re.compile(r"[A-Za-z0-9._:-]{1,100}\Z")


class Stop(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stop(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_pinned(path, name, digest):
    require(path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == digest,
            "FROZEN_HELPER_MISMATCH")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def decode_copy_field(raw):
    """Decode only documented PostgreSQL text COPY escapes, rejecting ambiguity."""
    require(isinstance(raw, bytes) and len(raw) <= 65536, "COPY_FIELD_INVALID")
    if raw == b"\\N":
        return None
    value = bytearray()
    escapes = {ord("b"): 8, ord("f"): 12, ord("n"): 10, ord("r"): 13,
               ord("t"): 9, ord("v"): 11, ord("\\"): 92}
    i = 0
    while i < len(raw):
        char = raw[i]
        require(char not in (0, 9, 10, 13), "COPY_RAW_CONTROL_INVALID")
        if char != 92:
            value.append(char)
            i += 1
            continue
        require(i + 1 < len(raw), "COPY_ESCAPE_TRUNCATED")
        kind = raw[i + 1]
        if kind in escapes:
            value.append(escapes[kind]); i += 2
        elif kind == ord("x"):
            require(i + 3 < len(raw) and re.fullmatch(rb"[0-9A-Fa-f]{2}", raw[i+2:i+4]),
                    "COPY_HEX_ESCAPE_INVALID")
            value.append(int(raw[i+2:i+4], 16)); i += 4
        elif ord("0") <= kind <= ord("7"):
            j = i + 1
            while j < min(i + 4, len(raw)) and ord("0") <= raw[j] <= ord("7"):
                j += 1
            octet = int(raw[i+1:j], 8)
            require(octet <= 255, "COPY_OCTAL_ESCAPE_INVALID")
            value.append(octet); i = j
        else:
            raise Stop("COPY_ESCAPE_UNKNOWN")
    try:
        return value.decode("utf-8", errors="strict")
    except UnicodeError:
        raise Stop("COPY_UTF8_INVALID") from None


def parse_orgsetting_copy(data):
    """Return exactly one key/value/timestamp from pg_restore's COPY block."""
    require(isinstance(data, bytes) and 0 < len(data) <= 65536 and data.endswith(b"\n") and b"\r" not in data,
            "COPY_STREAM_INVALID")
    lines = data.split(b"\n")
    headers = [i for i, line in enumerate(lines) if line.startswith(b"COPY ")]
    require(len(headers) == 1 and COPY_HEADER.fullmatch(lines[headers[0]]), "COPY_HEADER_INVALID")
    at = headers[0]
    require(at + 2 < len(lines) and lines[at + 2] == b"\\." and
            not any(line.startswith((b"COPY ", b"INSERT INTO ")) for line in lines[at+3:]),
            "COPY_ROW_COUNT_INVALID")
    fields = lines[at + 1].split(b"\t")
    require(len(fields) == 3, "COPY_COLUMN_COUNT_INVALID")
    key, value, updated_at = [decode_copy_field(field) for field in fields]
    require(key is not None and value is not None and updated_at is not None and SAFE_KEY.fullmatch(key) and
            len(updated_at) <= 80, "COPY_ROW_INVALID")
    return {"key": key, "value": value, "updatedAt": updated_at}


def archived_row(support, folder, password):
    archive = folder / "stage-before.dump"
    require(archive.is_file() and not archive.is_symlink() and
            support.hash_private(archive)["sha256"] == ARCHIVE_SHA,
            "BACKUP_ARCHIVE_MISMATCH")
    args, env = support.pg_command(["pg_restore", "--data-only", "--schema=public", "--table=OrgSetting",
                                    "--file=-"], password, seconds=120, interactive=True)
    with os.fdopen(support.protected_open(archive, os.O_RDONLY), "rb") as source:
        result = subprocess.run(args, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                env=env, check=False)
    require(result.returncode == 0 and 0 < len(result.stdout) <= 65536, "BACKUP_COPY_READ_FAILED")
    return parse_orgsetting_copy(result.stdout)


def preservation(before, after, diagnostic, backup):
    backup.validate_prior_state(before)
    backup.validate_column_extension(before["columns"], after["columns"])
    require(set(before["tables"]) == set(after["tables"]) and
            set(before["tables"]) == set(diagnostic["tables"]), "TABLE_SET_DRIFT")
    other = [table for table in before["tables"] if table not in ("_prisma_migrations", "OrgSetting")]
    require(len(other) == 37 and all(before["tables"][table] == after["tables"][table] ==
                                     diagnostic["tables"][table] for table in other), "OTHER_BUSINESS_DRIFT")
    require(before["tables"]["OrgSetting"]["count"] == after["tables"]["OrgSetting"]["count"] == "1",
            "ORGSETTING_COUNT_DRIFT")
    require(before["tables"]["OrgSetting"] != diagnostic["tables"]["OrgSetting"] and
            before["tables"]["OrgSetting"] != after["tables"]["OrgSetting"] and
            diagnostic["tables"]["OrgSetting"]["count"] == "1",
            "ORGSETTING_PROTECTED_DRIFT_NOT_REPRODUCED")
    full_drift = {table for table in before["full"] if before["full"][table] != after["full"].get(table)}
    require(full_drift <= {"Payout", "_prisma_migrations", "ApiToken", "Plugin", "OrgSetting"},
            "UNEXPECTED_FULL_HASH_DRIFT")
    fields = after["payoutCashFields"]
    require(fields and fields["rowCount"] == before["tables"]["Payout"]["count"] and
            set(fields["nonNullCounts"]) == set(backup.PAYOUT_ADDITION_NAMES) and
            all(str(value) == "0" for value in fields["nonNullCounts"].values()),
            "PAYOUT_LEGACY_FIELDS_DRIFT")
    prior, current = before["migrations"], after["migrations"]
    added = [row for row in current if row["migration_name"] == backup.MIGRATION]
    require([row for row in current if row["migration_name"] != backup.MIGRATION] == prior and
            len(added) == 1 and added[0]["checksum"] == backup.SQL_SHA and added[0]["finished_at"] and
            not added[0]["rolled_back_at"], "MIGRATION_LEDGER_DRIFT")
    require(after["columns"] == diagnostic["columns"] and after["migrations"] == diagnostic["migrations"] and
            after["payoutCashFields"] == diagnostic["payoutCashFields"],
            "DIAGNOSTIC_SCHEMA_OR_LEDGER_DRIFT")
    return {"otherBusinessTablesPreserved": len(other), "onlyOrgSettingProtectedDrift": True,
            "newPayoutFieldsNull": True, "oldLedgerPreserved": True, "migrationChecksumMatched": True,
            "onlyNinePayoutColumnsAdded": True, "unexpectedFullHashTables": []}


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0,
            "STAGING_ROOT_REQUIRED")
    require(Path(__file__).name == "cash-staging-orgsetting-proof-" + sha(Path(__file__).read_bytes()) + ".py",
            "SCRIPT_HASH_NAME_MISMATCH")
    support = load_pinned(SUPPORT, "accepted_stage_support", SUPPORT_SHA)
    backup = load_pinned(BACKUP, "accepted_cash_backup", BACKUP_SHA)
    support.BACKUPS = ROOT
    backup.BACKUP_ROOT = ROOT
    folder = ROOT / RUN_ID
    require(folder.parent == support.BACKUPS, "BACKUP_DIRECTORY_INVALID")
    support.directory(ROOT, exact_mode=0o700)
    support.directory(folder, exact_mode=0o700)
    receipt_raw = support.read_private(folder / "receipt.json")
    require(sha(receipt_raw) == RECEIPT_SHA and
            support.read_private(folder / "receipt.sha256").decode().strip() == RECEIPT_SHA,
            "BACKUP_RECEIPT_MISMATCH")
    receipt = json.loads(receipt_raw)
    require(receipt.get("migration") == backup.MIGRATION and receipt.get("sqlSha256") == backup.SQL_SHA,
            "BACKUP_RECEIPT_TARGET_MISMATCH")
    require(receipt.get("backup", {}).get("sha256") == ARCHIVE_SHA, "BACKUP_ARCHIVE_MISMATCH")
    diagnostic_raw = support.read_private(folder / ("diagnostic-" + REVISION + ".json"))
    require(sha(diagnostic_raw) == DIAGNOSTIC_SHA, "DIAGNOSTIC_RECEIPT_MISMATCH")
    diagnostic = json.loads(diagnostic_raw)
    proof_file = folder / ("orgsetting-proof-" + REVISION + ".json")
    require(not proof_file.exists() and not proof_file.is_symlink(), "ORGSETTING_PROOF_ALREADY_EXISTS")
    with os.fdopen(support.protected_open(support.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        import fcntl
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop("REFRESH_OR_DEPLOY_BUSY") from None
        support.require_refresh_idle()
        identity, password = support.identity(REVISION)
        backup.verify_backup_identity(receipt["identity"], identity)
        require(identity.get("hostname") == "crm-staging" and identity.get("database") == DATABASE_ID and
                identity.get("revision") == REVISION, "STAGING_TARGET_MISMATCH")
        archived = archived_row(support, folder, password)
        with support.Snapshot(password, identity, folder, "verify-" + str(uuid.uuid4())) as snapshot:
            current = snapshot.query("SELECT COALESCE(json_agg(json_build_object('key',key,'value',value,"
                                     "'updatedAt',\"updatedAt\"::text) ORDER BY key),'[]') "
                                     "FROM public.\"OrgSetting\"")
            state = backup.snapshot_state(snapshot)
        require(isinstance(current, list) and len(current) == 1 and isinstance(current[0], dict),
                "ORGSETTING_CURRENT_ROW_INVALID")
        live = current[0]
        require(SAFE_KEY.fullmatch(live.get("key", "")) and isinstance(live.get("value"), str) and
                isinstance(live.get("updatedAt"), str), "ORGSETTING_CURRENT_ROW_INVALID")
        checks = preservation(receipt["state"], state, diagnostic, backup)
        changed = [name for name in ("key", "value", "updatedAt") if archived[name] != live[name]]
        summary = {"status": "ORGSETTING_METADATA_ONLY_PROVEN" if changed == ["updatedAt"] else "ORGSETTING_CONTENT_DRIFT",
                   "revision": REVISION, "archivedKey": archived["key"], "currentKey": live["key"],
                   "valueEqual": archived["value"] == live["value"], "changedFields": changed,
                   "archivedUpdatedAt": archived["updatedAt"], "currentUpdatedAt": live["updatedAt"],
                   "backupReceiptSha256": RECEIPT_SHA, "diagnosticSha256": DIAGNOSTIC_SHA,
                   **checks}
        proof_sha = support.write_exclusive(proof_file, summary)
        support.require_refresh_idle()
        require(support.identity(REVISION)[0] == identity, "STAGING_DEPLOYMENT_CHANGED")
    print(json.dumps({**summary, "proofSha256": proof_sha}, separators=(",", ":")))
    if summary["status"] != "ORGSETTING_METADATA_ONLY_PROVEN":
        raise SystemExit(2)


if __name__ == "__main__":
    try:
        main()
    except Stop as error:
        print(json.dumps({"status": "STOP", "code": str(error)}))
        sys.exit(1)
    except Exception as error:
        code = str(error)
        safe = code if code.isascii() and code.replace("_", "").isalnum() and code.isupper() else "ORGSETTING_PROOF_STOP"
        print(json.dumps({"status": "STOP", "code": safe}))
        sys.exit(1)
