"""Fake Docker acceptance; never contacts Docker or a server.

--legacy-baseline runs the regression against the old source algorithm confirmed
by the root agent's live read on 2026-09-28. It is not a live execution test.
"""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


OLD_IMAGE = "sha256:" + "1" * 64
NEW_IMAGE = "sha256:" + "2" * 64
DB_IMAGE = "sha256:" + "3" * 64
REVISION = "a" * 40
LEGACY_BASELINE = "--legacy-baseline" in sys.argv
if LEGACY_BASELINE:
    sys.argv.remove("--legacy-baseline")
    watcher = None
else:
    spec = importlib.util.spec_from_file_location(
        "watch_crm", Path(__file__).resolve().parents[1] / "watch-crm.py"
    )
    watcher = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = watcher
    spec.loader.exec_module(watcher)


def container(project, service, image):
    return {
        "Id": ("4" if service == "db" else "5") * 64,
        "Name": f"/{project}-{service}-1",
        "Image": image,
        "Config": {"Labels": {
            "com.docker.compose.project": project,
            "com.docker.compose.service": service,
            "com.docker.compose.project.working_dir": f"/opt/{project}",
        }},
        "State": {"Running": True, "Status": "running", "Health": {"Status": "healthy"}},
        "Mounts": [{
            "Type": "volume", "Name": f"{project}_pgdata",
            "Source": f"/var/lib/docker/volumes/{project}_pgdata/_data",
            "Destination": "/var/lib/postgresql/data", "RW": True,
        }] if service == "db" else [],
    }


class FakeRuntime:
    def __init__(self, project="crm-staging"):
        self.host = project
        self.directory = f"/opt/{project}"
        tag = "main" if project == "crm" else "staging"
        self.image_ref = f"ghcr.io/navasiolau/pero_crm:{tag}"
        self.configuration = {
            "name": project,
            "services": {
                "web": {"image": self.image_ref,
                        "healthcheck": {"test": ["CMD", "node", "health.js"]}},
                "db": {"image": "postgres:17-alpine", "volumes": [{
                    "type": "volume", "source": "pgdata",
                    "target": "/var/lib/postgresql/data",
                }]},
            },
            "volumes": {"pgdata": {"name": f"{project}_pgdata"}},
        }
        self.web = container(project, "web", OLD_IMAGE)
        self.db = container(project, "db", DB_IMAGE)
        self.local_image = NEW_IMAGE
        self.registry_image = NEW_IMAGE
        self.calls = []
        self.busy = False
        self.pull_error = False
        self.up_error = False
        self.after_pull = lambda: None
        self.after_up = lambda: None
        self.health_states = []
        self.now = 0
        self.deadline = None
        self.reserve = 15
        self.records = []

    def start_deadline(self, seconds):
        self.deadline = self.now + seconds

    def enter_postcheck(self):
        self.reserve = 0

    def record_result(self, result):
        self.records.append(copy.deepcopy(result))

    def check_budget(self):
        if self.deadline is not None and self.now >= self.deadline - self.reserve - 5:
            raise watcher.WatchError("total-deadline")

    def hostname(self):
        return self.host

    def cwd(self):
        return self.directory

    @contextlib.contextmanager
    def lock(self, target):
        self.calls.append("lock")
        yield not self.busy

    def compose_config(self, target):
        self.check_budget()
        self.calls.append("config")
        return copy.deepcopy(self.configuration)

    def inspect_container(self, target, service, *, timeout=30):
        self.check_budget()
        self.calls.append(f"inspect:{service}")
        if service == "web" and "up:web" in self.calls and self.health_states:
            self.web["State"]["Health"]["Status"] = self.health_states.pop(0)
        return copy.deepcopy(self.web if service == "web" else self.db)

    def inspect_image(self, target):
        self.check_budget()
        self.calls.append("image")
        return {"Id": self.local_image,
                "Config": {"Labels": {"org.opencontainers.image.revision": REVISION}}}

    def pull(self, target):
        self.check_budget()
        self.calls.append("pull:web")
        if self.pull_error:
            raise watcher.WatchError("pull-failed")
        self.local_image = self.registry_image
        self.after_pull()

    def up(self, target):
        self.check_budget()
        self.calls.append("up:web")
        if self.up_error:
            raise watcher.WatchError("up-failed")
        self.web["Image"] = self.local_image
        self.web["Id"] = "6" * 64
        self.after_up()

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def legacy_watch(runtime):
    """Exact relevant before/pull/after decision from the read-only source read."""
    before = runtime.inspect_image(None)["Id"]
    runtime.pull(None)
    after = runtime.inspect_image(None)["Id"]
    if after and before != after:
        runtime.up(None)
        return {"status": "deployed"}
    return {"status": "unchanged"}


