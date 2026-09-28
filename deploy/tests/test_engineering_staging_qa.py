"""Pure runId binding checks. No SSH, Docker, DB, or guest path reads."""
import ast
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).parent.parent / "acceptance" / "engineering-staging-qa.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ("binding_guard", "response_guard")]
assert len(functions) == 2


class Stop(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stop(code)


scope = {"require": require, "Stop": Stop, "UUID": re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), "exec"), scope)
module = SimpleNamespace(**scope)
RUN = "12345678-1234-4123-8123-123456789abc"
OTHER = "87654321-4321-4432-8432-cba987654321"


class BindingTests(unittest.TestCase):
    def packet(self, operation, run_id=RUN):
        value = {"operation": operation, "target": "staging"}
        if operation in ("prepare", "sessions"):
            value["plan"] = {"runId": RUN}
        if operation in ("capture", "cleanup"):
            value["manifest"] = {"runId": RUN}
        return {"operation": operation, "runId": run_id, "input": value}

    def test_before_intent_binds_every_mutation_and_session(self):
        for operation in ("prepare", "sessions", "capture", "cleanup"):
            self.assertEqual(module.binding_guard(self.packet(operation)), RUN)
            with self.assertRaisesRegex(module.Stop, "RUN_ID_BINDING_MISMATCH"):
                module.binding_guard(self.packet(operation, OTHER))
            with self.assertRaisesRegex(module.Stop, "RUN_ID_BINDING_MISMATCH"):
                module.binding_guard(self.packet(operation, None))

    def test_refs_and_plan_have_null_input_run_id_only(self):
        for operation in ("refs", "plan"):
            self.assertIsNone(module.binding_guard(self.packet(operation, None)))
            with self.assertRaisesRegex(module.Stop, "RUN_ID_BINDING_MISMATCH"):
                module.binding_guard(self.packet(operation, RUN))

    def test_response_id_matches_bound_or_new_plan_id(self):
        packet = self.packet("prepare")
        module.response_guard(packet, {"publicSummary": {"operation": "prepare", "runId": RUN}}, RUN)
        with self.assertRaisesRegex(module.Stop, "RUN_ID_RESPONSE_MISMATCH"):
            module.response_guard(packet, {"publicSummary": {"operation": "prepare", "runId": OTHER}}, RUN)
        plan = self.packet("plan", None)
        module.response_guard(plan, {"publicSummary": {"operation": "plan", "runId": RUN},
                                     "privatePayload": {"runId": RUN}}, None)
        with self.assertRaisesRegex(module.Stop, "RUN_ID_RESPONSE_MISMATCH"):
            module.response_guard(plan, {"publicSummary": {"operation": "plan", "runId": RUN},
                                         "privatePayload": {"runId": OTHER}}, None)


if __name__ == "__main__":
    unittest.main()
