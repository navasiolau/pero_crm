"""Root-only staging acceptance. SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md.
STOP on host, source, W07, identity, preservation, or outcome mismatch. No production calls.
"""
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import socket
import subprocess
import sys
import time

SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790"
BASE = Path("/var/lib/pero-product-quantity-qa")


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def load_support():
    require(socket.gethostname() == "crm-staging" and os.geteuid() == 0, "STAGING_ROOT_REQUIRED")
    source = Path(__file__).read_bytes()
    require(Path(__file__).name == "pero-product-quantity-" + digest(source) + ".py", "WRAPPER_SOURCE_MISMATCH")
    path = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
    require(path.is_file() and not path.is_symlink() and digest(path.read_bytes()) == SUPPORT_SHA, "SUPPORT_SOURCE_MISMATCH")
    spec = importlib.util.spec_from_file_location("reviewed_quantity_support", path)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    return old


def pg(old, before, password, sql):
    result = subprocess.run(old.DOCKER + ["exec", "-i", "--env", "PGPASSWORD", before["database"],
        "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "crm", "-d", "crm"],
        input=sql.encode(), capture_output=True, env={**old.SAFE_ENV, "PGPASSWORD": password}, timeout=60)
    require(result.returncode == 0, "STAGING_READONLY_QUERY_FAILED")
    return result.stdout.decode().strip()


def fingerprint(old, before, password):
    tables = json.loads(pg(old, before, password,
        "BEGIN READ ONLY; SELECT json_agg(tablename::text ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'; ROLLBACK;"))
    result = {}
    for table in tables:
        require(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", table), "TABLE_NAME_INVALID")
        projection = "to_jsonb(t)-'quantity'" if table == "Product" else (
            "to_jsonb(t)-'quantityPerUnit'" if table in ("Work", "ProjectMaterial") else "to_jsonb(t)")
        sql = f"""BEGIN READ ONLY; SELECT json_build_object('count',count(*)::text,'hash',
          md5(coalesce(string_agg(md5(({projection})::text),'' ORDER BY md5(({projection})::text)),''))) FROM "{table}" t; ROLLBACK;"""
        result[table] = json.loads(pg(old, before, password, sql))
    return result


def main():
    old = load_support()
    packet = json.loads(sys.stdin.readline(2 * 1024 * 1024))
    require(packet.get("operation") in ("baseline", "window"), "OPERATION_REQUIRED")
    require(re.fullmatch(r"[a-f0-9]{40}", packet.get("revision", "")), "REVISION_REQUIRED")
    require(re.fullmatch(r"[a-f0-9-]{36}", packet.get("runId", "")), "RUN_ID_REQUIRED")
    with os.fdopen(old.protected_open(old.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old.require_refresh_idle()
        before, password = old.identity(packet["revision"])
        if packet["operation"] == "baseline":
            require(set(packet) == {"operation", "revision", "runId"}, "BASELINE_FIELDS_INVALID")
            BASE.mkdir(mode=0o700, exist_ok=True)
            require(not BASE.is_symlink() and BASE.stat().st_uid == 0 and BASE.stat().st_mode & 0o777 == 0o700, "BASE_DIRECTORY_UNSAFE")
            folder = BASE / packet["runId"]
            folder.mkdir(mode=0o700)
            snapshot = fingerprint(old, before, password)
            dump = subprocess.run(old.DOCKER + ["exec", "--env", "PGPASSWORD", before["database"],
                "pg_dump", "-h", "127.0.0.1", "-U", "crm", "-Fc", "crm"], capture_output=True,
                env={**old.SAFE_ENV, "PGPASSWORD": password}, timeout=90)
            require(dump.returncode == 0 and len(dump.stdout) > 1024, "STAGING_BACKUP_FAILED")
            with os.fdopen(os.open(folder / "before.dump", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
                handle.write(dump.stdout)
            receipt = {"identity": before, "before": snapshot, "backupBytes": len(dump.stdout), "backupSha256": digest(dump.stdout)}
            with os.fdopen(os.open(folder / "baseline.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                json.dump(receipt, handle)
            old.require_refresh_idle()
            require(old.identity(packet["revision"])[0] == before, "BASELINE_IDENTITY_DRIFT")
            print(json.dumps({"status": "STAGING_BASELINE_READY", "runId": packet["runId"], "identity": before,
                "tables": len(snapshot), "backupBytes": len(dump.stdout)}), flush=True)
            return
        require(set(packet) == {"operation", "revision", "runId", "baselineRunId", "bundle", "bundleSha256"}, "WINDOW_FIELDS_INVALID")
        require(re.fullmatch(r"[a-f0-9-]{36}", packet["baselineRunId"]), "BASELINE_RUN_ID_INVALID")
        baseline = json.loads((BASE / packet["baselineRunId"] / "baseline.json").read_text())
        require(baseline["identity"]["database"] == before["database"] and baseline["identity"]["databaseVolume"] == before["databaseVolume"], "STAGING_DATABASE_DRIFT")
        current = fingerprint(old, before, password)
        changed = [table for table in current if current[table] != baseline["before"].get(table)]
        require(not changed, "STAGING_MIGRATION_PRESERVATION_FAILED")
        backfill = json.loads(pg(old, before, password, """BEGIN READ ONLY;
          SELECT json_build_object('products',(SELECT count(*) FROM "Product" WHERE quantity <> 1),
          'works',(SELECT count(*) FROM "Work" WHERE "productId" IS NOT NULL AND "paymentKind"='LEGACY' AND "quantityPerUnit" IS DISTINCT FROM quantity),
          'materials',(SELECT count(*) FROM "ProjectMaterial" WHERE "quantityPerUnit" IS DISTINCT FROM quantity));
          ROLLBACK;"""))
        require(backfill == {"products": 0, "works": 0, "materials": 0}, "STAGING_BACKFILL_INCONSISTENT")
        bundle = base64.b64decode(packet["bundle"], validate=True)
        require(0 < len(bundle) <= 768 * 1024 and digest(bundle) == packet["bundleSha256"], "BUNDLE_SOURCE_MISMATCH")
        state_path = "/tmp/product-quantity-qa-" + packet["runId"] + ".json"
        print(json.dumps({"status": "STAGING_WINDOW_READY", "identity": before, "tablesPreserved": len(current), "backfill": backfill}), flush=True)
        deadline = time.monotonic() + 900
        attempted = set()
        while True:
            require(select.select([sys.stdin], [], [], max(0, deadline - time.monotonic()))[0], "STAGING_WINDOW_DEADLINE")
            request = json.loads(sys.stdin.readline(4096))
            require(set(request) == {"operation"}, "WINDOW_REQUEST_INVALID")
            operation = request["operation"]
            if operation == "release":
                old.require_refresh_idle()
                require(old.identity(packet["revision"])[0] == before, "WINDOW_IDENTITY_DRIFT")
                print(json.dumps({"status": "STAGING_WINDOW_RELEASED"}), flush=True)
                return
            require(operation in ("prepare", "capture", "cleanup"), "QA_OPERATION_INVALID")
            if operation in ("prepare", "cleanup"):
                require(operation not in attempted, "MUTATION_RETRY_FORBIDDEN")
                attempted.add(operation)
            data = json.dumps({"operation": operation, "target": "staging", "statePath": state_path})
            child = subprocess.run(old.DOCKER + ["exec", "-i", "-w", "/app/apps/web", "--env", "CRM_PRODUCT_QUANTITY_QA",
                before["web"], "node", "--input-type=module"], input=bundle, capture_output=True,
                env={**old.SAFE_ENV, "CRM_PRODUCT_QUANTITY_QA": data}, timeout=90)
            if child.returncode != 0:
                # Diagnostics stay private; no credentials or raw DB errors on transport.
                error_path = BASE / packet["baselineRunId"] / ("quantity-" + operation + "-error.private.log")
                error_path.write_bytes(child.stderr)
                error_path.chmod(0o600)
            require(child.returncode == 0, "STAGING_QA_OPERATION_STOP")
            result = json.loads(child.stdout)
            old.require_refresh_idle()
            require(old.identity(packet["revision"])[0] == before, "QA_RUNTIME_IDENTITY_DRIFT")
            print(json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        print(json.dumps({"status": "STOP", "code": code if re.fullmatch(r"[A-Z_]+", code) else "STAGING_QUANTITY_FAILED"}), flush=True)
        sys.exit(1)
