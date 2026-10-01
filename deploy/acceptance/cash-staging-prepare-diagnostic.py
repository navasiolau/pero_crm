"""One-shot W07/read-only diagnosis of the first stage prepare refusal.

SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md.
No SQL writes, fixture adoption, migration, guard relaxation or retry.
Never outputs business row JSON, credentials, password hashes or token values.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
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
BACKUP_RUN = "667367d7-83e5-40f1-b06b-b57889170685"
QA_RUN = "0d4bc0e8-b3e1-46fa-809a-6e7051391e5c"
ATTEMPT = "ea1f1dfb-c975-4aee-9c61-34e1bb130828"
REVISION = "3f6da0da082cc707370346c9c3a458ba24d1c189"
DATABASE_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a"
RECEIPT_SHA = "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e"
VERIFIED_SHA = "53b639e4db92da0cd9808118cbc83199570c60169ea68b3bb526be85b22e8b11"
FIELD_PROOF_SHA = "7fde60470738ffa4d48379e3493d29b7c380b50c75f5698cf93419e001328228"
PLAN_SHA = "d8446009e6b6a516481cf77e5f94c788402b97933ba4797eff0d60c66a6b9309"
SQL_SHA = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd"
PAGE = 10
MAX_TABLE_BYTES = 64 * 1024 * 1024

# Exact raw to_jsonb(t)::text fingerprints from the root-reviewed stage plan.
BASELINE = {
    "ApiToken": "df662ff8c5b84c6d837a97d2709b302bf3d87cb64d63e84e9132438b52061ddc",
    "CashAccount": "924451accdbfd1a775a1a40fe525624c31377c17c57c9f21d92949c1c3b03e01",
    "ChangeLog": "7fc18d319d8b0e82431918af7e8b2ed57ee3a34e4fdfaa10f609a928653e8567",
    "Client": "c62c1bf7c3bc834eec1b1c617aafdf1466d14cd182ae51ce20eecc986d8054ac",
    "Communication": "69401528de4307e8ce4a7e0d9d26c12afd09e1557b8cc08f31c66bf96d43a32f",
    "DomainEvent": "0fa92426a2c9c8ba5b5f5f9c355f8bdecdfee70085f0e074ffdd617b44b8003c",
    "ExpenseArticle": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "File": "4c3a3c53b1ab4d7c0839891c4daf828a9b47c05122c3a7044be2403ecb6435b3",
    "Material": "ebb5a1596fde756f96151986c00f4249b0bf40aec7470f1634e38d56484b192c",
    "MaterialCategory": "add5f72cc2b126090ecf7467d4b6a02029a50b97e67714d11fada72f24fdd121",
    "Notification": "455891a37e24a223122ef4437e994195860037720f13d883e6259dae65e3629e",
    "NotificationPreference": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "OrgSetting": "4922eb0eb3ee476a13b0f14a285bbeb3e547931af50655e1f63976cffbc8d948",
    "Payment": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "Payout": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "PayrollEntry": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "Plugin": "288b398505d9a6273cc122a247e017cee9046d35f3c76fdaf6558eb29a8397dc",
    "PluginRunLog": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "PluginSetting": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "PriceItem": "d46c9aa2afa8901f81dee06a2ecea6bfbc79aed1bcd4b2abc64e56e6470585c7",
    "Product": "45cc9cb13cec8ffde94f8d02e1709f3c691498321c6590968fb1cb2a85e7368a",
    "ProductStagePayPool": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "ProductStageSettlement": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "ProductStageSettlementShare": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "ProductStatusHistory": "dbf906b1c14fcbdc761ab25f904b533c2b5744d1b13f15bd65898fb5848292c7",
    "Project": "4b984b55d5dc8ac8084f8a16a1f7c53c0301e879d2f0426e6f35d11d4b06a9d6",
    "ProjectMaterial": "d4772d392fe64acf631cc3fb8120019d7da4b349650330c21a13d93767130b7a",
    "ProjectStageHistory": "8c1502593edb4242a5c0feb39ae7a5411d4d51bdcc9b5b3da752acf3cb718636",
    "StockMovement": "07bad130c33a5c2b6cb432d0fcd9978410dc7c3754196e5b2a57ce1ae6bb3c26",
    "Task": "f66f65f0cbf5055f2480cda9d1964181875ecb4c58c5b0dd1ceeab396b6d6d5f",
    "TaskAllocationGroup": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "TaskDependency": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "TelegramLink": "beefa38a2badd2af5aef1301bc855a0f658f122f2b3ae1686787fb86326d4bf9",
    "TimeEntry": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    "User": "e064bda4022384cd23ac7b83a598658335551e58d44b405c565ae5cc7e2e6c84",
    "UserPreference": "87e667049770ba0a60fa585979020776a63c9ff8a9ec281a89ac0f2ee3188588",
    "Work": "465ddafcce8668dec881e5521dce6100020a57e1e6c3705d4a11fa9b70060703",
    "WorkPaymentConversion": "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
}

OWNED = {
    "Project": ["eac09ada-aecc-44be-b159-1cf7de2cf00e"],
    "User": ["f7f65efa-8c95-42da-b5d7-6f878b68affc", "722556c6-5784-4008-bfe0-ac0cfab5d777"],
    "CashAccount": ["994f8cb7-601c-48c3-8334-534ee859c0cf", "fc94ed3f-5fa6-4068-b291-6ab22b722be9"],
    "Payment": ["8fe27073-70a1-4e90-a3d8-23a92de81f2d", "79d01c1c-e1b0-4c81-a473-c1b10038a565"],
    "PayrollEntry": ["a44affe7-80ee-4e41-8320-6a2fdb46bb86"],
}
REQUESTS = ["70d35482-e2c9-4429-b352-f85bd351a82b", "e4f0897b-8b90-42a8-b929-b91062188cf5",
            "d4b34f62-5db9-47e0-96f2-b482a8407d02", "25d5e1ad-101c-405d-8f94-5dd6876c8c3b"]


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


def raw_fingerprint(snapshot, table, count):
    """Reproduce JS Array.sort() UTF-16 order in bounded read-only pages."""
    require(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", table) and isinstance(count, int) and count >= 0,
            "FINGERPRINT_TABLE_INVALID")
    rows = []
    total_bytes = 0
    for offset in range(0, count, PAGE):
        sql = ('SELECT COALESCE(json_agg(raw ORDER BY raw COLLATE "C"),\'[]\') FROM '
               '(SELECT to_jsonb(t)::text AS raw FROM public."' + table + '" t '
               'ORDER BY (to_jsonb(t)::text) COLLATE "C" LIMIT ' + str(PAGE) +
               ' OFFSET ' + str(offset) + ') q')
        chunk = snapshot.query(sql)
        require(isinstance(chunk, list) and 0 < len(chunk) <= PAGE and
                all(isinstance(item, str) for item in chunk), "FINGERPRINT_PAGE_INVALID")
        total_bytes += sum(len(item.encode("utf-8")) for item in chunk)
        require(total_bytes <= MAX_TABLE_BYTES, "FINGERPRINT_TABLE_TOO_LARGE")
        rows.extend(chunk)
    require(len(rows) == count, "FINGERPRINT_ROW_COUNT_DRIFT")
    rows.sort(key=lambda value: value.encode("utf-16-be", errors="surrogatepass"))
    return sha(("\n".join(rows) + "\n").encode("utf-8"))


def exact_absence(snapshot):
    counts = {}
    for table, ids in OWNED.items():
        quoted = ",".join("'" + value + "'" for value in ids)
        result = snapshot.query('SELECT json_build_object(\'count\',count(*)::text,\'ids\','
                                "COALESCE(json_agg(id ORDER BY id),'[]')) FROM public.\"" + table +
                                '\" WHERE id IN (' + quoted + ')')
        require(isinstance(result, dict) and isinstance(result.get("ids"), list), "OWNED_COUNT_INVALID")
        counts[table] = result
    receipt_ids = ",".join("'payout-issue:" + value + "'" for value in REQUESTS)
    receipts = snapshot.query("SELECT json_build_object('count',count(*)::text,'ids',"
                              "COALESCE(json_agg(id ORDER BY id),'[]')) FROM public.\"ChangeLog\" "
                              "WHERE id IN (" + receipt_ids + ")")
    payout_users = ",".join("'" + value + "'" for value in OWNED["User"])
    payouts = snapshot.query("SELECT json_build_object('count',count(*)::text) FROM public.\"Payout\" "
                             "WHERE \"userId\" IN (" + payout_users + ")")
    require(isinstance(receipts, dict) and isinstance(receipts.get("ids"), list) and
            isinstance(payouts, dict) and isinstance(payouts.get("count"), str), "OWNED_COUNT_INVALID")
    return {"fixtureRows": counts, "requestReceipts": receipts, "qaUserPayoutCount": payouts["count"],
            "allEightAbsent": sum(int(value["count"]) for value in counts.values()) == 0 and
            receipts["count"] == "0" and payouts["count"] == "0"}


def process_state(snapshot):
    return snapshot.query("SELECT json_build_object('advisoryGranted',"
        "(SELECT count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' AND classid=18435 "
        "AND objid=55001 AND objsubid=2 AND granted),"
        "'advisoryWaiting',(SELECT count(*)::text FROM pg_catalog.pg_locks WHERE locktype='advisory' "
        "AND classid=18435 AND objid=55001 AND objsubid=2 AND NOT granted),"
        "'otherActive',(SELECT count(*)::text FROM pg_catalog.pg_stat_activity WHERE datname='crm' "
        "AND pid<>pg_backend_pid() AND state IN ('active','idle in transaction'))) ")


def remote_intent(support):
    folder = ROOT / QA_RUN
    support.directory(folder, exact_mode=0o700)
    intent_path = folder / "prepare-intent.json"
    result_path = folder / "prepare-result.json"
    require(intent_path.exists() and not intent_path.is_symlink(), "REMOTE_PREPARE_INTENT_MISSING")
    intent = json.loads(support.read_private(intent_path))
    require(intent.get("runId") == QA_RUN and intent.get("operation") == "prepare" and
            intent.get("attemptId") == ATTEMPT, "REMOTE_PREPARE_INTENT_MISMATCH")
    result = json.loads(support.read_private(result_path)) if result_path.exists() else None
    return {"intentExists": True, "attemptId": intent["attemptId"],
            "packetSha256": intent.get("packetSha256"), "resultExists": result is not None,
            "resultPublicStatus": result.get("publicSummary", {}).get("status") if result else None}


def classify_drift(baseline, fingerprints, state, receipt, org_rows=None, archived=None):
    drift = {}
    for table in sorted(baseline):
        if fingerprints[table] == baseline[table]:
            continue
        protected_equal = state["tables"][table] == receipt["state"]["tables"][table]
        candidate = (["lastUsedAt"] if table == "ApiToken" else
                     ["updatedAt:demo,file-stages"] if table == "Plugin" else []) if protected_equal else []
        drift[table] = {"expectedSha256": baseline[table], "currentSha256": fingerprints[table],
                        "protectedMatchesBackup": protected_equal, "candidateOmittedFields": candidate}
    if "OrgSetting" in drift:
        require(isinstance(org_rows, list) and len(org_rows) == 1 and isinstance(archived, dict),
                "ORGSETTING_ROW_COUNT_DRIFT")
        live = org_rows[0]
        drift["OrgSetting"]["keyEqualToArchive"] = live.get("key") == archived["key"]
        drift["OrgSetting"]["valueEqualToArchive"] = live.get("value") == archived["value"]
        drift["OrgSetting"]["changedFieldsFromArchive"] = [name for name in ("key", "value", "updatedAt")
                                                           if live.get(name) != archived[name]]
    return drift


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    require(Path(__file__).name == "cash-staging-prepare-diagnostic-" + sha(Path(__file__).read_bytes()) + ".py",
            "SCRIPT_HASH_NAME_MISMATCH")
    support = load_pinned(SUPPORT, "accepted_stage_support", SUPPORT_SHA)
    backup = load_pinned(BACKUP, "accepted_cash_backup", BACKUP_SHA)
    frozen = load_pinned(FROZEN_PROOF, "executed_orgsetting_proof", FROZEN_PROOF_SHA)
    support.BACKUPS = ROOT
    backup.BACKUP_ROOT = ROOT
    folder = ROOT / BACKUP_RUN
    support.directory(ROOT, exact_mode=0o700)
    support.directory(folder, exact_mode=0o700)
    receipt_raw = support.read_private(folder / "receipt.json")
    verified_raw = support.read_private(folder / ("verified-" + REVISION + ".json"))
    require(sha(receipt_raw) == RECEIPT_SHA and sha(verified_raw) == VERIFIED_SHA,
            "BACKUP_OR_VERIFIED_RECEIPT_MISMATCH")
    receipt, verified = json.loads(receipt_raw), json.loads(verified_raw)
    require(receipt.get("sqlSha256") == SQL_SHA and
            verified.get("summary", {}).get("status") == "MIGRATION_AND_PRESERVATION_PASS" and
            verified["summary"].get("runId") == BACKUP_RUN and verified["summary"].get("revision") == REVISION and
            verified["summary"].get("metadataException", {}).get("fieldProofSha256") == FIELD_PROOF_SHA and
            set(BASELINE) == set(receipt["state"]["tables"]) - {"_prisma_migrations"} and len(BASELINE) == 38,
            "DIAGNOSTIC_INPUT_MISMATCH")
    output_file = ROOT / QA_RUN / ("prepare-diagnostic-" + ATTEMPT + ".json")
    require(not output_file.exists() and not output_file.is_symlink(), "PREPARE_DIAGNOSTIC_ALREADY_EXISTS")
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
        remote = remote_intent(support)
        with support.Snapshot(password, identity, ROOT / BACKUP_RUN, "verify-" + str(uuid.uuid4())) as snapshot:
            state = backup.snapshot_state(snapshot)
            backup.validate_column_extension(receipt["state"]["columns"], state["columns"])
            require(state["migrations"] == verified["state"]["migrations"], "MIGRATION_LEDGER_DRIFT")
            fingerprints = {table: raw_fingerprint(snapshot, table, int(state["tables"][table]["count"]))
                            for table in sorted(BASELINE)}
            absence = exact_absence(snapshot)
            sessions = process_state(snapshot)
            org_rows = snapshot.query("SELECT COALESCE(json_agg(json_build_object('key',key,'value',value,"
                                      "'updatedAt',\"updatedAt\"::text) ORDER BY key),'[]') "
                                      "FROM public.\"OrgSetting\"")
        archived = None
        if fingerprints["OrgSetting"] != BASELINE["OrgSetting"]:
            archived = frozen.archived_row(support, ROOT / BACKUP_RUN, password)
        drift = classify_drift(BASELINE, fingerprints, state, receipt, org_rows, archived)
        summary = {"status": "READONLY_PREPARE_DIAGNOSTIC", "runId": QA_RUN, "attemptId": ATTEMPT,
                   "planSha256": PLAN_SHA, "driftTables": drift, "owned": absence, "processState": sessions,
                   "remoteAttempt": remote, "schemaOnlyNinePayoutColumnsAdded": True,
                   "migrationLedgerMatchedVerified": True}
        proof_sha = support.write_exclusive(output_file, summary)
        support.require_refresh_idle()
        require(support.identity(REVISION)[0] == identity, "STAGING_DEPLOYMENT_CHANGED")
    print(json.dumps({"status": summary["status"], "runId": QA_RUN, "attemptId": ATTEMPT,
                      "driftTables": drift, "owned": absence, "processState": sessions,
                      "remoteAttempt": remote, "proofSha256": proof_sha}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Stop as error:
        print(json.dumps({"status": "STOP", "code": str(error)}))
        sys.exit(1)
    except Exception as error:
        code = str(error)
        safe = code if code.isascii() and code.replace("_", "").isalnum() and code.isupper() else "PREPARE_DIAGNOSTIC_STOP"
        print(json.dumps({"status": "STOP", "code": safe}))
        sys.exit(1)
