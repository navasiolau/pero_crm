#!/usr/bin/env python3
"""Обновляет web и opt-in renderer известной CRM-среды; staging идёт через W07."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import datetime
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import tempfile
import time


IMAGE_RE = re.compile(r"sha256:[0-9a-f]{64}\Z")
CONTAINER_RE = re.compile(r"[0-9a-f]{64}\Z")
REVISION_RE = re.compile(r"[0-9a-f]{40}\Z")
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
KP_REPOSITORY = "ghcr.io/navasiolau/pero_kp_renderer"
WEB_REPOSITORY = "ghcr.io/navasiolau/pero_crm"


class WatchError(RuntimeError):
    """Только фиксированный код, без stdout/stderr команд или секретов."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
        self.context: dict = {}


def require(condition: bool, code: str) -> None:
    if not condition:
        raise WatchError(code)


def executable_renderer_tmpfs(value: object) -> bool:
    """Разрешён только ограниченный /tmp для извлечённого Chromium, без noexec."""
    flags = value.split(",") if isinstance(value, str) else []
    return len(flags) == 5 and set(flags) == {"rw", "nosuid", "exec", "size=512m", "mode=1777"}


@dataclass(frozen=True)
class Target:
    project: str
    directory: str
    image: str


def target_for(hostname: str, directory: str) -> Target:
    tag = {"crm": "main", "crm-staging": "staging"}.get(hostname)
    require(tag is not None and directory == f"/opt/{hostname}", "target-mismatch")
    return Target(hostname, directory, f"ghcr.io/navasiolau/pero_crm:{tag}")


def check_config(config: dict, target: Target) -> None:
    require(config.get("name") == target.project, "compose-project-mismatch")
    services = config.get("services", {})
    web, db = services.get("web", {}), services.get("db", {})
    require(web.get("image") == target.image, "compose-image-mismatch")
    require("build" not in web, "compose-build-forbidden")
    require(web.get("pull_policy") in (None, "always", "missing", "if_not_present"),
            "compose-pull-policy-mismatch")
    health = web.get("healthcheck", {})
    test = health.get("test", [])
    require(not health.get("disable") and isinstance(test, list) and len(test) > 1
            and test[0] in ("CMD", "CMD-SHELL"), "compose-healthcheck-missing")
    require(bool(db.get("image")) and bool(db.get("volumes")), "compose-database-missing")
    if kp_enabled(config):
        renderer = services.get("kp-renderer", {})
        tag = target.image.rsplit(":", 1)[1]
        require(renderer.get("image") == f"{KP_REPOSITORY}:{tag}" and "build" not in renderer
                and "kp" in renderer.get("profiles", []), "kp-compose-image")
        require(not renderer.get("ports") and not renderer.get("volumes") and renderer.get("read_only") is True
                and not renderer.get("privileged")
                and renderer.get("pids_limit") == 128 and float(renderer.get("cpus", 0)) == 1
                and str(renderer.get("mem_limit")) in ("1536m", "1610612736"), "kp-compose-bounds")
        mounts = renderer.get("tmpfs", [])
        require(isinstance(mounts, list) and len(mounts) == 1 and isinstance(mounts[0], str)
                and mounts[0].startswith("/tmp:") and executable_renderer_tmpfs(mounts[0][5:]), "kp-compose-tmpfs")
        require(set(renderer.get("networks", {})) == {"kp_render"}
                and "kp_render" in web.get("networks", {})
                and config.get("networks", {}).get("kp_render", {}).get("internal") is True, "kp-compose-network")
        secret = renderer.get("environment", {}).get("PERO_KP_RENDERER_SECRET")
        require(isinstance(secret, str) and len(secret) >= 32
                and secret == web.get("environment", {}).get("PERO_KP_RENDERER_SECRET"), "kp-compose-secret")


def kp_enabled(config: dict) -> bool:
    return str(config.get("services", {}).get("web", {}).get("environment", {}).get("PERO_KP_ENABLED", "0")) == "1"


def immutable_ref(image: dict, repository: str) -> str:
    refs = {value for value in image.get("RepoDigests", [])
            if re.fullmatch(re.escape(repository) + r"@sha256:[0-9a-f]{64}", value)}
    require(len(refs) == 1, "kp-image-digest")
    return refs.pop()


