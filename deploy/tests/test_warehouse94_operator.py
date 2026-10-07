"""Operator refusal tests do not connect to a database or create an archive."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('warehouse_operator',Path(__file__).resolve().parents[1]/'warehouse94-operator.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class OperatorTests(unittest.TestCase):
    def test_wrong_host_stops_before_docker(self):
        options=SimpleNamespace(target='production',revision='a'*40,run='00000000-0000-4000-8000-000000000094',action='zero')
        with patch.object(module.socket,'gethostname',return_value='wrong-host'),patch.object(module,'inspect') as inspect:
            with self.assertRaisesRegex(RuntimeError,'GUEST_HOST_REQUIRED'):module.identity(options)
            inspect.assert_not_called()

    def test_staging_dump_refused_before_creating_directory(self):
        options=SimpleNamespace(target='staging',revision='a'*40,run='00000000-0000-4000-8000-000000000094',action='pre-zero-backup')
        with patch.object(module,'identity',return_value={'hostname':'crm-staging'}),patch.object(module,'owned_directory') as directory:
            with self.assertRaisesRegex(RuntimeError,'NO_LOCAL_OR_STAGING_DUMPS'):module.run_remote(options)
            directory.assert_not_called()

    def test_sql_mutations_use_repeatable_read_and_read_queries_are_read_only(self):
        with patch.object(module,'call',return_value='{}') as command:
            module.query('crm-db-1','SELECT warehouse_zero_start()',True)
            self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ',command.call_args.args[1])
            module.query('crm-db-1','SELECT 1')
            self.assertIn('READ ONLY',command.call_args.args[1])

    def test_no_live_full_restore_or_cascade_paths(self):
        text=Path(module.__file__).read_text(encoding='utf-8')
        self.assertNotIn('TRUNCATE',text)
        self.assertNotIn('prune',text)
        self.assertIn('LOCAL_WINDOWS_REQUIRED',text)
        self.assertIn('REAL_RECOVERY_PROOF_REQUIRED',text)

    def test_archived_warehouse_guards_share_mutation_transaction(self):
        run='00000000-0000-4000-8000-000000000094'
        receipt={'runId':run,'state':{'tables':{name:{'rows':3,'hash':'a'*32} for name in ['Material','StockMovement','ProjectMaterial','WarehouseBalance','WarehouseMovementValuation']}},'warehouseGuard':{'runId':run,'prices':'b'*32,'balances':'c'*32}}
        guard=module.frozen_archive_guard(receipt)
        self.assertIn('pg_advisory_xact_lock',guard)
        self.assertIn('WAREHOUSE_ARCHIVE_SNAPSHOT_CHANGED',guard)
        self.assertIn('"beforePrices"',module.recovery_snapshot_guard(receipt))
        receipt['warehouseGuard']['runId']="bad'run"
        with self.assertRaisesRegex(RuntimeError,'FROZEN_RECEIPT_INVALID'):module.recovery_snapshot_guard(receipt)

    def test_receipt_symlink_refused_before_read(self):
        fake=unittest.mock.MagicMock()
        fake.is_file.return_value=True;fake.is_symlink.return_value=True
        with self.assertRaisesRegex(RuntimeError,'ARTIFACT_TYPE_MISMATCH'):module.read_json(fake)
        fake.read_text.assert_not_called()

if __name__=='__main__':unittest.main()
