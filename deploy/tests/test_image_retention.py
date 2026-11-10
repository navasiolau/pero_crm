"""Ретеншн образов: fake Docker, без серверов, SQL и рабочих данных."""
import copy
import hashlib
import json
import unittest
from unittest.mock import patch
from test_watch_crm import watcher, OLD_IMAGE, NEW_IMAGE, DB_IMAGE, REVISION
from test_kp_paired import PairedRuntime, image_record, OLD_RENDERER, NEW_RENDERER

GIB = 1024 ** 3


def digest(value):
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


class CacheRuntime(PairedRuntime):
    supports_image_retention = True

    def __init__(self):
        super().__init__()
        self.space = 10 * GIB
        self.removed_images = []
        self.extra_used = {DB_IMAGE}
        self.before_remove = lambda item: None
        self.remove_error = False
        self.journal = []
        for image in {v["Id"]: v for v in self.images.values()}.values():
            image["Created"] = "2026-11-04T00:00:00Z" if image["Id"] in (OLD_IMAGE, OLD_RENDERER) else "2026-11-10T00:00:00Z"
            image["RepoTags"] = [watcher.WEB_REPOSITORY + ":staging"] if image["Id"] == NEW_IMAGE else []
        self.old_pairs = []
        for day, revision in [(1, "e" * 40), (2, "d" * 40), (3, "c" * 40)]:
            pair = {}
            root = digest("renderer-root-" + revision)
            for service in ["web", "kp-renderer"]:
                image_id = digest(service + revision)
                image = image_record(image_id, revision, service, digest("web-root-" + revision) if service == "web" else root,
                                     renderer_root=root if service == "web" else None)
                image.update(Created=f"2026-11-0{day}T00:00:00Z", RepoTags=[])
                self.images[image_id] = image
                pair[service] = image_id
            self.old_pairs.append(pair)
            self.journal.append({"status": "deployed", "health": "healthy", "project": self.host, "revision": revision,
                                 "image": pair["web"], "renderer": pair["kp-renderer"]})
        self.journal.append({"status": "unchanged", "health": "healthy", "project": self.host, "revision": "b" * 40,
                             "image": OLD_IMAGE, "renderer": OLD_RENDERER})

    def image_free_bytes(self):
        return self.space

    def image_retention_budget(self):
        return self.deadline - self.now - self.reserve - 5

    def image_cache_snapshot(self, target):
        images = list({v["Id"]: copy.deepcopy(v) for v in self.images.values()}.values())
        used = self.extra_used | {self.web["Image"]} | ({self.renderer["Image"]} if self.renderer else set())
        return {"images": images, "used": used,
                "history": watcher.read_image_history((json.dumps(row) for row in self.journal), self.host)}

    def remove_cache_image(self, target, candidate):
        self.before_remove(candidate)
        if self.remove_error:
            raise watcher.WatchError("image-remove-failed")
        if candidate["id"] in self.extra_used:
            return False
        self.calls.append("remove-image:" + candidate["id"])
        self.removed_images.append(candidate["id"])
        self.images = {key: value for key, value in self.images.items() if value["Id"] != candidate["id"]}
        self.space += 2 * GIB
        return True