class ImageRegressionTests(unittest.TestCase):
    def run_watcher(self, runtime):
        return legacy_watch(runtime) if LEGACY_BASELINE else watcher.watch(runtime)

    def test_pre_pulled_image_still_replaces_old_running_web(self):
        runtime = FakeRuntime()
        self.run_watcher(runtime)
        self.assertEqual(runtime.web["Image"], NEW_IMAGE,
                         "Cached tag already changed, but the running web is still old")
        self.assertEqual(runtime.calls.count("up:web"), 1)

    def test_pre_pulled_image_already_running_is_unchanged(self):
        runtime = FakeRuntime()
        runtime.web["Image"] = NEW_IMAGE
        result = self.run_watcher(runtime)
        self.assertEqual(result["status"], "unchanged")
        self.assertNotIn("up:web", runtime.calls)


@unittest.skipIf(LEGACY_BASELINE, "The historical source model only covers image selection")
class WatcherTests(unittest.TestCase):
    def assert_refused(self, runtime, code=None):
        with self.assertRaises(watcher.WatchError) as caught:
            watcher.watch(runtime, health_timeout=3, poll_interval=1)
        if code:
            self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_new_registry_image_deploys_and_reports_revision(self):
        runtime = FakeRuntime("crm")
        runtime.local_image = OLD_IMAGE
        result = watcher.watch(runtime)
        self.assertEqual(result["status"], "deployed")
        self.assertEqual(result["image"], NEW_IMAGE)
        self.assertEqual(result["revision"], REVISION)
        self.assertEqual(result["project"], "crm")
        self.assertEqual(runtime.calls.count("pull:web"), 1)
        self.assertEqual(runtime.db["Id"], "4" * 64)

    def test_wrong_host_or_directory_never_calls_docker(self):
        for host, directory in [("pve", "/opt/crm"), ("crm", "/opt/crm-staging"),
                                ("crm-staging", "/tmp/crm-staging"), ("crm.example", "/opt/crm")]:
            with self.subTest(host=host, directory=directory):
                runtime = FakeRuntime()
                runtime.host, runtime.directory = host, directory
                self.assert_refused(runtime, "target-mismatch")
                self.assertEqual(runtime.calls, [])

    def test_invalid_compose_refuses_before_pull(self):
        changes = [
            lambda c: c.update(name="other"),
            lambda c: c["services"]["web"].update(image=OLD_IMAGE),
            lambda c: c["services"]["web"].update(pull_policy="never"),
            lambda c: c["services"]["web"].update(build={"context": "."}),
            lambda c: c["services"]["web"].update(healthcheck={"disable": True}),
            lambda c: c["services"]["web"].update(healthcheck={"test": ["NONE"]}),
        ]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                runtime = FakeRuntime()
                change(runtime.configuration)
                self.assert_refused(runtime)
                self.assertNotIn("pull:web", runtime.calls)

    def test_container_identity_and_data_mount_are_required(self):
        for service in ("web", "db"):
            for label in ("com.docker.compose.project", "com.docker.compose.service",
                          "com.docker.compose.project.working_dir"):
                with self.subTest(service=service, label=label):
                    runtime = FakeRuntime()
                    getattr(runtime, service)["Config"]["Labels"][label] = "wrong"
                    self.assert_refused(runtime)
                    self.assertNotIn("pull:web", runtime.calls)
        runtime = FakeRuntime()
        runtime.db["Mounts"] = []
        self.assert_refused(runtime)
        self.assertNotIn("pull:web", runtime.calls)

    def test_stopped_web_or_unhealthy_database_are_not_restarted(self):
        for service in ("web", "db"):
            runtime = FakeRuntime()
            getattr(runtime, service)["State"]["Running"] = False
            self.assert_refused(runtime)
            self.assertNotIn("pull:web", runtime.calls)
        runtime = FakeRuntime()
        runtime.db["State"]["Health"]["Status"] = "unhealthy"
        self.assert_refused(runtime)
        self.assertNotIn("pull:web", runtime.calls)

    def test_parallel_watcher_is_noop(self):
        runtime = FakeRuntime()
        runtime.busy = True
        self.assertEqual(watcher.watch(runtime)["status"], "busy")
        self.assertEqual(runtime.calls, ["lock"])

    def test_pull_failure_preserves_running_container(self):
        runtime = FakeRuntime()
        runtime.pull_error = True
        self.assert_refused(runtime, "pull-failed")
        self.assertEqual(runtime.web["Image"], OLD_IMAGE)
        self.assertNotIn("up:web", runtime.calls)

    def test_compose_change_during_pull_refuses_up(self):
        runtime = FakeRuntime()
        runtime.after_pull = lambda: runtime.configuration["services"]["web"].update(
            environment={"INJECTED": "changed"})
        self.assert_refused(runtime, "compose-drift")
        self.assertNotIn("up:web", runtime.calls)

    def test_db_change_during_pull_refuses_up(self):
        runtime = FakeRuntime()
        runtime.after_pull = lambda: runtime.db.update(Id="7" * 64)
        self.assert_refused(runtime, "database-drift")
        self.assertNotIn("up:web", runtime.calls)

    def test_db_identity_or_mount_change_during_up_is_an_error(self):
        for change in (lambda r: r.db.update(Id="7" * 64),
                       lambda r: r.db["Mounts"][0].update(Name="other-data")):
            runtime = FakeRuntime()
            runtime.after_up = lambda: change(runtime)
            self.assert_refused(runtime)
            self.assertEqual(runtime.calls.count("up:web"), 1)
            self.assertTrue(all(call in ("pull:web", "up:web")
                                for call in runtime.calls if call.startswith(("pull:", "up:"))))

    def test_failed_up_checks_database_and_does_not_restore(self):
        runtime = FakeRuntime()
        runtime.up_error = True
        self.assert_refused(runtime, "up-failed")
        self.assertIn("inspect:db", runtime.calls[runtime.calls.index("up:web") + 1:])
        self.assertEqual(runtime.calls.count("up:web"), 1)

    def test_health_wait_is_bounded_and_accepts_starting_then_healthy(self):
        runtime = FakeRuntime()
        runtime.health_states = ["starting", "starting", "healthy"]
        self.assertEqual(watcher.watch(runtime, health_timeout=3, poll_interval=1)["status"], "deployed")
        self.assertEqual(runtime.now, 2)
        runtime = FakeRuntime()
        runtime.after_up = lambda: runtime.web["State"]["Health"].update(Status="unhealthy")
        self.assert_refused(runtime, "web-health-timeout")
        self.assertEqual(runtime.now, 3)
        self.assertEqual(runtime.calls.count("up:web"), 1)

    def test_wrong_image_after_up_is_not_reported_successful(self):
        runtime = FakeRuntime()
        runtime.after_up = lambda: runtime.web.update(Image=OLD_IMAGE)
        self.assert_refused(runtime, "web-image-mismatch")

    def test_same_image_unhealthy_does_not_recreate(self):
        runtime = FakeRuntime()
        runtime.web["Image"] = NEW_IMAGE
        runtime.web["State"]["Health"]["Status"] = "unhealthy"
        self.assert_refused(runtime, "web-unhealthy")
        self.assertNotIn("up:web", runtime.calls)

    def test_error_output_does_not_contain_arbitrary_exception_text(self):
        runtime = FakeRuntime()
        runtime.compose_config = lambda target: (_ for _ in ()).throw(
            RuntimeError("DB_PASSWORD=do-not-log-this"))
        events = []
        self.assertEqual(watcher.run(runtime, events.append), 1)
        self.assertEqual(events[-1]["error"], "unexpected-error")
        self.assertNotIn("do-not-log", json.dumps(events))

    def test_health_error_includes_safe_image_and_status(self):
        runtime = FakeRuntime()
        runtime.web["Image"] = NEW_IMAGE
        runtime.web["State"]["Health"]["Status"] = "unhealthy"
        events = []
        self.assertEqual(watcher.run(runtime, events.append), 1)
        self.assertEqual(events[-1]["image"], NEW_IMAGE)
        self.assertEqual(events[-1]["health"], "unhealthy")
        self.assertEqual(events[-1]["project"], "crm-staging")

    def test_tag_change_before_up_is_refused(self):
        runtime = FakeRuntime()
        original_inspect = runtime.inspect_image

        def changing_image(target):
            result = original_inspect(target)
            runtime.local_image = OLD_IMAGE
            return result

        runtime.inspect_image = changing_image
        self.assert_refused(runtime, "image-tag-drift")
        self.assertNotIn("up:web", runtime.calls)

    def test_total_budget_refuses_up_even_when_per_command_budgets_would_allow_it(self):
        runtime = FakeRuntime()
        runtime.after_pull = lambda: setattr(runtime, "now", 181)
        self.assert_refused(runtime, "total-deadline")
        self.assertNotIn("up:web", runtime.calls)

    def test_error_is_recorded_even_when_outer_controller_captures_stdout(self):
        runtime = FakeRuntime()
        runtime.web["Image"] = NEW_IMAGE
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(watcher.run(runtime), 0)
        self.assertEqual(runtime.records[-1]["status"], "unchanged")
        self.assertEqual(runtime.records[-1]["image"], NEW_IMAGE)


