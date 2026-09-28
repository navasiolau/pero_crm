#!/usr/bin/env python3
"""Однократное восстановление watcher по точному reviewed manifest; без SQL."""
import argparse
from contextlib import ExitStack, contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import tempfile

PIN = "sha256:952240e4ad1e9e08883a39f20975cd6d4269b8e78c922ebc12e91ebd35603fa5"
MARKER = "# pero-crm-auth-20260922 PAUSED: "


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def active_cron(data, entrypoint):
    text = data.decode("utf-8")
    matches = [line for line in text.splitlines() if line.startswith(MARKER) and line.endswith("root " + entrypoint)]
    require(len(matches) == 1, "expected one exact paused watcher line")
    require(not any(not line.lstrip().startswith("#") and entrypoint in line for line in text.splitlines()), "watcher already active")
    return text.replace(matches[0], matches[0][len(MARKER):], 1).encode("utf-8")


def unpinned_override(data):
    image = ("    image: " + PIN + "\n").encode()
    policy = b"    pull_policy: never\n"
    require(data.count(image) == data.count(policy) == 1, "unexpected override pin")
    require(b"services:\n  web:\n" in data and b"    healthcheck:\n" in data, "unexpected override structure")
    return data.replace(image, b"", 1).replace(policy, b"", 1)


def read_safe(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) & 0o022 == 0, "unsafe source file")
        return stream.read(), stat.S_IMODE(info.st_mode)


def atomic(path, data, mode):
    fd, temporary = tempfile.mkstemp(prefix=".crm-watch-", dir=path.parent)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


@contextmanager
def locked(path):
    import fcntl

    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600, "unsafe lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def docker_inspect(name):
    raw = subprocess.run(["docker", "--host", "unix:///var/run/docker.sock", "inspect", "--type", "container", name],
                         check=True, capture_output=True, text=True, timeout=20)
    return json.loads(raw.stdout)[0]


class ActivationUnknown(RuntimeError):
    def __init__(self, details):
        super().__init__("activation state must be inspected")
        self.details = details


def activate_cron(cron, new_cron, mode, journal, receipt, write=atomic, read=read_safe):
    receipt["phase"] = "activation-intent"
    write(journal / "receipt.json", (json.dumps(receipt, indent=2) + "\n").encode(), 0o600)
    try:
        write(cron, new_cron, mode)
        require(read(cron)[0] == new_cron, "activation readback mismatch")
        receipt["phase"] = "activated"
        write(journal / "receipt.json", (json.dumps(receipt, indent=2) + "\n").encode(), 0o600)
    except Exception:
        details = {"status": "activation-unknown", "journal": str(journal), "cronSha256": None,
                   "activeCronObserved": None, "reason": "inspect cron and receipt before any retry"}
        try:
            observed = read(cron)[0]
            details.update(cronSha256=sha(observed), activeCronObserved=observed == new_cron)
        except Exception:
            pass
        raise ActivationUnknown(details) from None


