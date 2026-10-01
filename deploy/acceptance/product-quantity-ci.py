"""Read-only CI status via the existing staging registry identity; no credential output."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sys
from urllib.request import Request, urlopen


def main():
    assert socket.gethostname() == "crm-staging" and os.geteuid() == 0
    source = Path(__file__).read_bytes()
    assert Path(__file__).name == "pero-product-quantity-ci-" + hashlib.sha256(source).hexdigest() + ".py"
    packet = json.loads(sys.stdin.read(2048))
    assert set(packet) == {"revision"} and re.fullmatch("[a-f0-9]{40}", packet["revision"])
    path = Path("/root/.docker/config.json")
    assert path.is_file() and not path.is_symlink() and path.stat().st_uid == 0
    config = json.loads(path.read_text())
    entry = config.get("auths", {}).get("ghcr.io", {})
    token = base64.b64decode(entry["auth"]).decode().split(":", 1)[1]
    request = Request("https://api.github.com/repos/navasiolau/pero_crm/actions/runs?branch=staging&per_page=20",
        headers={"Authorization": "Bearer " + token, "User-Agent": "pero-quantity-ci", "Accept": "application/vnd.github+json"})
    with urlopen(request, timeout=20) as response:
        data = json.load(response)
    runs = [{"id": row["id"], "url": row["html_url"], "status": row["status"], "conclusion": row["conclusion"],
        "revision": row["head_sha"]} for row in data.get("workflow_runs", []) if row["head_sha"] == packet["revision"]]
    print(json.dumps({"status": "CI_STATUS", "runs": runs}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"status": "CI_STATUS_UNAVAILABLE"}))
        sys.exit(1)
