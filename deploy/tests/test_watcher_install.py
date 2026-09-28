"""Pure transformations only: these tests never install files or run Docker."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("install_crm_watcher", Path(__file__).resolve().parents[1] / "install-crm-watcher.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class RestorePinTests(unittest.TestCase):
    def test_only_the_owned_watcher_line_is_resumed(self):
        original = ("# pero-crm-auth-20260922 PAUSED: */5 * * * * root /opt/crm/watch-prod.sh\n"
                    "# PERO retired legacy heartbeat: * * * * * root /opt/crm/heartbeat.sh\n"
                    "MAILTO=root\n").encode()
        result = installer.active_cron(original, "/opt/crm/watch-prod.sh")
        self.assertEqual(result, ("*/5 * * * * root /opt/crm/watch-prod.sh\n"
                                 "# PERO retired legacy heartbeat: * * * * * root /opt/crm/heartbeat.sh\n"
                                 "MAILTO=root\n").encode())

    def test_wrong_environment_and_active_or_duplicate_jobs_refuse(self):
        line = b"# pero-crm-auth-20260922 PAUSED: */5 * * * * root /opt/crm/watch-prod.sh\n"
        for content in (b"", line + line, line + b"*/5 * * * * root /opt/crm/watch-prod.sh\n"):
            with self.subTest(content=content), self.assertRaises(RuntimeError):
                installer.active_cron(content, "/opt/crm/watch-prod.sh")
        with self.assertRaises(RuntimeError):
            installer.active_cron(line, "/opt/crm-staging/watch-staging.sh")

    def test_extra_shell_action_is_not_silently_enabled(self):
        line = b"# pero-crm-auth-20260922 PAUSED: */5 * * * * root /opt/crm/watch-prod.sh && cleanup.sh\n"
        with self.assertRaises(RuntimeError):
            installer.active_cron(line, "/opt/crm/watch-prod.sh")

    def test_unpin_keeps_all_healthchecks_and_proxy_configuration(self):
        prefix = b"# original\nservices:\n  web:\n"
        pin = ("    image: " + installer.PIN + "\n    pull_policy: never\n").encode()
        tail = b"    healthcheck:\n      test: [CMD, node, health.js]\n  proxy:\n    depends_on:\n      web:\n        condition: service_healthy\n"
        self.assertEqual(installer.unpinned_override(prefix + pin + tail), prefix + tail)

    def test_another_image_or_missing_policy_cannot_be_unpinned(self):
        original = ("services:\n  web:\n    image: " + installer.PIN + "\n    pull_policy: never\n    healthcheck:\n      test: [CMD, check]\n").encode()
        for content in (original.replace(installer.PIN.encode(), b"ghcr.io/something:unknown"),
                        original.replace(b"    pull_policy: never\n", b""), b"services: {}\n"):
            with self.subTest(content=content), self.assertRaises(RuntimeError):
                installer.unpinned_override(content)


class ActivationTests(unittest.TestCase):
    def fixture(self, failure=None):
        cron, journal = Path("/fixture/cron"), Path("/fixture/journal")
        state = {cron: b"paused\n", journal / "receipt.json": b'{"phase":"prepared"}'}
        calls = []
        def write(path, data, mode):
            calls.append((path, data))
            if failure == "before-cron-replace" and path == cron:
                raise OSError("injected failure")
            state[path] = data
            if failure == "after-cron-replace" and path == cron:
                raise OSError("injected fsync failure")
            if failure == "final-receipt" and path != cron and json.loads(data)["phase"] == "activated":
                raise OSError("injected receipt failure")
        def read(path):
            return state[path], 0o600
        return cron, journal, state, calls, write, read

    def test_activation_intent_precedes_cron_and_final_receipt(self):
        cron, journal, state, calls, write, read = self.fixture()
        installer.activate_cron(cron, b"active\n", 0o644, journal, {"phase":"prepared"}, write, read)
        self.assertEqual([p for p, _ in calls], [journal / "receipt.json", cron, journal / "receipt.json"])
        self.assertEqual(json.loads(calls[0][1])["phase"], "activation-intent")
        self.assertEqual(state[cron], b"active\n")

    def test_failure_paths_report_observed_cron_and_never_claim_paused(self):
        for failure in ("before-cron-replace", "after-cron-replace", "final-receipt"):
            with self.subTest(failure=failure):
                cron, journal, state, calls, write, read = self.fixture(failure)
                with self.assertRaises(installer.ActivationUnknown) as caught:
                    installer.activate_cron(cron, b"active\n", 0o644, journal, {"phase":"prepared"}, write, read)
                self.assertEqual(caught.exception.details["status"], "activation-unknown")
                self.assertEqual(caught.exception.details["cronSha256"], installer.sha(state[cron]))
                self.assertEqual(caught.exception.details["activeCronObserved"], failure != "before-cron-replace")
                self.assertEqual(sum(p == cron for p, _ in calls), 1, "must not blindly roll cron back")