@unittest.skipIf(LEGACY_BASELINE, "Runtime adapter is new")
class DockerAdapterTests(unittest.TestCase):
    def test_subprocess_errors_and_timeouts_do_not_leak_output(self):
        runtime = watcher.DockerRuntime()
        with self.assertRaises(watcher.WatchError) as caught:
            runtime.command([sys.executable, "-c", "import sys; print('secret', file=sys.stderr); sys.exit(2)"],
                            "probe", timeout=2)
        self.assertEqual(caught.exception.code, "probe-failed")
        self.assertNotIn("secret", str(caught.exception))

    def test_total_deadline_limits_command_and_reserves_child_cleanup(self):
        runtime = watcher.DockerRuntime()
        with patch.object(runtime, "monotonic", return_value=0):
            runtime.start_deadline(200)
        with patch.object(runtime, "monotonic", return_value=170), patch.object(
                subprocess, "Popen") as popen:
            popen.return_value.communicate.return_value = ("ok", "")
            popen.return_value.returncode = 0
            runtime.command(["docker", "info"], "probe", timeout=180)
        self.assertEqual(popen.return_value.communicate.call_args.kwargs["timeout"], 10)

    @unittest.skipUnless(sys.platform == "linux", "POSIX process-group proof runs in Linux CI")
    def test_timeout_kills_cli_descendants_before_returning(self):
        runtime = watcher.DockerRuntime()
        with tempfile.TemporaryDirectory() as directory:
            pid_path = Path(directory) / "child.pid"
            # Потомок наследует stdout/stderr и игнорирует SIGTERM.
            child = "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)"
            script = ("import pathlib,subprocess,sys,time; "
                      f"p=subprocess.Popen([sys.executable,'-c',{child!r}]); "
                      f"pathlib.Path({str(pid_path)!r}).write_text(str(p.pid)); time.sleep(30)")
            started = time.monotonic()
            with self.assertRaises(watcher.WatchError) as caught:
                runtime.command([sys.executable, "-c", script], "tree", timeout=1)
            self.assertEqual(caught.exception.code, "tree-timeout")
            self.assertLess(time.monotonic() - started, 7)
            child_pid = int(pid_path.read_text())
            state = Path(f"/proc/{child_pid}/stat")
            deadline = time.monotonic() + 1
            while state.exists() and state.read_text().split()[2] != "Z" and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(not state.exists() or state.read_text().split()[2] == "Z",
                            "Child must be dead before W07 can release its lock")

    def test_up_never_pulls_builds_or_touches_dependencies(self):
        runtime = watcher.DockerRuntime()
        target = watcher.target_for("crm-staging", "/opt/crm-staging")
        with patch.object(runtime, "compose", return_value="") as compose:
            runtime.up(target)
        args = compose.call_args.args[1]
        self.assertEqual(args, ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "web"])

    def test_compose_uses_local_socket_and_preserves_standard_override(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "docker-compose.yml").write_text("services: {}", encoding="utf-8")
            (base / "docker-compose.override.yml").write_text("services: {}", encoding="utf-8")
            runtime = watcher.DockerRuntime()
            target = watcher.Target("crm", str(base), "ghcr.io/navasiolau/pero_crm:main")
            with patch.object(runtime, "command", return_value="{}") as command:
                runtime.compose_config(target)
            args = command.call_args.args[0]
            self.assertEqual(args[:3], ["docker", "--host", "unix:///var/run/docker.sock"])
            self.assertIn(str(base / "docker-compose.yml"), args)
            self.assertIn(str(base / "docker-compose.override.yml"), args)
            self.assertEqual(args[-3:], ["config", "--format", "json"])

    def test_inspection_passes_only_remaining_time_to_second_command(self):
        runtime = watcher.DockerRuntime()
        target = watcher.target_for("crm", "/opt/crm")
        with patch.object(runtime, "compose", return_value="4" * 64), patch.object(
                runtime, "command", return_value=json.dumps([container("crm", "db", DB_IMAGE)])) as command, \
                patch.object(runtime, "monotonic", side_effect=[10, 17]):
            runtime.inspect_container(target, "db", timeout=12)
        self.assertEqual(command.call_args.kwargs["timeout"], 5)


