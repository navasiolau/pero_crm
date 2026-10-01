"""Pure checks for the guest-side read-only acceptance script; no Docker/DB/S3."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "acceptance" / "percentage-staging-readonly.py"
if sys.platform == "win32":
    sys.modules.setdefault("fcntl", types.ModuleType("fcntl"))  # import-only offline test
SPEC = importlib.util.spec_from_file_location("percentage_staging_readonly", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Snapshot:
    def __init__(self, tables):
        self.tables = tables

    def query(self, sql):
        if "pg_tables" in sql:
            return sorted(self.tables)
        raise AssertionError("unexpected query")


class ReadonlyStageTests(unittest.TestCase):
    def test_exact_old_and_new_table_sets(self):
        old = set(MODULE.BASE_TABLES) | {"_prisma_migrations"}
        self.assertEqual(set(MODULE.table_set(Snapshot(old), False)), old)
        post = old | MODULE.NEW_TABLES
        self.assertEqual(set(MODULE.table_set(Snapshot(post), True)), post)
        with self.assertRaisesRegex(RuntimeError, "TABLE_SET_INVALID"):
            MODULE.table_set(Snapshot(old | {"UnknownBusiness"}), False)
        with self.assertRaisesRegex(RuntimeError, "TABLE_SET_INVALID"):
            MODULE.table_set(Snapshot(old | {next(iter(MODULE.NEW_TABLES))}), False)

    def test_migrations_and_storage_are_readonly_scoped(self):
        self.assertEqual(len(MODULE.MIGRATIONS), 2)
        self.assertIn("ListObjectVersionsCommand", MODULE.S3_JS)
        self.assertNotIn("GetObjectCommand", MODULE.S3_JS)
        self.assertNotIn("DeleteObjectCommand", MODULE.S3_JS)
        self.assertIn("--snapshot=", SOURCE.read_text(encoding="utf-8"))
        self.assertIn("pg_restore", SOURCE.read_text(encoding="utf-8"))
        self.assertNotIn("prisma migrate deploy", SOURCE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