class RetentionWorkflowTests(unittest.TestCase):
    def test_low_space_is_rejected_before_pull_without_touching_services(self):
        runtime = CacheRuntime()
        runtime.space = GIB
        runtime.extra_used.update(v["Id"] for v in runtime.images.values())
        baseline = copy.deepcopy((runtime.web, runtime.db, runtime.renderer, runtime.configuration))
        with self.assertRaises(watcher.WatchError) as error:
            watcher.watch(runtime)
        self.assertEqual(error.exception.code, "insufficient-image-space")
        self.assertNotIn("pull:web", runtime.calls)
        self.assertEqual(runtime.removed_images, [])
        self.assertEqual((runtime.web, runtime.db, runtime.renderer, runtime.configuration), baseline)

    def test_cleanup_precedes_pull_and_retains_current_and_two_previous_pairs(self):
        runtime = CacheRuntime()
        runtime.space = GIB
        baseline = copy.deepcopy((runtime.db, runtime.configuration))
        result = watcher.watch(runtime)
        first_delete = next(i for i, call in enumerate(runtime.calls) if call.startswith("remove-image:"))
        self.assertLess(first_delete, runtime.calls.index("pull:web"))
        self.assertEqual(result["status"], "deployed")
        self.assertEqual((runtime.db, runtime.configuration), baseline)
        # После новой A сохраняются A, B и C; D/E больше не нужны.
        for image in [OLD_IMAGE, OLD_RENDERER, *runtime.old_pairs[-1].values()]:
            self.assertNotIn(image, runtime.removed_images)
        self.assertTrue(runtime.removed_images)

    def test_unchanged_run_also_performs_housekeeping(self):
        runtime = CacheRuntime()
        runtime.web["Image"] = NEW_IMAGE
        runtime.renderer = runtime.make_renderer(NEW_RENDERER)
        result = watcher.watch(runtime)
        self.assertEqual(result["status"], "unchanged")
        self.assertEqual(runtime.pairs, [])
        self.assertGreater(len(runtime.removed_images), 0)

    def test_new_container_reference_is_not_deleted(self):
        runtime = CacheRuntime()
        runtime.space = GIB
        runtime.before_remove = lambda candidate: runtime.extra_used.add(candidate["id"])
        with self.assertRaises(watcher.WatchError):
            watcher.watch(runtime)
        self.assertEqual(runtime.removed_images, [])
        self.assertNotIn("pull:web", runtime.calls)

    def test_cleanup_failure_after_health_does_not_roll_back_app(self):
        runtime = CacheRuntime()
        runtime.remove_error = True
        result = watcher.watch(runtime)
        self.assertEqual(result["status"], "deployed")
        self.assertEqual(runtime.web["Image"], NEW_IMAGE)
        self.assertEqual(len(runtime.pairs), 1)
        self.assertEqual(result["image_cleanup"]["after"]["status"], "error")

    def test_failed_release_keeps_prior_images_and_does_not_run_post_cleanup(self):
        runtime = CacheRuntime()
        runtime.fail_new = True
        with self.assertRaises(watcher.WatchError):
            watcher.watch(runtime)
        self.assertEqual(runtime.web["Image"], OLD_IMAGE)
        self.assertEqual(runtime.removed_images, [])

    def test_deadline_leaves_housekeeping_for_next_unchanged_run(self):
        runtime = CacheRuntime()
        runtime.after_renderer_pull = lambda: setattr(runtime, "now", 130)
        first = watcher.watch(runtime)
        self.assertEqual(first["status"], "deployed")
        self.assertEqual(first["image_cleanup"]["after"]["reason"], "deadline")
        self.assertEqual(runtime.removed_images, [])
        second = watcher.watch(runtime)
        self.assertEqual(second["status"], "unchanged")
        self.assertTrue(runtime.removed_images)

    def test_bounded_pass_continues_without_changing_standard_startup(self):
        runtime = CacheRuntime()
        startup = ["sh", "-c", "prisma migrate deploy && node apps/web/server.js"]
        runtime.configuration["services"]["web"]["command"] = startup[:]
        for index in range(30):
            image_id = digest("extra-" + str(index))
            image = image_record(image_id, hashlib.sha1(str(index).encode()).hexdigest(), "web", digest("extra-root-" + str(index)))
            image.update(Created="2026-10-01T00:00:00Z", RepoTags=[])
            runtime.images[image_id] = image
        first = watcher.watch(runtime)
        self.assertEqual(first["image_cleanup"]["after"]["status"], "partial")
        self.assertLessEqual(len(runtime.removed_images), 20)
        count = len(runtime.removed_images)
        second = watcher.watch(runtime)
        self.assertEqual(second["status"], "unchanged")
        self.assertGreater(len(runtime.removed_images), count)
        self.assertEqual(runtime.configuration["services"]["web"]["command"], startup)

    def test_dry_run_does_not_pull_remove_or_change_containers(self):
        runtime = CacheRuntime()
        baseline = copy.deepcopy((runtime.web, runtime.db, runtime.renderer, runtime.configuration))
        output = []
        self.assertEqual(watcher.preview_image_retention(runtime, output.append), 0)
        self.assertEqual(output[0]["status"], "dry-run")
        self.assertTrue(output[0]["candidateImages"])
        self.assertEqual(runtime.removed_images, [])
        self.assertNotIn("pull:web", runtime.calls)
        self.assertEqual((runtime.web, runtime.db, runtime.renderer, runtime.configuration), baseline)

    def test_web_only_path_preserves_database_and_performs_cleanup(self):
        runtime = CacheRuntime()
        runtime.configuration["services"]["web"].pop("environment")
        runtime.configuration["services"].pop("kp-renderer")
        baseline = copy.deepcopy(runtime.db)
        result = watcher.watch(runtime)
        self.assertEqual(result["status"], "deployed")
        self.assertEqual(runtime.calls.count("up:web"), 1)
        self.assertTrue(runtime.removed_images)
        self.assertEqual(runtime.db, baseline)


