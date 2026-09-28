"""Run reviewed acceptance code in the existing staging web, never production.

Transport only: private browser session JSON may be returned over SSH to the
local QA process. The local caller must not echo it or put it in Git/logs.
The existing refresh/workflow lock is held for each short invocation.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
from urllib.parse import urlsplit


DB_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a"
DB_STARTED = "2026-09-23T11:42:14.649193151Z"
OUTER_SHA = "27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139"
STACK = Path("/opt/crm-staging")
REFRESH = Path("/var/lib/pero-staging-refresh")


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def protected_open(path, flags):
    descriptor = os.open(path, flags | os.O_NOFOLLOW)
    info = os.fstat(descriptor)
    if not (stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
            info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600):
        os.close(descriptor)
        raise Refused("REFRESH_FILE_METADATA_MISMATCH")
    return descriptor


def require_refresh_idle():
    try:
        descriptor = protected_open(REFRESH / "active.json", os.O_RDONLY)
    except FileNotFoundError:
        return
    with os.fdopen(descriptor, "r") as source:
        active = json.loads(source.read(64 * 1024))
    require(isinstance(active, dict) and active.get("owner") == "pero-staging-refresh-v1" and
            "runId" in active and active["runId"] is None, "REFRESH_ACTIVE_OR_UNKNOWN")


def inspect(name):
    result = subprocess.run(
        ["docker", "--host", "unix:///var/run/docker.sock", "inspect", name],
        capture_output=True, text=True, timeout=15, check=False,
    )
    require(result.returncode == 0, "DOCKER_INSPECT_FAILED")
    return json.loads(result.stdout)[0]


def identity(revision):
    require(socket.gethostname() == "crm-staging", "STAGING_HOST_REQUIRED")
    require(os.geteuid() == 0, "ROOT_WRAPPER_REQUIRED")
    require(STACK.is_dir(), "STAGING_STACK_REQUIRED")
    require(hashlib.sha256((STACK / "watch-staging.sh").read_bytes()).hexdigest() == OUTER_SHA,
            "REFRESH_WATCHER_CHANGED")
    web = inspect("crm-staging-web-1")
    db = inspect("crm-staging-db-1")
    for name, item in (("web", web), ("db", db)):
        labels = item["Config"].get("Labels", {})
        require(labels.get("com.docker.compose.project") == "crm-staging", "COMPOSE_PROJECT_MISMATCH")
        require(labels.get("com.docker.compose.service") == name, "COMPOSE_SERVICE_MISMATCH")
        require(labels.get("com.docker.compose.project.working_dir") == str(STACK), "COMPOSE_DIRECTORY_MISMATCH")
        require(item["State"].get("Running") is True, "EXISTING_CONTAINER_NOT_RUNNING")
        require(item["State"].get("Health", {}).get("Status") == "healthy", "EXISTING_CONTAINER_NOT_HEALTHY")
    require(web["Config"]["Labels"].get("org.opencontainers.image.revision") == revision, "WEB_REVISION_MISMATCH")
    require(db["Id"] == DB_ID and db["State"]["StartedAt"] == DB_STARTED, "DATABASE_IDENTITY_CHANGED")
    mounts = db.get("Mounts", [])
    require(len(mounts) == 1 and mounts[0].get("Type") == "volume" and
            mounts[0].get("Name") == "crm-staging_pgdata" and
            mounts[0].get("Destination") == "/var/lib/postgresql/data", "DATABASE_MOUNT_CHANGED")
    web_networks = web["NetworkSettings"]["Networks"]
    db_networks = db["NetworkSettings"]["Networks"]
    require(set(web_networks) == {"crm-staging_backend", "crm-staging_frontend"} and
            set(db_networks) == {"crm-staging_backend"}, "STAGING_NETWORK_MISMATCH")
    require(web_networks["crm-staging_backend"]["NetworkID"] == db_networks["crm-staging_backend"]["NetworkID"],
            "DATABASE_NETWORK_MISMATCH")
    require("db" in db_networks["crm-staging_backend"].get("Aliases", []), "DATABASE_ALIAS_MISMATCH")
    env = dict(value.split("=", 1) for value in web["Config"]["Env"] if "=" in value)
    db_url = urlsplit(env.get("DATABASE_URL", ""))
    require(db_url.scheme in ("postgres", "postgresql") and db_url.hostname == "db" and
            db_url.path == "/crm" and db_url.port in (None, 5432), "DATABASE_BINDING_MISMATCH")
    endpoint = urlsplit(env.get("S3_ENDPOINT", ""))
    require(endpoint.scheme == "http" and endpoint.hostname == "192.168.0.33" and endpoint.port == 9000 and
            env.get("S3_BUCKET") == "pero-crm-staging", "STAGING_STORAGE_MISMATCH")
    return {"hostname": "crm-staging", "web": web["Id"], "image": web["Image"], "revision": revision,
            "database": db["Id"], "databaseStartedAt": db["State"]["StartedAt"],
            "databaseVolume": "crm-staging_pgdata", "outerW07Sha256": OUTER_SHA}


def main():
    packet = json.loads(sys.stdin.buffer.read(1024 * 1024 + 1))
    require(set(packet) <= {"revision", "bundle", "bundleSha256", "operation", "input"}, "UNKNOWN_PACKET_FIELDS")
    revision = packet.get("revision", "")
    require(re.fullmatch("[a-f0-9]{40}", revision), "FULL_REVISION_REQUIRED")
    operation = packet.get("operation")
    require(operation in ("readonly", "prepare", "restore", "inspect"), "UNKNOWN_OPERATION")
    bundle = base64.b64decode(packet.get("bundle", ""), validate=True)
    require(0 < len(bundle) <= 256 * 1024, "BUNDLE_SIZE_INVALID")
    require(hashlib.sha256(bundle).hexdigest() == packet.get("bundleSha256"), "BUNDLE_CHECKSUM_MISMATCH")
    require(socket.gethostname() == "crm-staging", "STAGING_HOST_REQUIRED")
    parent = REFRESH.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0 and
            not stat.S_IMODE(parent.st_mode) & 0o022, "REFRESH_DIRECTORY_METADATA_MISMATCH")
    with os.fdopen(protected_open(REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("REFRESH_OR_DEPLOY_BUSY") from None
        require_refresh_idle()
        before = identity(revision)
        command = ["docker", "--host", "unix:///var/run/docker.sock", "exec", "-i", "-w", "/app/apps/web"]
        execution_env = os.environ.copy()
        if operation != "readonly":
            data = packet.get("input", {})
            require(isinstance(data, dict) and data.get("operation") == operation, "OPERATION_INPUT_MISMATCH")
            encoded = base64.b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
            require(len(encoded) <= 96 * 1024, "BROWSER_INPUT_TOO_LARGE")
            # Docker inherits the value without placing private input in argv.
            execution_env["CRM_STAGING_BROWSER_INPUT"] = encoded
            command.extend(["--env", "CRM_STAGING_BROWSER_INPUT"])
        # The deadline must live INSIDE the container. Killing only docker's CLI
        # does not stop an exec process. BusyBox timeout supervises Node itself.
        # Do not add a shorter outer timeout: if the Docker connection stalls,
        # keep this process and the workflow lock until execution is resolved.
        command.extend([before["web"], "timeout", "-s", "KILL", "135", "node", "--input-type=module"])
        result = subprocess.run(command, input=bundle, capture_output=True, env=execution_env, check=False)
        require_refresh_idle()
        after = identity(revision)
        require(before == after, "DEPLOYMENT_CHANGED_DURING_ACCEPTANCE")
        require(len(result.stdout) <= 256 * 1024, "ACCEPTANCE_OUTPUT_TOO_LARGE")
        # Do not echo stderr: dependencies could include ambient secrets in errors.
        try:
            body = json.loads(result.stdout)
        except (ValueError, UnicodeError):
            raise Refused("ACCEPTANCE_JSON_REQUIRED") from None
        print(json.dumps({"identity": before, "bundleSha256": packet["bundleSha256"],
                          "operation": operation, "exitCode": result.returncode, "result": body}))
        return 0 if result.returncode == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as error:
        print(json.dumps({"status": "REFUSED", "code": str(error)}))
        sys.exit(2)
    except Exception:
        print(json.dumps({"status": "REFUSED", "code": "WRAPPER_FAILED"}))
        sys.exit(2)