def kp_binding(web: dict, renderer: dict | None = None) -> dict:
    image, revision = image_identity(web)
    labels = web.get("Config", {}).get("Labels") or {}
    digest = labels.get("pero.kp.renderer-index", "")
    require(bool(REVISION_RE.fullmatch(revision or "")) and bool(IMAGE_RE.fullmatch(digest))
            and labels.get("pero.kp.protocol") == "1" and labels.get("pero.ci.service") == "web", "kp-web-binding")
    for key in ("template", "source", "fonts"):
        require(bool(re.fullmatch(r"[0-9a-f]{64}", labels.get(f"pero.kp.{key}", ""))), "kp-template-binding")
    require(labels.get("pero.kp.chromium") == "141.0.0" and labels.get("pero.kp.puppeteer") == "24.43.1", "kp-runtime-binding")
    result = {"web": immutable_ref(web, WEB_REPOSITORY), "kp-renderer": f"{KP_REPOSITORY}@{digest}",
              "revision": revision, "web_id": image}
    if renderer is not None:
        renderer_id, renderer_revision = image_identity(renderer)
        other = renderer.get("Config", {}).get("Labels") or {}
        require(immutable_ref(renderer, KP_REPOSITORY) == result["kp-renderer"]
                and renderer_revision == revision and other.get("pero.ci.service") == "kp-renderer", "kp-renderer-binding")
        for key in ("protocol", "template", "source", "fonts", "chromium", "puppeteer"):
            require(other.get(f"pero.kp.{key}") == labels.get(f"pero.kp.{key}"), "kp-template-binding")
        for key in ("pero.ci.repository", "pero.ci.run", "pero.ci.attempt"):
            require(bool(labels.get(key)) and labels.get(key) == other.get(key), "kp-release-binding")
        require(labels["pero.ci.repository"] == "navasiolau/pero_crm"
                and bool(re.fullmatch(r"[1-9][0-9]*", labels["pero.ci.run"]))
                and bool(re.fullmatch(r"[1-9][0-9]*", labels["pero.ci.attempt"])), "kp-release-binding")
        result["renderer_id"] = renderer_id
    return result


def check_container(value: dict, target: Target, service: str, *, require_running: bool = True) -> None:
    require(bool(CONTAINER_RE.fullmatch(value.get("Id", ""))), "container-id-invalid")
    require(value.get("Name") == f"/{target.project}-{service}-1", "container-name-mismatch")
    labels = value.get("Config", {}).get("Labels") or {}
    require(labels.get("com.docker.compose.project") == target.project
            and labels.get("com.docker.compose.service") == service
            and labels.get("com.docker.compose.project.working_dir") == target.directory,
            "container-owner-mismatch")
    require(bool(IMAGE_RE.fullmatch(value.get("Image", ""))), "container-image-invalid")
    require(not require_running or value.get("State", {}).get("Running") is True, "container-not-running")


def health_status(container: dict) -> str:
    status = container.get("State", {}).get("Health", {}).get("Status", "missing")
    return status if status in ("healthy", "unhealthy", "starting") else "missing"


def database_snapshot(value: dict, target: Target, config: dict) -> tuple:
    check_container(value, target, "db")
    require(health_status(value) == "healthy", "database-unhealthy")
    mounts = value.get("Mounts", [])
    data = [m for m in mounts if m.get("Destination") == "/var/lib/postgresql/data"]
    declared = [m for m in config["services"]["db"]["volumes"]
                if m.get("target") == "/var/lib/postgresql/data"]
    require(len(data) == len(declared) == 1, "database-data-mount-missing")
    actual, wanted = data[0], declared[0]
    require(actual.get("RW") is True and actual.get("Type") == wanted.get("type")
            and bool(actual.get("Source")), "database-data-mount-mismatch")
    if wanted["type"] == "volume":
        name = config.get("volumes", {}).get(wanted.get("source"), {}).get("name")
        require(bool(name) and actual.get("Name") == name, "database-volume-mismatch")
    elif wanted["type"] == "bind":
        require(actual.get("Source") == wanted.get("source"), "database-bind-mismatch")
    else:
        raise WatchError("database-data-mount-unsupported")
    # Сравниваем все поля всех mounts, не только имя pgdata.
    return value["Id"], tuple(sorted(json.dumps(m, sort_keys=True) for m in mounts))


