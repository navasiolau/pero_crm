"""Pure stage prepare forensic guards; no guest, SSH, Docker or DB access."""
import hashlib
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).parent.parent / "acceptance" / "cash-staging-prepare-diagnostic.py"
SPEC = importlib.util.spec_from_file_location("cash_staging_prepare_diagnostic", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FingerprintSnapshot:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def query(self, sql):
        self.queries.append(sql)
        return list(self.rows)


class AbsentSnapshot:
    def __init__(self, occupied=None):
        self.occupied = occupied

    def query(self, sql):
        if 'FROM public."Payout"' in sql:
            return {"count": "0"}
        if 'FROM public."ChangeLog"' in sql:
            return {"count": "0", "ids": []}
        for table, ids in MODULE.OWNED.items():
            if 'FROM public."' + table + '"' in sql:
                hit = self.occupied if self.occupied in ids else None
                return {"count": "1" if hit else "0", "ids": [hit] if hit else []}
        raise AssertionError(sql)


class PrepareDiagnosticTests(unittest.TestCase):
    def test_baseline_is_exact_reviewed_38_table_hashes(self):
        self.assertEqual(len(MODULE.BASELINE), 38)
        self.assertTrue(all(len(value) == 64 for value in MODULE.BASELINE.values()))
        self.assertEqual(MODULE.PLAN_SHA, "d8446009e6b6a516481cf77e5f94c788402b97933ba4797eff0d60c66a6b9309")

    def test_raw_fingerprint_uses_js_utf16_sort_and_expression_order(self):
        rows = ['{"v":"\ue000"}', '{"v":"😀"}']
        snapshot = FingerprintSnapshot(rows)
        got = MODULE.raw_fingerprint(snapshot, "Client", 2)
        expected = hashlib.sha256(("\n".join(sorted(rows, key=lambda value: value.encode("utf-16-be"))) + "\n").encode()).hexdigest()
        self.assertEqual(got, expected)
        self.assertIn('ORDER BY (to_jsonb(t)::text) COLLATE "C"', snapshot.queries[0])
        self.assertEqual(MODULE.raw_fingerprint(FingerprintSnapshot([]), "Payment", 0),
                         hashlib.sha256(b"\n").hexdigest())

    def test_exact_eight_id_and_four_receipt_absence_is_explicit(self):
        absent = MODULE.exact_absence(AbsentSnapshot())
        self.assertTrue(absent["allEightAbsent"])
        self.assertEqual(absent["qaUserPayoutCount"], "0")
        self.assertEqual(sum(int(row["count"]) for row in absent["fixtureRows"].values()), 0)
        occupied = MODULE.exact_absence(AbsentSnapshot(MODULE.OWNED["Project"][0]))
        self.assertFalse(occupied["allEightAbsent"])

    def test_field_candidate_only_when_protected_projection_still_matches_backup(self):
        base = {"ApiToken": "a", "Plugin": "b", "OrgSetting": "c"}
        now = {"ApiToken": "x", "Plugin": "y", "OrgSetting": "z"}
        receipt = {"state": {"tables": {"ApiToken": "same", "Plugin": "old", "OrgSetting": "old"}}}
        state = {"tables": {"ApiToken": "same", "Plugin": "new", "OrgSetting": "new"}}
        archived = {"key": "telegram.botUsername", "value": "same", "updatedAt": "early"}
        live = [{"key": "telegram.botUsername", "value": "same", "updatedAt": "late"}]
        diff = MODULE.classify_drift(base, now, state, receipt, live, archived)
        self.assertEqual(diff["ApiToken"]["candidateOmittedFields"], ["lastUsedAt"])
        self.assertEqual(diff["Plugin"]["candidateOmittedFields"], [])
        self.assertEqual(diff["OrgSetting"]["changedFieldsFromArchive"], ["updatedAt"])
        self.assertTrue(diff["OrgSetting"]["valueEqualToArchive"])


if __name__ == "__main__":
    unittest.main()
