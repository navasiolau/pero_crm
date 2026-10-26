import importlib.util
import base64
import hashlib
from pathlib import Path
import tempfile
import unittest
import sys

path = Path(__file__).resolve().parents[1] / 'scripts' / 'pero_kp_api.py'
spec = importlib.util.spec_from_file_location('kp_helper', path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
sys.modules['pero_kp_api'] = helper
sys.path.insert(0, str(path.parent))
install_spec = importlib.util.spec_from_file_location('kp_installer', path.parent / 'install_skill.py')
installer = importlib.util.module_from_spec(install_spec)
install_spec.loader.exec_module(installer)


class HelperTests(unittest.TestCase):
    def test_receipt_is_persisted_before_network_and_rerun_only_reads_same_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            calls = []
            class Client:
                def call(self, action, **args):
                    calls.append((action, args))
                    self_receipt = helper.load_json(receipt)
                    if action == 'save':
                        self.assertion = self_receipt['operationId'] == args['operationId']
                        raise helper.ApiError('Тайм-аут')
                    return {'result': {'id': 'doc', 'revision': 1}}
            client = Client()
            args = {'state': {'items': []}}
            with self.assertRaises(helper.ApiError): helper.command(client, 'save', args, receipt)
            self.assertTrue(client.assertion)
            self.assertFalse(helper.load_json(receipt)['verified'])
            result = helper.command(client, 'save', args, receipt)
            self.assertEqual(result['id'], 'doc')
            self.assertEqual([row[0] for row in calls], ['save', 'operation'])
            self.assertEqual(calls[0][1]['operationId'], calls[1][1]['id'])
            with self.assertRaises(helper.ApiError): helper.command(client, 'save', {'state': {'items': [{'name': 'Другое'}]}}, receipt)
            self.assertEqual(len(calls), 2)
        limits = []
        class Result:
            stdout = '{"ok":true,"result":{"id":"same-job"}}'
        def runner(*_args, **kwargs):
            limits.append(kwargs['timeout'])
            return Result()
        bridge = helper.ApiClient.__new__(helper.ApiClient)
        bridge.env = {'PERO_CRM_API_KEY': 'synthetic-not-real'}
        bridge.runner = runner
        bridge.call('job', id='same-job', wait=True)
        bridge.call('job', id='same-job', wait=False)
        bridge.call('pdf', id='same-job', wait=True)
        self.assertEqual(limits, [None, 110, 110])

    def test_concurrent_revision_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / 'before.json'
            helper.write_json(before, {'id': 'doc', 'revision': 3, 'state': {'items': []}})
            class Client:
                def call(self, *_args, **_kwargs): return {'id': 'doc', 'revision': 4, 'state': {'items': []}, 'canEdit': True}
            with self.assertRaisesRegex(helper.ApiError, 'изменилось'): helper.fresh_document(Client(), 'doc', before)

    def test_locked_quote_and_duplicate_item_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / 'before.json'
            snapshot = {'id': 'doc', 'revision': 3, 'state': {'items': [{'id': 'stable'}]}}
            helper.write_json(before, snapshot)
            class Client:
                def call(self, *_args, **_kwargs): return {**snapshot, 'canEdit': False}
            with self.assertRaisesRegex(helper.ApiError, 'Лид'): helper.fresh_document(Client(), 'doc', before)
            with self.assertRaisesRegex(helper.ApiError, 'повторяются'): helper.state_for_save({'items': [{'id': 'stable'}, {'id': 'stable'}]}, snapshot)
            self.assertEqual(helper.state_for_save(snapshot['state'], snapshot)['items'][0]['id'], 'stable')
            self.assertEqual(helper.state_for_save({'items': [{'name': 'Новое'}]}, snapshot)['items'], [{'name': 'Новое'}])
            self.assertEqual(helper.state_for_save({'items': []}, snapshot), {'items': []})

    def test_install_requires_live_api_and_preserves_old_skill_and_owner_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'skills' / 'pero-kp-commercial-proposal'
            target.mkdir(parents=True)
            (target / 'SKILL.md').write_text('old skill', encoding='utf-8')
            (target / 'owner-note.txt').write_text('preserve', encoding='utf-8')
            backups = Path(directory) / 'backups'
            with self.assertRaises(helper.ApiError): installer.install(target, backups, 'a' * 40, lambda: {'error': 'disabled'})
            self.assertEqual((target / 'SKILL.md').read_text(encoding='utf-8'), 'old skill')
            self.assertFalse(backups.exists())
            result = installer.install(target, backups, 'a' * 40, lambda: {'documents': []})
            self.assertEqual((Path(result['backup']) / 'SKILL.md').read_text(encoding='utf-8'), 'old skill')
            self.assertEqual((target / 'owner-note.txt').read_text(encoding='utf-8'), 'preserve')
            self.assertIn('CRM', (target / 'SKILL.md').read_text(encoding='utf-8'))
            self.assertTrue((target / 'mcp' / 'client.mjs').is_file())

    def test_backup_downloads_private_pdf_once_and_reports_expired_images(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            pdf = b'%PDF-test-private'
            class Client:
                def call(self, action, **args):
                    calls.append((action, args))
                    if action == 'get': return {'id': 'doc', 'revision': 7, 'state': {'items': [{'image': 'kp-media:expired', 'image2': 'kp-media:expired'}]}}
                    if action == 'versions': return {'versions': [{'id': 'v1', 'pdfArtifactId': 'pdf'}, {'id': 'v2', 'pdfArtifactId': 'pdf'}]}
                    if action == 'media': raise helper.ApiError('Срок хранения истёк')
                    if action == 'artifact': return {'base64': base64.b64encode(pdf).decode('ascii'), 'mimeType': 'application/pdf'}
                    raise AssertionError(action)
            destination = Path(directory) / 'new-backup'
            result = helper.backup_document(Client(), 'doc', destination)
            self.assertEqual(result['pdfs'], 1)
            self.assertEqual(result['unavailable'], 1)
            self.assertEqual((destination / 'version-001.pdf').read_bytes(), pdf)
            self.assertEqual(helper.load_json(destination / 'pdfs.json')[0]['sha256'], hashlib.sha256(pdf).hexdigest())
            self.assertEqual([action for action, _ in calls].count('artifact'), 1)


if __name__ == '__main__': unittest.main()
