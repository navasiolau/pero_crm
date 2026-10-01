"""Hold the existing W07 lock during a bounded root browser acceptance window.
No service/configuration/DB changes. JSON lines: acquire, then explicit release.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import socket
import sys

SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790"


def main():
    if socket.gethostname() != "crm-staging" or os.geteuid() != 0:
        raise RuntimeError("STAGING_ROOT_REQUIRED")
    if Path(__file__).name != "pero-engineering-window-" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest() + ".py":
        raise RuntimeError("WINDOW_SCRIPT_MISMATCH")
    path = Path("/root/pero-work-shares-" + SUPPORT_SHA + ".py")
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != SUPPORT_SHA:
        raise RuntimeError("SUPPORT_MISMATCH")
    spec = importlib.util.spec_from_file_location("reviewed_support", path)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    request = json.loads(sys.stdin.readline(2048))
    old.require(set(request) == {"revision", "runId"} and re.fullmatch(r"[a-f0-9]{40}", request["revision"]) and old.UUID4.fullmatch(request["runId"]), "REQUEST_INVALID")
    with os.fdopen(old.protected_open(old.REFRESH / "workflow.lock", os.O_RDWR), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old.require_refresh_idle()
        before, _ = old.identity(request["revision"])
        print(json.dumps({"status": "WINDOW_READY", "runId": request["runId"], "revision": request["revision"]}), flush=True)
        old.require(select.select([sys.stdin], [], [], 900)[0], "WINDOW_DEADLINE")
        release = json.loads(sys.stdin.readline(2048))
        old.require(release == {"release": request["runId"]}, "WINDOW_RELEASE_INVALID")
        old.require_refresh_idle()
        old.require(old.identity(request["revision"])[0] == before, "WINDOW_IDENTITY_DRIFT")
    print(json.dumps({"status": "WINDOW_RELEASED", "runId": request["runId"]}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        text = str(error)
        print(json.dumps({"status": "STOP", "code": text if re.fullmatch(r"[A-Z_]+", text) else "STAGING_WINDOW_FAILED"}), flush=True)
        sys.exit(1)