def image_identity(value: dict) -> tuple[str, str | None]:
    image = value.get("Id", "")
    require(bool(IMAGE_RE.fullmatch(image)), "desired-image-invalid")
    revision = (value.get("Config", {}).get("Labels") or {}).get("org.opencontainers.image.revision")
    require(revision is None or bool(REVISION_RE.fullmatch(revision)), "image-revision-invalid")
    return image, revision


def check_renderer_container(value: dict, target: Target, config: dict, *, allow_stopped=False) -> None:
    check_container(value, target, "kp-renderer", require_running=not allow_stopped)
    host = value.get("HostConfig", {})
    network = config["networks"]["kp_render"].get("name", f"{target.project}_kp_render")
    tmpfs = host.get("Tmpfs", {})
    require(isinstance(tmpfs, dict) and set(tmpfs) == {"/tmp"}
            and executable_renderer_tmpfs(tmpfs["/tmp"]), "kp-container-tmpfs")
    require(host.get("ReadonlyRootfs") is True and host.get("Memory") == 1536 * 1024 * 1024
            and host.get("NanoCpus") == 1_000_000_000 and host.get("PidsLimit") == 128
            and not host.get("PortBindings") and not host.get("Binds")
            and bool(host.get("Tmpfs", {}).get("/tmp")) and not host.get("Privileged")
            and value.get("Config", {}).get("User") == "node", "kp-container-bounds")
    require(set(value.get("NetworkSettings", {}).get("Networks", {})) == {network}
            and host.get("NetworkMode") == network
            and all(mount.get("Type") == "tmpfs" for mount in value.get("Mounts", [])), "kp-container-network")


def watch_pair(runtime, target: Target, config: dict, db_before: tuple, web: dict,
               context: dict, health_timeout: float, poll_interval: float) -> dict:
    """Один lock, immutable images и image-only rollback; БД только перечитывается."""
    runtime.reserve_pair_rollback()
    renderer = runtime.inspect_optional_container(target, "kp-renderer")
    if renderer is not None:
        check_renderer_container(renderer, target, config)
        require(health_status(renderer) == "healthy", "kp-current-renderer-unhealthy")
        # Не исправляем неизвестную уже смешанную пару без разбора причины.
        kp_binding(runtime.inspect_image_ref(web["Image"]), runtime.inspect_image_ref(renderer["Image"]))
    require(health_status(web) == "healthy", "kp-current-web-unhealthy")
    old_ids = {"web": web["Image"], "kp-renderer": renderer["Image"] if renderer else None}
    before_containers = {"web": (web["Id"], web["Image"]),
                         "kp-renderer": (renderer["Id"], renderer["Image"]) if renderer else None}

    def database_check():
        require(database_snapshot(runtime.inspect_container(target, "db"), target, config) == db_before, "database-drift")

    def wait_healthy(ids: dict, timeout: float):
        deadline = runtime.monotonic() + timeout
        while True:
            healthy = True
            containers = {}
            for service, image in ids.items():
                if image is None:
                    continue
                remaining = deadline - runtime.monotonic()
                require(remaining > 0, "kp-pair-health-timeout")
                current = runtime.inspect_container(target, service, timeout=min(15, remaining))
                containers[service] = current
                if service == "kp-renderer":
                    check_renderer_container(current, target, config)
                else:
                    check_container(current, target, service)
                require(current["Image"] == image, "kp-pair-image-mismatch")
                require(health_status(current) != "unhealthy", "kp-pair-unhealthy")
                healthy = healthy and health_status(current) == "healthy"
            if healthy:
                return containers
            runtime.sleep(min(poll_interval, max(0, deadline - runtime.monotonic())))

    changed = False
    try:
        runtime.pull(target)  # Branch tag нужен только для обнаружения нового web.
        desired_web = runtime.inspect_image(target)
        binding = kp_binding(desired_web)
        runtime.pull_image_ref(binding["kp-renderer"])
        desired_renderer = runtime.inspect_image_ref(binding["kp-renderer"])
        binding = kp_binding(desired_web, desired_renderer)
        desired_ids = {"web": binding["web_id"], "kp-renderer": binding["renderer_id"]}
        context.update(image=binding["web_id"], revision=binding["revision"], renderer=binding["renderer_id"],
                       web_ref=binding["web"], renderer_ref=binding["kp-renderer"])
        require(runtime.compose_config(target) == config, "compose-drift")
        database_check()
        for service, previous in before_containers.items():
            current = runtime.inspect_optional_container(target, service)
            require(((current["Id"], current["Image"]) if current else None) == previous, "kp-container-drift")
        result = {"project": target.project, "image": binding["web_id"], "renderer": binding["renderer_id"],
                  "revision": binding["revision"], "web_ref": binding["web"], "renderer_ref": binding["kp-renderer"], "database": db_before[0]}
        if old_ids == desired_ids:
            wait_healthy(desired_ids, health_timeout)
            return {**result, "status": "unchanged", "web": web["Id"], "health": "healthy"}
        # Повторно проверяем discovery tag и оба уже загруженных immutable image IDs.
        require(image_identity(runtime.inspect_image(target))[0] == binding["web_id"], "image-tag-drift")
        require(image_identity(runtime.inspect_image_ref(binding["kp-renderer"]))[0] == binding["renderer_id"], "kp-renderer-drift")
        require(runtime.compose_config(target) == config, "compose-drift")
        changed = True
        runtime.up_pair(target, {"web": binding["web"], "kp-renderer": binding["kp-renderer"]})
        deployed = wait_healthy(desired_ids, health_timeout)
        require(runtime.compose_config(target) == config, "compose-drift")
        return {**result, "status": "deployed", "health": "healthy",
                "web": deployed["web"]["Id"]}
    except Exception:
        if changed:
            runtime.enter_pair_rollback()
            database_check()
            require(runtime.compose_config(target) == config, "kp-rollback-compose-drift")
            # Не перезаписываем чужой образ/контейнер при внешнем вмешательстве.
            for service, image in desired_ids.items():
                current = runtime.inspect_optional_container(target, service)
                if current is not None:
                    check_container(current, target, service, require_running=False)
                    require(current["Image"] in (old_ids[service], image), "kp-rollback-image-drift")
            try:
                runtime.up_pair(target, old_ids)
                if old_ids["kp-renderer"] is None:
                    runtime.remove_created_renderer(target, desired_ids["kp-renderer"], config)
                restored = wait_healthy(old_ids, min(30, health_timeout))
                context["rollback"] = "healthy"
                context.update(image=old_ids["web"], renderer=old_ids["kp-renderer"], web=restored["web"]["Id"])
            except Exception:
                context["rollback"] = "failed"
                raise WatchError("kp-pair-rollback-failed") from None
        raise
    finally:
        runtime.enter_postcheck()
        database_check()


