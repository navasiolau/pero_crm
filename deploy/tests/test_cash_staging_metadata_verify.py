"""Offline proof-bound metadata exception checks; no stage, Docker, SSH or DB."""
import copy
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).parent.parent / "acceptance" / "cash-staging-metadata-verify.py"
SPEC = importlib.util.spec_from_file_location("cash_staging_metadata_verify", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def fixture():
    archived = {"key": MODULE.KEY, "value": "private-same-value", "updatedAt": "2026-09-29 01:04:44.065"}
    current = {"key": MODULE.KEY, "value": "private-same-value", "updatedAt": "2026-09-29 07:04:44.075"}
    proof = {"status": "ORGSETTING_METADATA_ONLY_PROVEN", "revision": MODULE.REVISION,
             "archivedKey": MODULE.KEY, "currentKey": MODULE.KEY, "valueEqual": True,
             "changedFields": ["updatedAt"], "backupReceiptSha256": MODULE.RECEIPT_SHA,
             "diagnosticSha256": MODULE.DIAGNOSTIC_SHA, "otherBusinessTablesPreserved": 37,
             "onlyOrgSettingProtectedDrift": True, "newPayoutFieldsNull": True,
             "oldLedgerPreserved": True, "migrationChecksumMatched": True,
             "onlyNinePayoutColumnsAdded": True, "unexpectedFullHashTables": [],
             "archivedUpdatedAt": archived["updatedAt"], "currentUpdatedAt": current["updatedAt"]}
    checks = {"otherBusinessTablesPreserved": 37, "newPayoutFieldsNull": True,
              "oldLedgerPreserved": True, "migrationChecksumMatched": True,
              "onlyNinePayoutColumnsAdded": True, "unexpectedFullHashTables": []}
    return archived, [current], proof, checks


class Frozen:
    def __init__(self, checks):
        self.checks = checks

    def preservation(self, _before, fresh, _diagnostic, _backup):
        if fresh.get("otherDrift"):
            raise MODULE.Stop("OTHER_BUSINESS_DRIFT")
        return self.checks


class MetadataVerifierTests(unittest.TestCase):
    def validate(self, archived, rows, proof, checks=None, fresh=None):
        return MODULE.validate_exception(archived, rows, proof, {}, fresh or {}, {},
                                         Frozen(checks or fixture()[3]), object())

    def test_accept_only_same_key_value_with_exact_witnessed_timestamp(self):
        archived, rows, proof, checks = fixture()
        self.assertEqual(self.validate(archived, rows, proof, checks), checks)

    def test_refuse_changed_value_or_key_even_with_pinned_positive_proof(self):
        archived, rows, proof, _ = fixture()
        for changed in ({"value": "different"}, {"key": "another.key"}):
            candidate = copy.deepcopy(rows)
            candidate[0].update(changed)
            with self.subTest(changed=changed), self.assertRaises(MODULE.Stop):
                self.validate(archived, candidate, proof)

    def test_refuse_missing_extra_row_or_new_unproven_timestamp(self):
        archived, rows, proof, _ = fixture()
        for candidate in ([], rows * 2, [{**rows[0], "updatedAt": "2026-09-29 13:04:44.075"}]):
            with self.subTest(candidate=candidate), self.assertRaises(MODULE.Stop):
                self.validate(archived, candidate, proof)

    def test_refuse_broadened_proof_or_unrelated_business_drift(self):
        archived, rows, proof, checks = fixture()
        for delta in ({"changedFields": ["value", "updatedAt"]},
                      {"valueEqual": False}, {"otherBusinessTablesPreserved": 36},
                      {"backupReceiptSha256": "0" * 64}):
            with self.subTest(delta=delta), self.assertRaises(MODULE.Stop):
                self.validate(archived, rows, {**proof, **delta})
        with self.assertRaises(MODULE.Stop):
            self.validate(archived, rows, proof, checks, {"otherDrift": True})
        with self.assertRaises(MODULE.Stop):
            self.validate(archived, rows, proof, {**checks, "newPayoutFieldsNull": False})


if __name__ == "__main__":
    unittest.main()
