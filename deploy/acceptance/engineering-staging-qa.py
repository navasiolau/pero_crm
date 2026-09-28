"""Opt-in transport for the EXISTING crm-staging containers. No import side effects.

SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md.
STOP on identity, W07, trigger, graph, or outcome uncertainty. Never retries writes.
"""
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
SUPPORT = Path(f"/root/pero-work-shares-{SUPPORT_SHA}.py")
STATE = Path("/var/lib/pero-engineering-qa")
MIGRATION = "20260928220000_product_engineering_pay"
SQL_SHA = "0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
OPS = {"refs", "plan", "prepare", "capture", "cleanup", "sessions"}
MUTATIONS = {"prepare", "cleanup"}


class Stop(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stop(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def support():
    require(SUPPORT.is_file() and not SUPPORT.is_symlink() and digest(SUPPORT.read_bytes()) == SUPPORT_SHA,
            "REVIEWED_SUPPORT_MISMATCH")
    spec = importlib.util.spec_from_file_location("reviewed_work_shares_support", SUPPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def seal_guard(packet):
    seal = packet.get("seal")
    require(isinstance(seal, dict) and set(seal) == {"format", "sealedBy", "expectedRevision", "wrapperSha256",
            "bundleSha256", "runnerSha256", "entrySha256", "helperSha256", "supportSha256", "backupReceiptSha256",
            "backupRunId"},
            "SEAL_FIELDS_INVALID")
    require(seal["format"] == "pero-engineering-stage-seal/v1" and seal["sealedBy"] == "root" and
            re.fullmatch(r"[0-9a-f]{40}", seal["expectedRevision"]), "ROOT_REVISION_SEAL_REQUIRED")
    require(all(SHA.fullmatch(seal[key]) for key in ("wrapperSha256", "bundleSha256", "runnerSha256",
            "entrySha256", "helperSha256", "supportSha256", "backupReceiptSha256")), "SEAL_HASH_INVALID")
    require(seal["supportSha256"] == SUPPORT_SHA and digest(Path(__file__).read_bytes()) == seal["wrapperSha256"],
            "REVIEWED_WRAPPER_MISMATCH")
    require(UUID.fullmatch(seal["backupRunId"]), "BACKUP_RUN_ID_INVALID")
    return seal


def backup_proof(old, seal):
    folder = STATE / seal["backupRunId"]
    old.directory(folder, exact_mode=0o700)
    raw = old.read_private(folder / "receipt.json")
    require(digest(raw) == seal["backupReceiptSha256"], "BACKUP_RECEIPT_MISMATCH")
    receipt = json.loads(raw)
    verified = json.loads(old.read_private(folder / ("verified-" + seal["expectedRevision"] + ".json")))
    summary = verified.get("summary", {})
    require(receipt.get("migration") == MIGRATION and receipt.get("sqlSha256") == SQL_SHA and
            summary.get("runId") == seal["backupRunId"] and summary.get("revision") == seal["expectedRevision"] and
            summary.get("status") == "MIGRATION_AND_PRESERVATION_PASS", "BACKUP_VERIFICATION_MISMATCH")


def binding_guard(packet):
    operation, run_id, request = packet["operation"], packet["runId"], packet["input"]
    require(isinstance(request, dict) and request.get("operation") == operation and
            request.get("target") == "staging", "QA_REQUEST_INVALID")
    if operation in ("refs", "plan"):
        require(run_id is None, "RUN_ID_BINDING_MISMATCH")
        return None
    source = request.get("plan") if operation in ("prepare", "sessions") else request.get("manifest")
    bound = source.get("runId") if isinstance(source, dict) else None
    require(isinstance(run_id, str) and UUID.fullmatch(run_id) and bound == run_id,
            "RUN_ID_BINDING_MISMATCH")
    return run_id


def response_guard(packet, result, bound):
    summary = result.get("publicSummary")
    require(isinstance(summary, dict) and summary.get("operation") == packet["operation"],
            "QA_RESPONSE_INVALID_INSPECT_OUTCOME")
    if packet["operation"] == "refs":
        require(summary.get("runId") is None, "RUN_ID_RESPONSE_MISMATCH")
    elif packet["operation"] == "plan":
        generated = summary.get("runId")
        require(isinstance(generated, str) and UUID.fullmatch(generated) and
                isinstance(result.get("privatePayload"), dict) and
                result["privatePayload"].get("runId") == generated, "RUN_ID_RESPONSE_MISMATCH")
    else:
        require(summary.get("runId") == bound, "RUN_ID_RESPONSE_MISMATCH")


def persist_intent(old, run_id, operation, attempt_id, packet_sha):
    if not STATE.exists():
        STATE.mkdir(mode=0o700)
    old.directory(STATE, exact_mode=0o700)
    folder = STATE / run_id
    if not folder.exists():
        folder.mkdir(mode=0o700)
    old.directory(folder, exact_mode=0o700)
    intent = folder / (operation + "-intent.json")
    require(not intent.exists(), "REMOTE_MUTATION_ALREADY_ATTEMPTED")
    old.write_exclusive(intent, {"runId": run_id, "operation": operation, "attemptId": attempt_id,
                                  "packetSha256": packet_sha, "at": old.now()})
    return folder


def execute(old, packet, identity):
    operation = packet["operation"]
    request = packet.get("input")
    bound = binding_guard(packet)
    raw = base64.b64decode(packet.get("bundle", ""), validate=True)
    require(0 < len(raw) <= 768 * 1024 and digest(raw) == packet["seal"]["bundleSha256"], "QA_BUNDLE_MISMATCH")
    encoded = base64.b64encode(old.canonical(request)).decode("ascii")
    require(len(encoded) <= 96 * 1024, "QA_INPUT_TOO_LARGE")
    environment = {**old.SAFE_ENV, "CRM_ENGINEERING_QA_INPUT": encoded}
    command = old.DOCKER + ["exec", "-i", "-w", "/app/apps/web", "--env", "CRM_ENGINEERING_QA_INPUT",
                            identity["web"], "timeout", "-s", "KILL", "150", "node", "--input-type=module"]
    # No outer timeout: a cancelled docker client could leave a live mutation.
    result = subprocess.run(command, input=raw, capture_output=True, env=environment, check=False)
    require(len(result.stdout) <= 1024 * 1024 and len(result.stderr) <= 128 * 1024, "QA_OUTPUT_TOO_LARGE_INSPECT_OUTCOME")
    try:
        body = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise Stop("QA_JSON_REQUIRED_INSPECT_OUTCOME") from None
    require(isinstance(body, dict) and set(body) == {"publicSummary", "privatePayload"},
            "QA_RESPONSE_INVALID_INSPECT_OUTCOME")
    require(result.returncode == 0 and body["publicSummary"].get("status") == "PASS",
            body["publicSummary"].get("code", "QA_PROCESS_FAILED_INSPECT_OUTCOME"))
    response_guard(packet, body, bound)
    return body


def main():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    os.umask(0o077)
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, "PACKET_TOO_LARGE")
    packet = json.loads(raw)
    require(isinstance(packet, dict) and set(packet) == {"seal", "operation", "attemptId", "runId", "input", "bundle"},
            "PACKET_FIELDS_INVALID")
    seal = seal_guard(packet)
    require(packet["operation"] in OPS and UUID.fullmatch(packet["attemptId"]), "OPERATION_OR_ATTEMPT_INVALID")
    binding_guard(packet)
    bundle = base64.b64decode(packet["bundle"], validate=True)
    require(0 < len(bundle) <= 768 * 1024 and digest(bundle) == seal["bundleSha256"], "QA_BUNDLE_MISMATCH")
    old = support()
    old.directory(old.REFRESH)
    with os.fdopen(old.protected_open(old.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop("REFRESH_OR_DEPLOY_BUSY") from None
        old.require_refresh_idle()
        before, _ = old.identity(seal["expectedRevision"])
        backup_proof(old, seal)
        folder = None
        if packet["operation"] in MUTATIONS:
            folder = persist_intent(old, packet["runId"], packet["operation"], packet["attemptId"], digest(raw))
        result = execute(old, packet, before)
        old.require_refresh_idle()
        after, _ = old.identity(seal["expectedRevision"])
        require(after == before, "DEPLOYMENT_CHANGED_INSPECT_OUTCOME")
        if folder is not None:
            old.write_exclusive(folder / (packet["operation"] + "-result.json"),
                                {"publicSummary": result["publicSummary"], "at": old.now()})
        # Private stdout pipe: local runner never prints privatePayload/cookies.
        print(json.dumps({"identity": before, "operation": packet["operation"], "attemptId": packet["attemptId"],
                          "result": result}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Stop as error:
        code = str(error)
        print(json.dumps({"publicSummary": {"status": "STOP", "code": code if re.fullmatch(r"[A-Z][A-Z0-9_]{2,100}", code)
                                                     else "WRAPPER_FAILED_INSPECT_OUTCOME"}, "privatePayload": None}))
        sys.exit(2)
    except Exception:
        print(json.dumps({"publicSummary": {"status": "STOP", "code": "WRAPPER_FAILED_INSPECT_OUTCOME"}, "privatePayload": None}))
        sys.exit(2)