def watch(runtime, *, health_timeout: float = 180, poll_interval: float = 3) -> dict:
    """Core: adapter нужен для локальных тестов без Docker/серверов."""
    context: dict = {}
    # W07 ждёт inner watcher 240 секунд. Сумма отдельных лимитов не является
    # общим лимитом: deadline включает pull, up, health, postcheck и cleanup CLI.
    runtime.start_deadline(200)
    try:
        return _watch(runtime, context, health_timeout, poll_interval)
    except WatchError as error:
        error.context = context
        raise
    except Exception:
        error = WatchError("unexpected-error")
        error.context = context
        raise error from None


def _watch(runtime, context: dict, health_timeout: float, poll_interval: float) -> dict:
    target = target_for(runtime.hostname(), runtime.cwd())
    context["project"] = target.project
    with runtime.lock(target) as acquired:
        if not acquired:
            return {"status": "busy", "project": target.project}
        config = runtime.compose_config(target)
        check_config(config, target)
        db_before = database_snapshot(runtime.inspect_container(target, "db"), target, config)
        web = runtime.inspect_container(target, "web")
        check_container(web, target, "web")
        context.update(image=web["Image"], web=web["Id"], health=health_status(web), database=db_before[0])

        if kp_enabled(config):
            return watch_pair(runtime, target, config, db_before, web, context, health_timeout, poll_interval)

        def check_database():
            current = database_snapshot(runtime.inspect_container(target, "db"), target, config)
            require(current == db_before, "database-drift")

        # Никакого up при ошибке pull, даже если новый образ уже есть в кеше.
        runtime.pull(target)
        desired, revision = image_identity(runtime.inspect_image(target))
        context.update(image=desired, revision=revision)
        require(runtime.compose_config(target) == config, "compose-drift")
        check_database()
        web = runtime.inspect_container(target, "web")
        check_container(web, target, "web")
        context.update(web=web["Id"], health=health_status(web))
        result = {"project": target.project, "image": desired, "revision": revision,
                  "database": db_before[0]}
        if web["Image"] == desired:
            require(health_status(web) == "healthy", "web-unhealthy")
            return {**result, "status": "unchanged", "web": web["Id"], "health": "healthy"}

        require(image_identity(runtime.inspect_image(target))[0] == desired, "image-tag-drift")
        # Повторный pull и запуск зависимостей запрещены. При любой ошибке up/health
        # БД только перечитывается; никаких автоматических restore или down.
        try:
            runtime.up(target)
            deadline = runtime.monotonic() + health_timeout
            while True:
                remaining = deadline - runtime.monotonic()
                require(remaining > 0, "web-health-timeout")
                web = runtime.inspect_container(target, "web", timeout=min(30, remaining))
                check_container(web, target, "web")
                context.update(web=web["Id"], health=health_status(web))
                require(web["Image"] == desired, "web-image-mismatch")
                if health_status(web) == "healthy":
                    break
                remaining = deadline - runtime.monotonic()
                require(remaining > 0, "web-health-timeout")
                runtime.sleep(min(poll_interval, remaining))
        finally:
            runtime.enter_postcheck()
            check_database()
        return {**result, "status": "deployed", "web": web["Id"], "health": "healthy"}


