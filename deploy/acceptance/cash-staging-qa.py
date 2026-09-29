"""Guest-only W07-gated cash QA bundle transport. No deploy, migration, reset or inline SSH."""
import base64
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

SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790"
SUPPORT = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
STATE = Path("/var/lib/pero-cash-qa")
MIGRATION = "20260929120000_manager_cash_advances"
SQL_SHA = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd"
OLD_REVISION = "8ed48388a8df06c10b58d3e2b6d7a4cf72a29f66"
EXPECTED_REVISION = "3f6da0da082cc707370346c9c3a458ba24d1c189"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
OPS = {"refs", "plan", "prepare", "capture", "verify", "observe", "cleanup", "abort-cleanup", "sessions"}
MUTATIONS = {"prepare", "cleanup", "abort-cleanup"}
STABLE = ("hostname", "database", "databaseStartedAt", "databaseVolume", "pgdata", "outerW07Sha256")


class Stop(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stop(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def support_module():
    require(SUPPORT.is_file() and not SUPPORT.is_symlink() and sha(SUPPORT.read_bytes()) == SUPPORT_SHA,
            "REVIEWED_SUPPORT_MISMATCH")
    spec = importlib.util.spec_from_file_location("reviewed_cash_support", SUPPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def seal_guard(seal):
    require(isinstance(seal, dict) and set(seal) == {"format", "sealedBy", "expectedRevision", "wrapperSha256",
            "bundleSha256", "entrySha256", "runnerSha256", "windowSha256", "supportSha256", "backupReceiptSha256", "backupRunId"},
            "STAGE_SEAL_FIELDS_INVALID")
    require(seal["format"] == "pero-cash-stage-seal/v1" and seal["sealedBy"] == "root" and
            seal["expectedRevision"] == EXPECTED_REVISION and
            all(HASH.fullmatch(seal[key]) for key in ("wrapperSha256", "bundleSha256", "entrySha256",
                                                   "runnerSha256", "windowSha256", "supportSha256", "backupReceiptSha256")) and
            UUID.fullmatch(seal["backupRunId"]) and seal["supportSha256"] == SUPPORT_SHA and
            sha(Path(__file__).read_bytes()) == seal["wrapperSha256"], "STAGE_SEAL_INVALID")
    return seal


def backup_guard(old, seal, identity, password):
    folder = STATE / seal["backupRunId"]
    old.directory(folder, exact_mode=0o700)
    raw = old.read_private(folder / "receipt.json")
    require(sha(raw) == seal["backupReceiptSha256"] and
            old.read_private(folder / "receipt.sha256").decode().strip() == seal["backupReceiptSha256"],
            "BACKUP_RECEIPT_DRIFT")
    receipt = json.loads(raw)
    require(receipt.get("migration") == MIGRATION and receipt.get("sqlSha256") == SQL_SHA and
            receipt.get("identity", {}).get("revision") == OLD_REVISION and
            all(receipt["identity"].get(key) == identity.get(key) for key in STABLE), "BACKUP_TARGET_DRIFT")
    verified_file = folder / ("verified-" + seal["expectedRevision"] + ".json")
    verified = json.loads(old.read_private(verified_file))
    summary = verified.get("summary", {})
    require(summary.get("status") == "MIGRATION_AND_PRESERVATION_PASS" and
            summary.get("revision") == seal["expectedRevision"] and
            summary.get("runId") == seal["backupRunId"], "STAGING_MIGRATION_PRESERVATION_MISSING")
    old.check_archive(folder, password, receipt["state"]["tables"], receipt["backup"])
    archive = folder / "stage-before.dump"
    args, env = old.pg_command(["pg_restore", "--file=-"], password, seconds=120, interactive=True)
    with os.fdopen(old.protected_open(archive, os.O_RDONLY), "rb") as source:
        result = subprocess.run(args, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                env=env, check=False)
    require(result.returncode == 0 and 0 < len(result.stdout) <= 64 * 1024 * 1024, "BACKUP_FULL_READ_FAILED")
    return {"verified": True, "targetKind": "EXISTING_STAGING", "database": "crm",
            "archiveSha256": receipt["backup"]["sha256"], "tocSha256": receipt["backup"]["tocSha256"],
            "fullReadSha256": sha(result.stdout)}


def binding_guard(packet):
    operation, run_id, request = packet["operation"], packet["runId"], packet["input"]
    require(isinstance(request, dict) and request.get("operation") == operation and
            request.get("target") == "staging", "STAGE_REQUEST_BINDING_INVALID")
    if operation in ("refs", "plan"):
        require(run_id is None, "STAGE_RUN_BINDING_INVALID")
    else:
        require(run_id == "8d7055e1-560a-4c0d-969a-b2f6193deaa2" and
                request.get("plan", {}).get("runId") == run_id, "STAGE_RUN_BINDING_INVALID")
    return run_id


def persist_intent(old, run_id, operation, attempt_id, packet_sha):
    if not STATE.exists():
        STATE.mkdir(mode=0o700)
    old.directory(STATE, exact_mode=0o700)
    folder = STATE / run_id
    if not folder.exists():
        folder.mkdir(mode=0o700)
    old.directory(folder, exact_mode=0o700)
    require(not (folder / (operation + "-intent.json")).exists() and
            not (folder / (operation + "-result.json")).exists(), "REMOTE_MUTATION_ALREADY_ATTEMPTED")
    old.write_exclusive(folder / (operation + "-intent.json"), {"runId": run_id, "operation": operation,
                          "attemptId": attempt_id, "packetSha256": packet_sha, "at": old.now()})
    return folder


def execute(old, packet, identity, backup):
    request = {**packet["input"], "backup": backup}
    encoded = base64.b64encode(old.canonical(request)).decode("ascii")
    require(len(encoded) <= 131072, "STAGE_INPUT_TOO_LARGE")
    environment = {**old.SAFE_ENV, "CRM_CASH_QA_INPUT": encoded}
    command = old.DOCKER + ["exec", "-i", "-w", "/app/apps/web", "--env", "CRM_CASH_QA_INPUT",
                            identity["web"], "timeout", "-s", "KILL", "150", "node", "--input-type=module"]
    raw = base64.b64decode(packet["bundle"], validate=True)
    # No outer timeout: cancelling the docker client could leave a live mutation.
    result = subprocess.run(command, input=raw, capture_output=True, env=environment, check=False)
    require(len(result.stdout) <= 1024 * 1024 and len(result.stderr) <= 128 * 1024,
            "STAGE_OUTPUT_TOO_LARGE_INSPECT_OUTCOME")
    try:
        body = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise Stop("STAGE_JSON_REQUIRED_INSPECT_OUTCOME") from None
    require(isinstance(body, dict) and set(body) == {"publicSummary", "privatePayload"},
            "STAGE_RESPONSE_INVALID_INSPECT_OUTCOME")
    require(result.returncode == 0 and body["publicSummary"].get("status") == "PASS",
            body["publicSummary"].get("code", "STAGE_PROCESS_FAILED_INSPECT_OUTCOME"))
    require(body["publicSummary"].get("operation") == packet["operation"], "STAGE_OPERATION_RESPONSE_MISMATCH")
    return body


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    os.umask(0o077)
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, "STAGE_PACKET_TOO_LARGE")
    packet = json.loads(raw)
    require(isinstance(packet, dict) and set(packet) == {"seal", "operation", "attemptId", "runId", "input", "bundle"},
            "STAGE_PACKET_FIELDS_INVALID")
    seal = seal_guard(packet["seal"])
    require(packet["operation"] in OPS and UUID.fullmatch(packet["attemptId"]), "STAGE_OPERATION_FORBIDDEN")
    run_id = binding_guard(packet)
    bundle = base64.b64decode(packet["bundle"], validate=True)
    require(0 < len(bundle) <= 768 * 1024 and sha(bundle) == seal["bundleSha256"], "STAGE_BUNDLE_MISMATCH")
    old = support_module()
    old.directory(old.REFRESH)
    with os.fdopen(old.protected_open(old.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop("REFRESH_OR_DEPLOY_BUSY") from None
        old.require_refresh_idle()
        before, password = old.identity(seal["expectedRevision"])
        backup = backup_guard(old, seal, before, password)
        folder = persist_intent(old, run_id, packet["operation"], packet["attemptId"], sha(raw)) if packet["operation"] in MUTATIONS else None
        result = execute(old, packet, before, backup)
        old.require_refresh_idle()
        after, _ = old.identity(seal["expectedRevision"])
        require(after == before, "STAGING_DEPLOYMENT_CHANGED_INSPECT_OUTCOME")
        if folder is not None:
            old.write_exclusive(folder / (packet["operation"] + "-result.json"),
                                {"publicSummary": result["publicSummary"], "at": old.now()})
        print(json.dumps({"identity": before, "operation": packet["operation"], "attemptId": packet["attemptId"],
                          "result": result}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Stop as error:
        value = str(error)
        print(json.dumps({"publicSummary": {"status": "STOP", "code": value if re.fullmatch(r"[A-Z][A-Z0-9_]{2,100}", value)
                                                      else "STAGE_STOP_INSPECT_OUTCOME"}, "privatePayload": None}))
        sys.exit(2)
    except Exception:
        print(json.dumps({"publicSummary": {"status": "STOP", "code": "STAGE_WRAPPER_FAILED_INSPECT_OUTCOME"},
                          "privatePayload": None}))
        sys.exit(2)