def install(manifest, candidate):
    host = socket.gethostname()
    require(os.geteuid() == 0 and host in ("crm", "crm-staging") and host == manifest["hostname"], "target mismatch")
    require(re.fullmatch(r"[a-z0-9-]{8,80}", manifest["runId"]) is not None, "invalid run id")
    require(re.fullmatch(r"[a-f0-9]{40}", manifest["validatedRevision"]) is not None, "missing CI revision")
    stack = Path("/opt") / host
    require(stack.resolve() == stack and stack.is_dir(), "unexpected stack path")
    helper, _ = read_safe(candidate)
    require(sha(helper) == manifest["helperSha256"], "helper checksum mismatch")
    cron = Path("/etc/cron.d/watch-deploy")
    override = stack / "docker-compose.override.yml"
    entrypoint = stack / ("watch-prod.sh" if host == "crm" else "watch-staging.sh")
    helper_path = stack / "watch-crm.py"
    originals = {}
    for path in (cron, override, entrypoint):
        contents, mode = read_safe(path)
        require(sha(contents) == manifest["before"][str(path)], "live file drift: " + str(path))
        originals[path] = (contents, mode)
    require(not helper_path.exists() and not helper_path.is_symlink(), "helper already exists; inspect owned rollout")
    new_cron = active_cron(originals[cron][0], str(entrypoint))
    changes = {override: (unpinned_override(originals[override][0]), originals[override][1]), helper_path: (helper, 0o700)}
    shim = ("#!/bin/sh\ncd " + str(stack) + " || exit 1\nexec /usr/bin/python3 " + str(helper_path) + "\n").encode()
    refresh = Path("/var/lib/pero-staging-refresh")
    if host == "crm-staging":
        for path in (refresh / "watcher.original.sh", refresh / "watcher.json"):
            content, mode = read_safe(path)
            require(sha(content) == manifest["before"][str(path)], "stage watcher drift")
            originals[path] = (content, mode)
        metadata = json.loads(originals[refresh / "watcher.json"][0])
        require(metadata.get("owner") == "pero-staging-refresh-v1" and metadata.get("sha256") == sha(originals[refresh / "watcher.original.sh"][0]), "W07 ownership mismatch")
        metadata["sha256"] = sha(shim)
        changes[refresh / "watcher.original.sh"] = (shim, originals[refresh / "watcher.original.sh"][1])
        changes[refresh / "watcher.json"] = ((json.dumps(metadata) + "\n").encode(), originals[refresh / "watcher.json"][1])
    else:
        changes[entrypoint] = (shim, originals[entrypoint][1])

    with ExitStack() as locks:
        if host == "crm-staging":
            locks.enter_context(locked(refresh / "workflow.lock"))
            if (refresh / "active.json").exists():
                active = json.loads(read_safe(refresh / "active.json")[0])
                require(active.get("owner") == "pero-staging-refresh-v1" and not active.get("runId"), "refresh active")
        locks.enter_context(locked(Path("/run/lock") / ("pero-" + host + "-deploy.lock")))
        for path, (content, _) in originals.items():
            require(read_safe(path)[0] == content, "file changed before installation")
        db = docker_inspect(host + "-db-1")
        require(db["Id"] == manifest["dbContainerId"] and db["Mounts"] == manifest["dbMounts"] and db["State"]["Running"], "database container identity drift")
        labels = db["Config"].get("Labels", {})
        require(labels.get("com.docker.compose.project") == host and labels.get("com.docker.compose.project.working_dir") == str(stack), "database ownership mismatch")
        journal = Path("/var/lib") / ("pero-crm-watcher-rollout-" + manifest["runId"])
        require(not journal.exists() and not journal.is_symlink(), "rollout already exists; inspect before resuming")
        journal.mkdir(mode=0o700)
        receipt = {"owner": manifest["runId"], "hostname": host, "phase": "prepared", "validatedRevision": manifest["validatedRevision"],
                   "database": db["Id"], "before": {}, "after": {str(p): sha(v[0]) for p, v in changes.items()}, "activeCronSha256": sha(new_cron)}
        for index, (path, (content, mode)) in enumerate(originals.items()):
            backup = journal / (str(index) + ".before")
            atomic(backup, content, 0o600)
            receipt["before"][str(path)] = {"file": str(backup), "sha256": sha(content), "mode": mode}
        atomic(journal / "receipt.json", (json.dumps(receipt, indent=2) + "\n").encode(), 0o600)
        for path, (content, mode) in changes.items():
            atomic(path, content, mode)
        # Проверка конфигурации без запуска приложения или зависимостей.
        configured = subprocess.run(["docker", "--host", "unix:///var/run/docker.sock", "compose", "--project-directory", str(stack),
                                     "--project-name", host, "-f", str(stack / "docker-compose.yml"), "-f", str(override),
                                     "config", "--format", "json"], cwd=stack, check=True, capture_output=True, text=True, timeout=20)
        web = json.loads(configured.stdout)["services"]["web"]
        tag = "main" if host == "crm" else "staging"
        require(web.get("image") == "ghcr.io/navasiolau/pero_crm:" + tag and web.get("pull_policy") != "never", "new configuration still pinned")
        require(web.get("healthcheck", {}).get("test"), "healthcheck lost")
        require(docker_inspect(host + "-db-1")["Id"] == db["Id"], "database container changed")
        activate_cron(cron, new_cron, originals[cron][1], journal, receipt)
        return {"status": "activated", "hostname": host, "journal": str(journal), "helperSha256": sha(helper), "cronSha256": sha(new_cron)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--candidate", required=True)
    arguments = parser.parse_args()
    try:
        print(json.dumps(install(json.loads(read_safe(arguments.manifest)[0]), arguments.candidate)))
    except ActivationUnknown as error:
        print(json.dumps(error.details))
        raise SystemExit(2)
    except Exception as error:
        print(json.dumps({"status": "refused-or-paused", "reason": str(error) if type(error) is RuntimeError else type(error).__name__}))
        raise SystemExit(1)
