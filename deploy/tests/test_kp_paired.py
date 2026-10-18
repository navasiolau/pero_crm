"""Парный deploy: fake Docker, никакого доступа к серверам/БД/контейнерам."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from test_watch_crm import FakeRuntime, container, watcher, OLD_IMAGE, NEW_IMAGE, REVISION

OLD_RENDERER = "sha256:" + "7" * 64
NEW_RENDERER = "sha256:" + "8" * 64
OLD_ROOT = "sha256:" + "9" * 64
NEW_ROOT = "sha256:" + "a" * 64


def image_record(image, revision, service, root, *, renderer_root=None, run="18"):
    repository = watcher.WEB_REPOSITORY if service == "web" else watcher.KP_REPOSITORY
    labels = {"org.opencontainers.image.revision": revision, "pero.ci.service": service,
              "pero.ci.repository": "navasiolau/pero_crm", "pero.ci.run": run, "pero.ci.attempt": "1",
              "pero.kp.protocol": "1", "pero.kp.template": "b" * 64, "pero.kp.source": "c" * 64,
              "pero.kp.fonts": "d" * 64, "pero.kp.chromium": "141.0.0", "pero.kp.puppeteer": "24.43.1"}
    if renderer_root:
        labels["pero.kp.renderer-index"] = renderer_root
    return {"Id": image, "RepoDigests": [f"{repository}@{root}"], "Config": {"Labels": labels}}


class PairedRuntime(FakeRuntime):
    def __init__(self, *, first=False):
        super().__init__()
        secret = "SYNTHETIC_PAIRED_DEPLOY_TEST_SECRET_ONLY"
        self.configuration["services"]["web"].update(environment={"PERO_KP_ENABLED": "1", "PERO_KP_RENDERER_SECRET": secret}, networks={"kp_render": {}})
        self.configuration["services"]["kp-renderer"] = {"image": watcher.KP_REPOSITORY + ":staging", "profiles": ["kp"], "read_only": True,
            "mem_limit": "1536m", "cpus": 1.0, "pids_limit": 128, "tmpfs": ["/tmp:rw,nosuid,exec,size=512m,mode=1777"],
            "networks": {"kp_render": {}}, "environment": {"PERO_KP_RENDERER_SECRET": secret}}
        self.configuration["networks"] = {"kp_render": {"name": "crm-staging_kp_render", "internal": True}}
        self.renderer = self.make_renderer(OLD_RENDERER) if not first else None
        self.images = {
            OLD_IMAGE: image_record(OLD_IMAGE, "b" * 40, "web", "sha256:" + "1" * 64, renderer_root=OLD_ROOT, run="17"),
            OLD_RENDERER: image_record(OLD_RENDERER, "b" * 40, "kp-renderer", OLD_ROOT, run="17"),
            NEW_IMAGE: image_record(NEW_IMAGE, REVISION, "web", "sha256:" + "2" * 64, renderer_root=NEW_ROOT),
            NEW_RENDERER: image_record(NEW_RENDERER, REVISION, "kp-renderer", NEW_ROOT),
        }
        for value in list(self.images.values()):
            self.images[value["RepoDigests"][0]] = value
        self.pairs, self.removed = [], []
        self.renderer_available = True
        self.fail_new = False
        self.fail_web_new = False
        self.after_renderer_pull = lambda: None

    def make_renderer(self, image):
        result = container(self.host, "kp-renderer", image)
        result["Id"] = "9" * 64
        result["Config"]["User"] = "node"
        result["HostConfig"] = {"ReadonlyRootfs": True, "Memory": 1536 * 1024 * 1024, "NanoCpus": 1_000_000_000,
            "PidsLimit": 128, "Tmpfs": {"/tmp": "rw,nosuid,exec,size=512m,mode=1777"}, "NetworkMode": "crm-staging_kp_render"}
        result["NetworkSettings"] = {"Networks": {"crm-staging_kp_render": {}}}
        return result

    def reserve_pair_rollback(self):
        self.reserve = 60

    def enter_pair_rollback(self):
        self.reserve = 15

    def inspect_image(self, target):
        self.calls.append("image")
        return copy.deepcopy(self.images[self.local_image])

    def inspect_image_ref(self, reference):
        self.calls.append("image-ref")
        return copy.deepcopy(self.images[reference])

    def pull_image_ref(self, reference):
        self.calls.append("pull:renderer")
        if not self.renderer_available:
            raise watcher.WatchError("kp-renderer-pull-failed")
        assert reference == watcher.KP_REPOSITORY + "@" + NEW_ROOT
        self.after_renderer_pull()

    def inspect_optional_container(self, target, service):
        self.check_budget()
        if service == "kp-renderer":
            return copy.deepcopy(self.renderer)
        return self.inspect_container(target, service)

    def inspect_container(self, target, service, *, timeout=30):
        if service == "kp-renderer":
            self.check_budget()
            self.calls.append("inspect:kp-renderer")
            return copy.deepcopy(self.renderer)
        return super().inspect_container(target, service, timeout=timeout)

    def up_pair(self, target, references):
        self.check_budget()
        self.pairs.append(copy.deepcopy(references))
        self.calls.append("up:pair")
        self.web["Image"] = self.images[references["web"]]["Id"]
        self.web["Id"] = "6" * 64
        self.web["State"]["Health"]["Status"] = "healthy"
        if self.fail_web_new and self.web["Image"] == NEW_IMAGE:
            self.web["State"]["Health"]["Status"] = "unhealthy"
        if references["kp-renderer"] is not None:
            self.renderer = self.make_renderer(self.images[references["kp-renderer"]]["Id"])
            if self.fail_new and self.renderer["Image"] == NEW_RENDERER:
                self.renderer["State"].update(Running=False, Health={"Status": "unhealthy"})

    def remove_created_renderer(self, target, image, config):
        assert self.renderer["Image"] == image
        self.removed.append(self.renderer["Id"])
        self.renderer = None


class PairedDeployTests(unittest.TestCase):
    def test_non_executable_or_unbounded_tmpfs_refuses_before_pull_or_up(self):
        for flags in ("rw,nosuid,size=512m,mode=1777", "rw,nosuid,noexec,size=512m,mode=1777",
                      "rw,nosuid,exec,noexec,size=512m,mode=1777", "rw,nosuid,exec,size=1g,mode=1777",
                      "rw,nosuid,exec,size=512m,mode=0777"):
            with self.subTest(flags=flags):
                runtime = PairedRuntime()
                runtime.configuration["services"]["kp-renderer"]["tmpfs"] = ["/tmp:" + flags]
                with self.assertRaisesRegex(watcher.WatchError, "kp-compose-tmpfs"):
                    watcher.watch(runtime)
                self.assertEqual(runtime.pairs, [])
                self.assertNotIn("pull:renderer", runtime.calls)

    def test_current_renderer_requires_executable_tmpfs_and_accepts_reordered_flags(self):
        for flags in ("rw,nosuid,size=512m,mode=1777", "rw,nosuid,exec,noexec,size=512m,mode=1777"):
            runtime = PairedRuntime()
            runtime.renderer["HostConfig"]["Tmpfs"]["/tmp"] = flags
            with self.assertRaisesRegex(watcher.WatchError, "kp-container-tmpfs"):
                watcher.watch(runtime)
            self.assertEqual(runtime.pairs, [])
        runtime = PairedRuntime()
        reordered = "mode=1777,exec,size=512m,rw,nosuid"
        runtime.configuration["services"]["kp-renderer"]["tmpfs"] = ["/tmp:" + reordered]
        runtime.renderer["HostConfig"]["Tmpfs"]["/tmp"] = reordered
        self.assertEqual(watcher.watch(runtime)["status"], "deployed")

    def test_disabled_flag_preserves_legacy_web_only_behavior(self):
        runtime = PairedRuntime()
        runtime.configuration["services"]["web"]["environment"]["PERO_KP_ENABLED"] = "0"
        self.assertEqual(watcher.watch(runtime)["status"], "deployed")
        self.assertEqual(runtime.calls.count("up:web"), 1)
        self.assertNotIn("pull:renderer", runtime.calls)
        self.assertEqual(runtime.pairs, [])

    def test_paired_update_resolves_immutable_images_of_same_release(self):
        runtime = PairedRuntime()
        db = copy.deepcopy(runtime.db)
        result = watcher.watch(runtime)
        self.assertEqual(result["status"], "deployed")
        self.assertEqual(runtime.pairs, [{"web": watcher.WEB_REPOSITORY + "@sha256:" + "2" * 64, "kp-renderer": watcher.KP_REPOSITORY + "@" + NEW_ROOT}])
        self.assertEqual((runtime.web["Image"], runtime.renderer["Image"]), (NEW_IMAGE, NEW_RENDERER))
        self.assertEqual(runtime.db, db)

    def test_partial_registry_publication_changes_neither_running_service(self):
        runtime = PairedRuntime()
        runtime.renderer_available = False
        with self.assertRaisesRegex(watcher.WatchError, "kp-renderer-pull-failed"):
            watcher.watch(runtime)
        self.assertEqual(runtime.pairs, [])
        self.assertEqual((runtime.web["Image"], runtime.renderer["Image"]), (OLD_IMAGE, OLD_RENDERER))

    def test_binding_mismatch_and_recreated_container_refuse_before_up(self):
        for change, code in [(lambda r: r.images[NEW_RENDERER]["Config"]["Labels"].update({"pero.kp.fonts": "f" * 64}), "kp-template-binding"),
                             (lambda r: setattr(r, "after_pull", lambda: r.web.update(Id="f" * 64)), "kp-container-drift"),
                             (lambda r: setattr(r, "after_renderer_pull", lambda: setattr(r, "local_image", OLD_IMAGE)), "image-tag-drift")]:
            runtime = PairedRuntime()
            change(runtime)
            with self.assertRaisesRegex(watcher.WatchError, code):
                watcher.watch(runtime)
            self.assertEqual(runtime.pairs, [])

    def test_crashed_new_renderer_rolls_back_both_images_without_db_changes(self):
        runtime = PairedRuntime()
        runtime.fail_new = True
        db = copy.deepcopy(runtime.db)
        with self.assertRaises(watcher.WatchError) as caught:
            watcher.watch(runtime)
        self.assertEqual(caught.exception.context["rollback"], "healthy")
        self.assertEqual(caught.exception.context["web"], runtime.web["Id"])
        self.assertEqual(runtime.pairs[-1], {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER})
        self.assertEqual((runtime.web["Image"], runtime.renderer["Image"]), (OLD_IMAGE, OLD_RENDERER))
        self.assertEqual(runtime.db, db)

    def test_failed_web_health_also_rolls_back_both_images(self):
        runtime = PairedRuntime()
        runtime.fail_web_new = True
        with self.assertRaisesRegex(watcher.WatchError, "kp-pair-unhealthy") as caught:
            watcher.watch(runtime)
        self.assertEqual(caught.exception.context["rollback"], "healthy")
        self.assertEqual(runtime.pairs[-1], {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER})

    def test_first_activation_failure_restores_web_and_removes_only_new_renderer(self):
        runtime = PairedRuntime(first=True)
        runtime.fail_new = True
        with self.assertRaises(watcher.WatchError):
            watcher.watch(runtime)
        self.assertEqual(runtime.web["Image"], OLD_IMAGE)
        self.assertIsNone(runtime.renderer)
        self.assertEqual(runtime.removed, ["9" * 64])

    def test_first_activation_creates_only_the_private_renderer_and_updates_the_pair(self):
        runtime = PairedRuntime(first=True)
        self.assertEqual(watcher.watch(runtime)["status"], "deployed")
        self.assertEqual(runtime.renderer["Image"], NEW_RENDERER)
        self.assertEqual(runtime.removed, [])

    def test_adapter_enables_profile_only_after_reading_explicit_base_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name in ("docker-compose.yml", "docker-compose.override.yml", "docker-compose.kp.yml"):
                (base / name).write_text("services: {}", encoding="utf-8")
            runtime = watcher.DockerRuntime()
            target = watcher.Target("crm-staging", directory, watcher.WEB_REPOSITORY + ":staging")
            base_config = {"services": {"web": {"environment": {"PERO_KP_ENABLED": "1"}}}}
            full = PairedRuntime().configuration
            with patch.object(runtime, "command", side_effect=[json.dumps(base_config), json.dumps(full)]) as command:
                self.assertEqual(runtime.compose_config(target), full)
            first, second = [call.args[0] for call in command.call_args_list]
            self.assertNotIn("--profile", first)
            self.assertIn("--profile", second)
            self.assertIn(str(base / "docker-compose.override.yml"), second)
            self.assertIn(str(base / "docker-compose.kp.yml"), second)

    def test_runtime_uses_own_temporary_override_and_never_builds_or_pulls_on_up(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = watcher.DockerRuntime()
            runtime.kp_mode = True
            target = watcher.Target("crm-staging", directory, watcher.WEB_REPOSITORY + ":staging")
            references = {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER}
            def command(_target, args, operation, **options):
                data = json.loads(options["pin_file"].read_text(encoding="utf-8"))
                self.assertEqual(data, {"services": {key: {"image": value} for key, value in references.items()}})
                self.assertEqual(args, ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "web", "kp-renderer"])
            with patch.object(runtime, "compose", side_effect=command):
                runtime.up_pair(target, references)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
