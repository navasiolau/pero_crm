"""Offline COPY parser guards; no SSH, Docker, PostgreSQL or archive read."""
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).parent.parent / "acceptance" / "cash-staging-orgsetting-proof.py"
SPEC = importlib.util.spec_from_file_location("cash_staging_orgsetting_proof", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

HEADER = b'COPY public."OrgSetting" (key, value, "updatedAt") FROM stdin;\n'
PREFIX = (b'-- PostgreSQL database dump\n'
          b'SET statement_timeout = 0;\n'
          b'-- Data for Name: OrgSetting; Type: TABLE DATA; Schema: public\n')
SUFFIX = b'\\.\n\n-- PostgreSQL database dump complete\n'


def dump(row):
    return PREFIX + HEADER + row + b"\n" + SUFFIX


class OrgSettingCopyParserTests(unittest.TestCase):
    def test_exact_single_copy_row_and_documented_escapes(self):
        row = b'telegram.botUsername\tabc\\tdef\\n\\\\ghi\t2026-09-29 09:00:00.123'
        result = MODULE.parse_orgsetting_copy(dump(row))
        self.assertEqual(result, {"key": "telegram.botUsername", "value": "abc\tdef\n\\ghi",
                                  "updatedAt": "2026-09-29 09:00:00.123"})
        self.assertEqual(MODULE.decode_copy_field(b'hi\\x20there\\041'), "hi there!")

    def test_missing_extra_or_reordered_columns_stop(self):
        row = b'payrollCurrency\tBYN\t2026-09-29 09:00:00'
        for stream in (PREFIX + row + b"\n" + SUFFIX,
                       PREFIX + b'COPY public."OrgSetting" (value, key, "updatedAt") FROM stdin;\n' + row + b"\n" + SUFFIX,
                       dump(row) + HEADER + row + b"\n" + SUFFIX,
                       PREFIX + HEADER + row + b"\n" + row + b"\n" + SUFFIX,
                       PREFIX + HEADER + b'key\tvalue\n' + SUFFIX):
            with self.subTest(stream=stream[:80]), self.assertRaises(MODULE.Stop):
                MODULE.parse_orgsetting_copy(stream)

    def test_null_unknown_escape_bad_utf8_and_raw_control_stop(self):
        for row in (b'key\t\\N\t2026-09-29 09:00:00',
                    b'key\tbad\\qvalue\t2026-09-29 09:00:00',
                    b'key\tbad\\400value\t2026-09-29 09:00:00',
                    b'key\t\xff\t2026-09-29 09:00:00',
                    b'key\tbad\rvalue\t2026-09-29 09:00:00'):
            with self.subTest(row=row), self.assertRaises(MODULE.Stop):
                MODULE.parse_orgsetting_copy(dump(row))

    def test_key_cannot_be_arbitrary_secret_or_multiple_copy_blocks(self):
        row = b'private key\tvalue\t2026-09-29 09:00:00'
        with self.assertRaises(MODULE.Stop):
            MODULE.parse_orgsetting_copy(dump(row))
        with self.assertRaises(MODULE.Stop):
            MODULE.parse_orgsetting_copy(dump(b'key\tvalue\t2026-09-29 09:00:00') + b'COPY public."Other" (id) FROM stdin;\n')


if __name__ == "__main__":
    unittest.main()
