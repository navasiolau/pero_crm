"""Exercise reviewed operator SQL in the native rolled-back test; no archives."""
import importlib.util
import json
from pathlib import Path
import sys

spec=importlib.util.spec_from_file_location('warehouse_operator',Path(__file__).resolve().parents[1]/'warehouse94-operator.py')
operator=importlib.util.module_from_spec(spec);spec.loader.exec_module(operator)
receipt=json.load(sys.stdin)
if sys.argv[1]=='freeze':print(operator.frozen_archive_guard(receipt))
elif sys.argv[1]=='restore':print(operator.recovery_snapshot_guard(receipt))
elif sys.argv[1]=='stock':print(operator.original_stock(lambda sql:json.dumps(sql)))
else:raise RuntimeError('TEST_ACTION_INVALID')