@unittest.skipIf(LEGACY_BASELINE, "Protected journal is new")
class ResultJournalTests(unittest.TestCase):
    def test_captured_stdout_does_not_remove_persistent_result(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            journal = watcher.ResultJournal(base / "state", base / "result.jsonl",
                                            owner_uid=os.getuid() if hasattr(os, "getuid") else 0)
            result = {"status": "unchanged", "project": "crm-staging", "image": NEW_IMAGE}
            with contextlib.redirect_stdout(io.StringIO()):
                journal.record(result)
                journal.record({**result, "status": "deployed"})
            lines = [json.loads(line) for line in (base / "result.jsonl").read_text().splitlines()]
            self.assertEqual([item["status"] for item in lines], ["unchanged", "deployed"])
            self.assertEqual(json.loads((base / "state" / "result.json").read_text())["status"], "deployed")

    @unittest.skipUnless(sys.platform == "linux", "POSIX file modes are enforced by the Linux runtime")
    def test_unsafe_journal_permissions_are_refused_without_appending(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            log = base / "result.jsonl"
            log.write_text("preserve")
            log.chmod(0o644)
            journal = watcher.ResultJournal(base / "state", log, owner_uid=os.getuid())
            with self.assertRaises(watcher.WatchError):
                journal.record({"status": "unchanged"})
            self.assertEqual(log.read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