class DockerRuntime:
    def __init__(self):
        self.deadline: float | None = None
        self.postcheck_reserve = 15
        self.kp_mode = False

    def start_deadline(self, seconds: float) -> None:
        self.deadline = self.monotonic() + seconds
        self.postcheck_reserve = 15

    def enter_postcheck(self) -> None:
        self.postcheck_reserve = 0

    def reserve_pair_rollback(self) -> None:
        self.postcheck_reserve = 60  # 45 секунд image rollback + прежний postcheck.

    def enter_pair_rollback(self) -> None:
        self.postcheck_reserve = 15

    def hostname(self) -> str:
        return socket.gethostname()

    def cwd(self) -> str:
        return str(Path.cwd().resolve())

    @contextmanager
    def lock(self, target: Target):
        import fcntl  # Linux runtime; fake tests также работают на Windows.

        descriptor = os.open(f"/run/lock/pero-{target.project}-deploy.lock",
                             os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(descriptor)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                    and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
                    "unsafe-lock")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                yield False
            else:
                yield True
        finally:
            os.close(descriptor)

    def command(self, args: list[str], operation: str, *, timeout: float = 30,
                directory: str | None = None) -> str:
        if self.deadline is not None:
            # До 5 секунд на SIGKILL/reap входят в общий лимит. Последние 15
            # секунд принадлежат postcheck, а не pull/up/health.
            remaining = self.deadline - self.postcheck_reserve - self.monotonic() - 5
            require(remaining > 0, "total-deadline")
            timeout = min(timeout, remaining)
        env = os.environ.copy()
        for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
                    "COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "COMPOSE_ENV_FILES",
                    "COMPOSE_DISABLE_ENV_FILE"):
            env.pop(key, None)
        try:
            process = subprocess.Popen(args, cwd=directory, env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                       encoding="utf-8", errors="replace", start_new_session=os.name == "posix")
        except OSError:
            raise WatchError(f"{operation}-failed") from None
        try:
            output, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.kill_process_group(process)
            raise WatchError(f"{operation}-timeout") from None
        except BaseException:
            self.kill_process_group(process)
            raise
        require(process.returncode == 0, f"{operation}-failed")
        return output

    def kill_process_group(self, process) -> None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()  # Production разрешён только на Linux; Windows — тесты.
        except ProcessLookupError:
            pass
        remaining = 5 if self.deadline is None else min(5, max(0.01, self.deadline - self.monotonic()))
        try:
            process.communicate(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise WatchError("command-cleanup-timeout") from None

    def record_result(self, result: dict) -> None:
        ResultJournal().record(result)

    def compose(self, target: Target, args: list[str], operation: str, *, timeout: float = 30,
                paired: bool | None = None, pin_file: Path | None = None) -> str:
        base = Path(target.directory)
        # Явные файлы исключают поиск Compose в родительском каталоге и влияние
        # COMPOSE_FILE; существующий стандартный override обязательно сохраняется.
        for name in ("compose.yml", "compose.yaml", "docker-compose.yaml", "compose.override.yml",
                     "compose.override.yaml", "docker-compose.override.yaml"):
            require(not (base / name).exists(), "ambiguous-compose-files")
        files = [base / "docker-compose.yml"]
        override = base / "docker-compose.override.yml"
        if override.exists():
            files.append(override)
        use_kp = self.kp_mode if paired is None else paired
        if use_kp:
            files.append(base / "docker-compose.kp.yml")
        if pin_file is not None:
            require(use_kp and pin_file.parent == base and pin_file.name.startswith(".pero-kp-images-"), "kp-pin-file-path")
            files.append(pin_file)
        for path in files:
            require(path.is_file() and not path.is_symlink(), "unsafe-compose-file")
        flags = [part for path in files for part in ("-f", str(path))]
        command = DOCKER + ["compose", "--project-directory", target.directory,
                            "--project-name", target.project] + (["--profile", "kp"] if use_kp else []) + flags + args
        return self.command(command, operation, timeout=timeout, directory=target.directory)

    def compose_config(self, target: Target) -> dict:
        # В выключенном режиме выполняется тот же один config и прежние команды.
        base = json.loads(self.compose(target, ["config", "--format", "json"], "compose-config", paired=False))
        self.kp_mode = kp_enabled(base)
        return json.loads(self.compose(target, ["config", "--format", "json"], "compose-config", paired=True)) if self.kp_mode else base

    def inspect_optional_container(self, target: Target, service: str) -> dict | None:
        ids = self.compose(target, ["ps", "--all", "--quiet", service], "container-list").split()
        if not ids:
            return None
        require(len(ids) == 1 and bool(CONTAINER_RE.fullmatch(ids[0])), "container-count-mismatch")
        return self.inspect_container(target, service)

    def inspect_container(self, target: Target, service: str, *, timeout: float = 30) -> dict:
        deadline = self.monotonic() + timeout
        ids = self.compose(target, ["ps", "--all", "--quiet", service], "container-list",
                           timeout=timeout).split()
        require(len(ids) == 1 and bool(CONTAINER_RE.fullmatch(ids[0])), "container-count-mismatch")
        remaining = deadline - self.monotonic()
        require(remaining > 0, "container-inspect-timeout")
        values = json.loads(self.command(DOCKER + ["inspect", "--type", "container", ids[0]],
                                         "container-inspect", timeout=remaining))
        require(isinstance(values, list) and len(values) == 1, "container-inspect-invalid")
        return values[0]

    def inspect_image(self, target: Target) -> dict:
        values = json.loads(self.command(DOCKER + ["image", "inspect", target.image], "image-inspect"))
        require(isinstance(values, list) and len(values) == 1, "image-inspect-invalid")
        return values[0]

    def inspect_image_ref(self, reference: str) -> dict:
        require(bool(IMAGE_RE.fullmatch(reference)) or bool(re.fullmatch(
            r"ghcr\.io/navasiolau/(?:pero_crm|pero_kp_renderer)@sha256:[a-f0-9]{64}", reference)), "kp-image-reference")
        values = json.loads(self.command(DOCKER + ["image", "inspect", reference], "kp-image-inspect"))
        require(isinstance(values, list) and len(values) == 1, "image-inspect-invalid")
        return values[0]

    def pull_image_ref(self, reference: str) -> None:
        require(bool(re.fullmatch(re.escape(KP_REPOSITORY) + r"@sha256:[a-f0-9]{64}", reference)), "kp-pull-reference")
        self.command(DOCKER + ["pull", reference], "kp-renderer-pull", timeout=120)

    def up_pair(self, target: Target, references: dict) -> None:
        services = {service: {"image": reference} for service, reference in references.items() if reference is not None}
        require(self.kp_mode and "web" in services and set(services) <= {"web", "kp-renderer"}, "kp-up-services")
        for name, service in services.items():
            repository = WEB_REPOSITORY if name == "web" else KP_REPOSITORY
            require(bool(IMAGE_RE.fullmatch(service["image"])) or bool(re.fullmatch(
                re.escape(repository) + r"@sha256:[a-f0-9]{64}", service["image"])), "kp-up-immutable-reference")
        base = Path(target.directory)
        require(base.is_dir() and not base.is_symlink() and base.resolve() == base, "kp-pin-directory")
        descriptor, name = tempfile.mkstemp(prefix=".pero-kp-images-", suffix=".json", dir=base)
        temporary = Path(name)
        created = os.fstat(descriptor)
        try:
            require(temporary.resolve().parent == Path(target.directory).resolve(), "kp-pin-file-path")
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump({"services": services}, stream)
            self.compose(target, ["up", "-d", "--no-deps", "--no-build", "--pull", "never", *services],
                         "kp-pair-up", timeout=60, pin_file=temporary)
        finally:
            current = temporary.lstat()
            require(base.resolve() == base and temporary.resolve().parent == base
                    and stat.S_ISREG(current.st_mode) and not temporary.is_symlink()
                    and (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino), "kp-pin-file-drift")
            temporary.unlink()  # Только собственный exact-path override, не конфигурация сервера.

    def remove_created_renderer(self, target: Target, image: str, config: dict) -> None:
        current = self.inspect_optional_container(target, "kp-renderer")
        if current is None:
            return
        check_renderer_container(current, target, config, allow_stopped=True)
        require(current["Image"] == image, "kp-created-renderer-drift")
        self.command(DOCKER + ["rm", "--force", current["Id"]], "kp-created-renderer-remove")

    def pull(self, target: Target) -> None:
        self.compose(target, ["pull", "web"], "pull", timeout=180)

    def up(self, target: Target) -> None:
        self.compose(target, ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "web"],
                     "up", timeout=120)

    monotonic = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)


