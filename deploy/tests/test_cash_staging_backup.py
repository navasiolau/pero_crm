"""Offline guards for the cash staging backup adapter; no SSH, Docker, or DB."""
import copy
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).parent.parent / "acceptance" / "cash-staging-backup.py"
SPEC = importlib.util.spec_from_file_location("cash_staging_backup", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def column(name, data_type="text", udt_name=None, nullable="YES", precision=None, scale=None, default=None):
    return {"name": name, "dataType": data_type, "udtName": udt_name or data_type,
            "nullable": nullable, "numericPrecision": precision, "numericScale": scale,
            "columnDefault": default}


def prior_state(payout_count="7"):
    business = ["Payout", "ApiToken", "Plugin", "Project"] + [f"Business{i:02d}" for i in range(34)]
    assert len(business) == MODULE.BUSINESS_TABLE_COUNT
    table_names = business + [MODULE.MIGRATION_TABLE]
    columns = {name: [column("id")] for name in business}
    columns[MODULE.MIGRATION_TABLE] = [column("id"), column("migration_name")]
    return {
        "tables": {name: {"count": payout_count if name == "Payout" else "1", "hash": f"protected:{name}"}
                   for name in table_names},
        "full": {name: f"full:{name}" for name in table_names},
        "columns": columns,
        "payoutCashFields": None,
        "migrations": [{"id": "migration-before", "migration_name": MODULE.PRE_MIGRATION,
                        "checksum": "previous-checksum", "finished_at": "2026-09-28T00:00:00Z",
                        "rolled_back_at": None}],
    }


def migrated_state(before):
    state = copy.deepcopy(before)
    state["columns"]["Payout"].extend(copy.deepcopy(list(MODULE.PAYOUT_ADDITIONS)))
    state["full"]["Payout"] = "full:Payout-with-cash-fields"
    state["full"][MODULE.MIGRATION_TABLE] = "full:ledger-with-cash-migration"
    state["full"]["ApiToken"] = "full:ApiToken-lastUsedAt-changed"
    state["full"]["Plugin"] = "full:reviewed-plugin-updatedAt-changed"
    state["payoutCashFields"] = {
        "rowCount": before["tables"]["Payout"]["count"],
        "nonNullCounts": {name: "0" for name in MODULE.PAYOUT_ADDITION_NAMES},
    }
    state["migrations"].append({"id": "migration-cash", "migration_name": MODULE.MIGRATION,
                                "checksum": MODULE.SQL_SHA, "finished_at": "2026-09-29T00:00:00Z",
                                "rolled_back_at": None})
    return state


class CashStagingBackupTests(unittest.TestCase):
    def test_frozen_target_and_migration_constants(self):
        self.assertEqual(MODULE.SUPPORT_SHA, "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790")
        self.assertEqual(MODULE.BACKUP_ROOT.as_posix(), "/var/lib/pero-cash-qa")
        self.assertEqual(MODULE.OLD_REVISION, "8ed48388a8df06c10b58d3e2b6d7a4cf72a29f66")
        self.assertEqual(MODULE.PRE_MIGRATION, "20260928220000_product_engineering_pay")
        self.assertEqual(MODULE.MIGRATION, "20260929120000_manager_cash_advances")
        self.assertEqual(MODULE.SQL_SHA, "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd")
        self.assertEqual(MODULE.NEW_TABLES, frozenset())
        self.assertEqual(len(MODULE.PAYOUT_ADDITIONS), 9)

    def test_pre_migration_guard_does_not_assume_payout_is_empty(self):
        state = prior_state("17")
        MODULE.validate_prior_state(state)
        self.assertEqual(state["tables"]["Payout"]["count"], "17")
        MODULE.validate_prior_state(prior_state("0"))

        extended_before = prior_state("17")
        extended_before["columns"]["Payout"].append(copy.deepcopy(MODULE.PAYOUT_ADDITIONS[0]))
        with self.assertRaisesRegex(RuntimeError, "PAYOUT_SCHEMA_ALREADY_EXTENDED"):
            MODULE.validate_prior_state(extended_before)

    def test_row_projections_exclude_only_migration_fields_and_reviewed_startup_timestamps(self):
        payout, payout_full = MODULE.row_projection("Payout")
        self.assertEqual(payout_full, "to_jsonb(t)")
        expected_payout = "to_jsonb(t) - ARRAY[" + ",".join("'" + name + "'" for name in MODULE.PAYOUT_ADDITION_NAMES) + "]"
        self.assertEqual(payout, expected_payout)

        api_token, api_full = MODULE.row_projection("ApiToken")
        self.assertEqual(api_full, "to_jsonb(t)")
        self.assertEqual(api_token, "(to_jsonb(t)) - 'lastUsedAt'")

        plugin, plugin_full = MODULE.row_projection("Plugin")
        self.assertEqual(plugin_full, "to_jsonb(t)")
        self.assertEqual(plugin, "CASE WHEN t.id IN ('demo','file-stages') THEN (to_jsonb(t)) - 'updatedAt' ELSE to_jsonb(t) END")

        ordinary, ordinary_full = MODULE.row_projection("Project")
        self.assertEqual(ordinary, "to_jsonb(t)")
        self.assertEqual(ordinary_full, "to_jsonb(t)")

    def test_verify_preserves_legacy_payout_projection_and_reports_full_hash_drift(self):
        before = prior_state("7")
        after = migrated_state(before)
        result = MODULE.validate_migrated_state(before, after)
        self.assertEqual(result["businessTablesPreserved"], 38)
        self.assertEqual(result["newTables"], [])
        self.assertEqual(result["payoutRows"], "7")
        self.assertTrue(all(value == "0" for value in result["payoutCashFieldNonNullCounts"].values()))
        self.assertEqual(set(result["fullHashDriftTables"]), {"Payout", MODULE.MIGRATION_TABLE, "ApiToken", "Plugin"})
        self.assertEqual(set(result["routineMetadataFullHashDrift"]), {"ApiToken", "Plugin"})

    def test_payout_schema_requires_exactly_the_nine_nullable_columns(self):
        before = prior_state()
        after = migrated_state(before)
        extra = copy.deepcopy(after)
        extra["columns"]["Payout"].append(column("unexpectedField"))
        with self.assertRaisesRegex(RuntimeError, "PAYOUT_ADDITIONS_MISMATCH"):
            MODULE.validate_migrated_state(before, extra)

        non_nullable = copy.deepcopy(after)
        non_nullable["columns"]["Payout"][-1]["nullable"] = "NO"
        with self.assertRaisesRegex(RuntimeError, "PAYOUT_ADDITIONS_MISMATCH"):
            MODULE.validate_migrated_state(before, non_nullable)

        old_field_changed = copy.deepcopy(after)
        old_field_changed["columns"]["Payout"][0]["dataType"] = "uuid"
        with self.assertRaisesRegex(RuntimeError, "PAYOUT_OLD_COLUMN_LAYOUT_DRIFT"):
            MODULE.validate_migrated_state(before, old_field_changed)

    def test_new_tables_and_business_projection_drift_stop_verification(self):
        before = prior_state()
        after = migrated_state(before)
        extra_table = copy.deepcopy(after)
        extra_table["tables"]["Unexpected"] = {"count": "0", "hash": ""}
        extra_table["columns"]["Unexpected"] = [column("id")]
        extra_table["full"]["Unexpected"] = ""
        with self.assertRaisesRegex(RuntimeError, "TABLE_SET_DRIFT"):
            MODULE.validate_migrated_state(before, extra_table)

        changed_business = copy.deepcopy(after)
        changed_business["tables"]["Project"]["hash"] = "changed"
        with self.assertRaisesRegex(RuntimeError, "BUSINESS_PROJECTION_DRIFT"):
            MODULE.validate_migrated_state(before, changed_business)

    def test_payout_new_values_and_migration_ledger_are_guarded(self):
        before = prior_state()
        after = migrated_state(before)
        changed_values = copy.deepcopy(after)
        changed_values["payoutCashFields"]["nonNullCounts"]["cashAmount"] = "1"
        with self.assertRaisesRegex(RuntimeError, "LEGACY_PAYOUT_FIELDS_NOT_NULL"):
            MODULE.validate_migrated_state(before, changed_values)

        wrong_checksum = copy.deepcopy(after)
        wrong_checksum["migrations"][-1]["checksum"] = "wrong"
        with self.assertRaisesRegex(RuntimeError, "MIGRATION_CHECKSUM_MISMATCH"):
            MODULE.validate_migrated_state(before, wrong_checksum)

        extra_migration = copy.deepcopy(after)
        extra_migration["migrations"].append({"id": "other", "migration_name": "20260930100000_other",
                                              "checksum": "other", "finished_at": "2026-09-30T00:00:00Z",
                                              "rolled_back_at": None})
        with self.assertRaisesRegex(RuntimeError, "OLD_LEDGER_DRIFT"):
            MODULE.validate_migrated_state(before, extra_migration)

    def test_backup_identity_allows_only_the_accepted_web_replacement(self):
        before = {
            "hostname": "crm-staging", "web": "web-before", "image": "image-before",
            "revision": MODULE.OLD_REVISION, "webStartedAt": "web-start-before",
            "database": "db-fixed", "databaseStartedAt": "db-start-fixed",
            "databaseVolume": "crm-staging_pgdata", "pgdata": "/var/lib/postgresql/data",
            "outerW07Sha256": "w07-fixed",
        }
        after = {**before, "web": "web-after", "image": "image-after",
                 "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "webStartedAt": "web-start-after"}
        MODULE.verify_backup_identity(before, after)

    def test_backup_identity_rejects_any_stable_target_change(self):
        before = {
            "hostname": "crm-staging", "web": "web-before", "image": "image-before",
            "revision": MODULE.OLD_REVISION, "webStartedAt": "web-start-before",
            "database": "db-fixed", "databaseStartedAt": "db-start-fixed",
            "databaseVolume": "crm-staging_pgdata", "pgdata": "/var/lib/postgresql/data",
            "outerW07Sha256": "w07-fixed",
        }
        for key in ("hostname", "database", "databaseStartedAt", "databaseVolume", "pgdata", "outerW07Sha256"):
            with self.subTest(key=key):
                changed = {**before, key: before[key] + "-changed"}
                with self.assertRaisesRegex(RuntimeError, "BACKUP_TARGET_MISMATCH"):
                    MODULE.verify_backup_identity(before, changed)

    def test_backup_receipt_must_record_the_expected_old_revision(self):
        before = {
            "hostname": "crm-staging", "web": "web-before", "image": "image-before",
            "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "webStartedAt": "web-start-before",
            "database": "db-fixed", "databaseStartedAt": "db-start-fixed",
            "databaseVolume": "crm-staging_pgdata", "pgdata": "/var/lib/postgresql/data",
            "outerW07Sha256": "w07-fixed",
        }
        after = {**before, "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
        with self.assertRaisesRegex(RuntimeError, "BACKUP_REVISION_MISMATCH"):
            MODULE.verify_backup_identity(before, after)


if __name__ == "__main__":
    unittest.main()
