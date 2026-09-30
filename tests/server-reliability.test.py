"""No HTTP listener: exercise the production broker using temporary workspaces."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mdnotes_server', Path(__file__).resolve().parents[1] / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.logs = patch.object(server, '_log')
        self.logs.start()
        self.addCleanup(self.logs.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name) / 'workspace'
        self.broker = server.CollaborationBroker('2468', None, workspace_dir=self.directory)
        self.token = self.broker.connect('2468', 'Tester')['token']
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'note.md', 'content': 'A😀BC'})

    def op(self, operation):
        return self.broker.apply_operation(self.token, operation)

    def content(self, broker=None, path='note.md'):
        broker = broker or self.broker
        return broker.project['nodes'][broker._get_node_id_by_path(path)]['content']

    def reopen(self):
        return server.CollaborationBroker('2468', None, workspace_dir=self.directory)

    def test_concurrent_create_cannot_overwrite_an_existing_path(self):
        revision = self.broker.revision
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.op({'type': 'create-file', 'parentPath': '', 'name': 'note.md', 'content': 'stale'})
        self.assertEqual(self.broker.revision, revision)
        self.assertEqual(self.content(self.reopen()), 'A😀BC')

    def test_existing_broker_regressions(self):
        server.run_broker_selftest(Path(self.tmp.name) / 'legacy.json')

    def test_unicode_insert_delete_replace_and_append(self):
        for start, end, removed, text, expected in [
            (3, 3, '', 'X', 'A😀XBC'),
            (1, 3, '😀', '😁', 'A😁XBC'),
            (1, 3, '😁', '', 'AXBC'),
            (4, 4, '', '🎲', 'AXBC🎲'),
        ]:
            self.op({'type': 'patch-file', 'path': 'note.md', 'start': start, 'end': end,
                     'removedText': removed, 'text': text, 'baseRevision': self.broker.revision})
            self.assertEqual(self.content(), expected)
            self.assertEqual(self.content(self.reopen()), expected)

    def test_unicode_rebase_uses_browser_units(self):
        base = self.broker.revision
        self.op({'type': 'patch-file', 'path': 'note.md', 'start': 0, 'end': 0,
                 'text': '🎲', 'baseRevision': base})
        event = self.op({'type': 'patch-file', 'path': 'note.md', 'start': 3, 'end': 3,
                         'text': '!', 'baseRevision': base})
        self.assertEqual(self.content(), '🎲A😀!BC')
        self.assertEqual(event['operation']['start'], 5)

    def test_split_surrogate_is_rejected_without_changing_content(self):
        with self.assertRaisesRegex(ValueError, 'Unicode'):
            self.op({'type': 'patch-file', 'path': 'note.md', 'start': 2, 'end': 2,
                     'text': '!', 'baseRevision': self.broker.revision})
        self.assertEqual(self.content(), 'A😀BC')

    def test_unchanged_notes_are_not_rewritten(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'other.md', 'content': 'keep'})
        with patch.object(server, '_atomic_write', wraps=server._atomic_write) as writes:
            self.op({'type': 'update-file', 'path': 'note.md', 'content': 'changed', 'baseRevision': self.broker.revision})
        paths = [call.args[0].name for call in writes.call_args_list]
        self.assertNotIn('other.md', paths)
        self.assertEqual((self.directory / 'other.md').read_text(), 'keep')

    def test_crash_at_each_commit_step_recovers_a_complete_revision(self):
        # Journal, changed document, manifest. Before the journal commits the old
        # version survives; after it commits restart rolls forward the new one.
        for fail_at in (1, 2, 3):
            with self.subTest(fail_at=fail_at):
                old_revision = self.broker.revision
                old_text = self.content()
                text = f'new draft {fail_at}'
                original = server._atomic_write
                calls = 0
                def fail(path, data):
                    nonlocal calls
                    calls += 1
                    if calls == fail_at:
                        raise OSError('simulated disk failure')
                    return original(path, data)
                with patch.object(server, '_atomic_write', side_effect=fail):
                    with self.assertRaises(OSError):
                        self.op({'type': 'update-file', 'path': 'note.md', 'content': text, 'baseRevision': old_revision})
                recovered = self.reopen()
                self.assertEqual(self.content(recovered), old_text if fail_at == 1 else text)
                self.assertEqual(recovered.revision, old_revision if fail_at == 1 else old_revision + 1)
                self.assertFalse((self.directory / '.pending-state.json').exists())
                # The still-running broker also recovers before accepting reads.
                state = self.broker.get_state(self.token)
                self.assertEqual(state['revision'], recovered.revision)
                self.assertEqual(self.content(), self.content(recovered))

    def test_atomic_replace_failure_leaves_original_document_intact(self):
        path = self.directory / 'note.md'
        with patch.object(server.os, 'replace', side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):
                server._atomic_write(path, b'incomplete replacement')
        self.assertEqual(path.read_text(), 'A😀BC')
        self.assertFalse(list(self.directory.glob('.*.tmp')))

    def test_directory_rename_replays_text_and_image_after_failure(self):
        self.op({'type': 'create-folder', 'name': 'old', 'parentPath': ''})
        self.op({'type': 'create-file', 'name': 'a.md', 'parentPath': 'old', 'content': 'story'})
        self.op({'type': 'create-file', 'name': 'a.png', 'parentPath': 'old', 'content': 'data:image/png;base64,YWJj'})
        original = server._atomic_write
        def fail(path, data):
            if path.name == 'manifest.json':
                raise OSError('crashed before manifest')
            return original(path, data)
        with patch.object(server, '_atomic_write', side_effect=fail):
            with self.assertRaises(OSError):
                self.op({'type': 'rename-node', 'path': 'old', 'name': 'new'})
        recovered = self.reopen()
        self.assertEqual(self.content(recovered, 'new/a.md'), 'story')
        self.assertEqual((self.directory / 'new/a.png').read_bytes(), b'abc')
        self.assertFalse((self.directory / 'old').exists())

    def test_publish_keeps_externalized_images_and_metadata(self):
        self.op({'type': 'create-file', 'name': 'a.png', 'parentPath': '', 'content': 'data:image/png;base64,YWJj'})
        (self.directory / 'comments.json').write_text('{"keep":true}')
        replacement = copy.deepcopy(self.broker.project)
        self.broker.set_state(self.token, replacement, self.broker.revision)
        self.assertEqual((self.directory / 'a.png').read_bytes(), b'abc')
        self.assertEqual((self.directory / 'comments.json').read_text(), '{"keep":true}')

    def test_state_snapshot_is_immutable_and_stream_starts_with_ready(self):
        snapshot = self.broker.get_state(self.token)
        queue = self.broker.subscribe(self.token)
        revision = self.broker.revision
        self.op({'type': 'update-file', 'path': 'note.md', 'content': 'next', 'baseRevision': revision})
        self.assertEqual(queue.get_nowait()['type'], 'ready')
        self.assertEqual(queue.get_nowait()['revision'], revision + 1)
        self.assertEqual(snapshot['project']['nodes'][self.broker._get_node_id_by_path('note.md')]['content'], 'A😀BC')

    def test_concurrent_broadcasts_follow_committed_revision_order(self):
        events = self.broker.subscribe(self.token)
        events.get_nowait()
        original = self.broker._broadcast
        entered = threading.Event()
        release = threading.Event()
        def pause_first(event, *args, **kwargs):
            if event['type'] == 'operation' and event['revision'] == 2:
                entered.set()
                release.wait(2)
            return original(event, *args, **kwargs)
        failures = []
        def create(name):
            try:
                self.op({'type': 'create-file', 'name': name, 'parentPath': '', 'content': name})
            except Exception as error:
                failures.append(error)
        with patch.object(self.broker, '_broadcast', side_effect=pause_first):
            first = threading.Thread(target=create, args=('first.md',))
            second = threading.Thread(target=create, args=('second.md',))
            first.start(); self.assertTrue(entered.wait(2)); second.start()
            release.set(); first.join(); second.join()
        self.assertEqual(failures, [])
        self.assertEqual([events.get_nowait()['revision'], events.get_nowait()['revision']], [2, 3])


if __name__ == '__main__':
    unittest.main()
