"""One-shot W07/read-only verifier for the executed OrgSetting timestamp proof.

SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md.
The frozen executed proof module reads the archive's COPY stream; this file
only binds that witness to a fresh read-only snapshot and writes a new receipt.
No database restore, old-guard edit, or plaintext OrgSetting.value output.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import uuid

SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790"
BACKUP_SHA = "d54c7697d7f77d5b79faf75d73247ff950269d5cb3a7890b7d3a1cd18abbbec2"
FROZEN_PROOF_SHA = "f66772bf1308ea92735dbcdf8619a6dbbbca27738eee70a7b42fcf6d0d5bbef8"
SUPPORT = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
BACKUP = Path("/root/pero-cash-staging-backup-" + BACKUP_SHA + ".py")
FROZEN_PROOF = Path("/root/cash-staging-orgsetting-proof-" + FROZEN_PROOF_SHA + ".py")
ROOT = Path("/var/lib/pero-cash-qa")
RUN_ID = "667367d7-83e5-40f1-b06b-b57889170685"
RECEIPT_SHA = "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e"
ARCHIVE_SHA = "a13745d410579ade5bb2035183fdb502de28e69162a2e5cb0cfa0323cb87c3c8"
DIAGNOSTIC_SHA = "c28b355cffb86ba35941d913b700e8e59c62b43a2e0099de2a83cb30674d40d5"
FIELD_PROOF_SHA = "7fde60470738ffa4d48379e3493d29b7c380b50c75f5698cf93419e001328228"
REVISION = "3f6da0da082cc707370346c9c3a458ba24d1c189"
DATABASE_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a"
KEY = "telegram.botUsername"


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


def validate_exception(archived, live_rows, proof, before, fresh, diagnostic, frozen, backup):
    """Only the witnessed six-hour updatedAt change may supplement strict preservation."""
    require(isinstance(live_rows, list) and len(live_rows) == 1 and isinstance(live_rows[0], dict),
            "ORGSETTING_CURRENT_ROW_INVALID")
    live = live_rows[0]
    require(isinstance(proof, dict) and proof.get("status") == "ORGSETTING_METADATA_ONLY_PROVEN" and
            proof.get("revision") == REVISION and proof.get("archivedKey") == KEY and
            proof.get("currentKey") == KEY and proof.get("valueEqual") is True and
            proof.get("changedFields") == ["updatedAt"] and
            proof.get("backupReceiptSha256") == RECEIPT_SHA and
            proof.get("diagnosticSha256") == DIAGNOSTIC_SHA and
            proof.get("otherBusinessTablesPreserved") == 37 and
            proof.get("onlyOrgSettingProtectedDrift") is True and
            proof.get("newPayoutFieldsNull") is True and proof.get("oldLedgerPreserved") is True and
            proof.get("migrationChecksumMatched") is True and proof.get("onlyNinePayoutColumnsAdded") is True and
            proof.get("unexpectedFullHashTables") == [], "PINNED_FIELD_PROOF_INVALID")
    require(isinstance(archived, dict) and isinstance(live, dict) and archived.get("key") == live.get("key") == KEY and
            isinstance(archived.get("value"), str) and archived["value"] == live.get("value") and
            archived.get("updatedAt") == proof.get("archivedUpdatedAt") and
            live.get("updatedAt") == proof.get("currentUpdatedAt") and
            isinstance(live.get("updatedAt"), str) and
            archived["updatedAt"] != live["updatedAt"], "ORGSETTING_VALUE_OR_TIMESTAMP_DRIFT")
    checks = frozen.preservation(before, fresh, diagnostic, backup)
    require(checks.get("otherBusinessTablesPreserved") == 37 and
            checks.get("newPayoutFieldsNull") is True and checks.get("oldLedgerPreserved") is True and
            checks.get("migrationChecksumMatched") is True and checks.get("onlyNinePayoutColumnsAdded") is True and
            checks.get("unexpectedFullHashTables") == [], "FROZEN_PRESERVATION_PROOF_INVALID")
    return checks


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    require(Path(__file__).name == "cash-staging-metadata-verify-" + sha(Path(__file__).read_bytes()) + ".py",
            "SCRIPT_HASH_NAME_MISMATCH")
    support = load_pinned(SUPPORT, "accepted_stage_support", SUPPORT_SHA)
    backup = load_pinned(BACKUP, "accepted_cash_backup", BACKUP_SHA)
    frozen = load_pinned(FROZEN_PROOF, "executed_orgsetting_proof", FROZEN_PROOF_SHA)
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
    require(receipt.get("migration") == backup.MIGRATION and receipt.get("sqlSha256") == backup.SQL_SHA and
            receipt.get("identity", {}).get("revision") == backup.OLD_REVISION and
            receipt.get("backup", {}).get("sha256") == ARCHIVE_SHA, "BACKUP_RECEIPT_TARGET_MISMATCH")
    diagnostic_raw = support.read_private(folder / ("diagnostic-" + REVISION + ".json"))
    field_raw = support.read_private(folder / ("orgsetting-proof-" + REVISION + ".json"))
    require(sha(diagnostic_raw) == DIAGNOSTIC_SHA and sha(field_raw) == FIELD_PROOF_SHA,
            "FIELD_OR_DIAGNOSTIC_PROOF_MISMATCH")
    diagnostic, field_proof = json.loads(diagnostic_raw), json.loads(field_raw)
    verified_file = folder / ("verified-" + REVISION + ".json")
    require(not verified_file.exists() and not verified_file.is_symlink(), "VERIFIED_RECEIPT_ALREADY_EXISTS")
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
        archived = frozen.archived_row(support, folder, password)
        with support.Snapshot(password, identity, folder, "verify-" + str(uuid.uuid4())) as snapshot:
            rows = snapshot.query("SELECT COALESCE(json_agg(json_build_object('key',key,'value',value,"
                                  "'updatedAt',\"updatedAt\"::text) ORDER BY key),'[]') "
                                  "FROM public.\"OrgSetting\"")
            state = backup.snapshot_state(snapshot)
        checks = validate_exception(archived, rows, field_proof, receipt["state"], state, diagnostic,
                                    frozen, backup)
        summary = {"status": "MIGRATION_AND_PRESERVATION_PASS", "runId": RUN_ID, "revision": REVISION,
                   "businessTablesPreserved": 38, "metadataException": {"table": "OrgSetting", "key": KEY,
                       "field": "updatedAt", "valueEqual": True, "fieldProofSha256": FIELD_PROOF_SHA,
                       "archivedUpdatedAt": archived["updatedAt"], "currentUpdatedAt": rows[0]["updatedAt"]},
                   "restoreTest": False, **checks}
        verified_sha = support.write_exclusive(verified_file, {"summary": summary, "state": state})
        support.require_refresh_idle()
        require(support.identity(REVISION)[0] == identity, "STAGING_DEPLOYMENT_CHANGED")
    print(json.dumps({"status": summary["status"], "runId": RUN_ID, "revision": REVISION,
                      "metadataException": summary["metadataException"], "verifiedSha256": verified_sha,
                      "otherBusinessTablesPreserved": 37, "newPayoutFieldsNull": True,
                      "oldLedgerPreserved": True}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Stop as error:
        print(json.dumps({"status": "STOP", "code": str(error)}))
        sys.exit(1)
    except Exception as error:
        code = str(error)
        safe = code if code.isascii() and code.replace("_", "").isalnum() and code.isupper() else "METADATA_VERIFY_STOP"
        print(json.dumps({"status": "STOP", "code": safe}))
        sys.exit(1)