class RetentionPolicyTests(unittest.TestCase):
    def test_managed_digest_in_repotags_is_not_an_eternal_pin(self):
        runtime = CacheRuntime()
        old_renderer = runtime.images[runtime.old_pairs[0]["kp-renderer"]]
        old_renderer["RepoTags"] = old_renderer["RepoDigests"][:]
        plan = watcher.image_retention_plan(runtime.image_cache_snapshot(None), {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER})
        self.assertIn(old_renderer["Id"], {row["id"] for row in plan["candidates"]})

    def test_stopped_container_unknown_images_and_tagged_candidate_are_protected(self):
        runtime = CacheRuntime()
        runtime.extra_used.add(runtime.old_pairs[0]["web"])
        foreign = image_record(digest("foreign"), "f" * 40, "web", digest("foreign-root"))
        foreign.update(Created="2026-01-01T00:00:00Z", RepoTags=[])
        foreign["RepoDigests"] = ["other.invalid/company/app@" + digest("foreign-root")]
        foreign["Config"]["Labels"]["pero.ci.repository"] = "another/repo"
        runtime.images[foreign["Id"]] = foreign
        state = runtime.image_cache_snapshot(None)
        plan = watcher.image_retention_plan(state, {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER})
        selected = {candidate["id"] for candidate in plan["candidates"]}
        self.assertFalse(selected & {foreign["Id"], NEW_IMAGE, NEW_RENDERER, *runtime.old_pairs[0].values()})

    def test_failed_or_foreign_history_does_not_displace_successful_versions(self):
        runtime = CacheRuntime()
        runtime.journal += [{"status": "error", "health": "healthy", "project": runtime.host, "revision": "f" * 40, "image": digest("failed")},
                            {"status": "deployed", "health": "healthy", "project": "crm", "revision": "f" * 40, "image": digest("foreign")}]
        history = watcher.read_image_history(map(json.dumps, runtime.journal), runtime.host)
        self.assertEqual([row["revision"] for row in history["releases"]], ["b" * 40, "c" * 40, "d" * 40])

    def test_incomplete_history_is_conservative(self):
        runtime = CacheRuntime()
        runtime.journal = []
        plan = watcher.image_retention_plan(runtime.image_cache_snapshot(None), {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER})
        self.assertEqual(plan["candidates"], [])
        self.assertEqual(plan["reason"], "history-not-ready")

    def test_malformed_success_does_not_create_a_false_rollback_window(self):
        runtime = CacheRuntime()
        runtime.journal.append({"status": "deployed", "health": "healthy", "project": runtime.host, "image": 42})
        state = runtime.image_cache_snapshot(None)
        self.assertEqual(watcher.image_retention_plan(state, {"web": OLD_IMAGE, "kp-renderer": OLD_RENDERER})["candidates"], [])
        with self.assertRaises(watcher.WatchError) as error:
            watcher.read_image_history(["not-json"], runtime.host)
        self.assertEqual(error.exception.code, "invalid-image-history")

    def test_docker_removal_rechecks_references_and_never_uses_force_or_prune(self):
        runtime = CacheRuntime()
        image = runtime.images[runtime.old_pairs[0]["web"]]
        candidate = watcher.image_cache_fingerprint(image)
        real = watcher.DockerRuntime()
        with patch.object(real, "all_container_image_ids", return_value={image["Id"]}), patch.object(real, "command") as execute:
            self.assertFalse(real.remove_cache_image(None, candidate))
            execute.assert_not_called()
        with patch.object(real, "all_container_image_ids", return_value=set()), patch.object(real, "inspect_image_ref", return_value=image), patch.object(real, "command", return_value="") as execute:
            self.assertTrue(real.remove_cache_image(None, candidate))
            self.assertEqual(execute.call_args.args[0], watcher.DOCKER + ["image", "rm", "--no-prune", image["Id"]])
        changed = copy.deepcopy(image)
        changed["RepoTags"] = ["local/keep:rollback"]
        with patch.object(real, "all_container_image_ids", return_value=set()), patch.object(real, "inspect_image_ref", return_value=changed), patch.object(real, "command") as execute:
            self.assertFalse(real.remove_cache_image(None, candidate))
            execute.assert_not_called()

    def test_real_adapter_includes_stopped_container_references(self):
        real = watcher.DockerRuntime()
        container_id = "9" * 64
        with patch.object(real, "command", side_effect=[container_id + "\n", json.dumps([{"Id": container_id, "Image": DB_IMAGE, "State": {"Running": False}}])]) as execute:
            self.assertEqual(real.all_container_image_ids(), {DB_IMAGE})
            self.assertIn("--all", execute.call_args_list[0].args[0])


if __name__ == "__main__":
    unittest.main()