class ResultJournal:
    """W07 перехватывает stdout, поэтому итог отдельно сохраняется на сервере."""

    def __init__(self, state=Path("/var/lib/pero-crm-deploy"),
                 log=Path("/var/log/pero-crm-deploy.jsonl"), *, owner_uid=0):
        self.state, self.log, self.owner_uid = Path(state), Path(log), owner_uid

    def check_file(self, info) -> None:
        require(stat.S_ISREG(info.st_mode) and info.st_uid == self.owner_uid
                and info.st_nlink == 1, "unsafe-journal-file")
        if os.name == "posix":
            require(stat.S_IMODE(info.st_mode) == 0o600, "unsafe-journal-mode")

    def record(self, result: dict) -> None:
        self.state.mkdir(mode=0o700, exist_ok=True)
        info = self.state.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.owner_uid,
                "unsafe-journal-directory")
        if os.name == "posix":
            require(stat.S_IMODE(info.st_mode) == 0o700, "unsafe-journal-directory-mode")
        snapshot = self.state / "result.json"
        if snapshot.exists() or snapshot.is_symlink():
            self.check_file(snapshot.lstat())
        entry = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), **result}
        content = (json.dumps(entry, ensure_ascii=False) + "\n").encode("utf-8")
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.log, flags, 0o600)
        with os.fdopen(fd, "ab") as stream:
            self.check_file(os.fstat(stream.fileno()))
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        fd, temporary = tempfile.mkstemp(prefix=".result-", dir=self.state)
        try:
            with os.fdopen(fd, "wb") as stream:
                self.check_file(os.fstat(stream.fileno()))
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, snapshot)
            if os.name == "posix":
                directory_fd = os.open(self.state, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)  # Только собственный временный snapshot.


def run(runtime, emit=print) -> int:
    try:
        result = watch(runtime)
    except WatchError as error:
        result = {**error.context, "status": "error", "error": error.code}
    except Exception:
        # Traceback/config/stderr могут содержать пароли, поэтому только код.
        result = {"status": "error", "error": "unexpected-error"}
    # Не создавать журнал на произвольном хосте/в неверном каталоге.
    if result.get("project") in ("crm", "crm-staging"):
        try:
            runtime.record_result(result)
        except (WatchError, OSError):
            result = {**result, "status": "error", "error": result.get("error", "journal-failed"),
                      "journal_error": "journal-failed"}
    emit(result)
    return 1 if result["status"] == "error" else 0


def main() -> int:
    def emit(result):
        print(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), **result},
                         ensure_ascii=False), flush=True)

    return run(DockerRuntime(), emit)


if __name__ == "__main__":
    raise SystemExit(main())
