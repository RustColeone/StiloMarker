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

    def test_patch_cannot_cross_whole_file_replacement(self):
        self.op({'type': 'patch-file', 'path': 'note.md', 'start': 5, 'end': 5,
                 'text': '!', 'baseRevision': self.broker.revision})
        base = self.broker.revision
        self.op({'type': 'update-file', 'path': 'note.md', 'content': 'replacement', 'baseRevision': base})
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.op({'type': 'patch-file', 'path': 'note.md', 'start': 2, 'end': 2, 'text': 'BAD', 'baseRevision': base})
        self.assertEqual(self.content(self.reopen()), 'replacement')

    def test_patch_cannot_cross_delete_recreate_or_rename(self):
        for change in ('recreate', 'rename'):
            with self.subTest(change=change):
                self.op({'type': 'patch-file', 'path': 'note.md', 'start': 0, 'end': 0,
                         'text': 'x', 'baseRevision': self.broker.revision})
                base = self.broker.revision
                if change == 'recreate':
                    self.op({'type': 'delete-node', 'path': 'note.md'})
                    self.op({'type': 'create-file', 'parentPath': '', 'name': 'note.md', 'content': 'new'})
                    path = 'note.md'
                else:
                    self.op({'type': 'rename-node', 'path': 'note.md', 'name': 'renamed.md'})
                    path = 'renamed.md'
                with self.assertRaisesRegex(ValueError, 'conflict'):
                    self.op({'type': 'patch-file', 'path': path, 'start': 0, 'end': 0, 'text': 'BAD', 'baseRevision': base})

    def test_revert_and_replace_project_are_rebase_barriers(self):
        for kind in ('revert-to-revision', 'replace-project'):
            self.op({'type': 'patch-file', 'path': 'note.md', 'start': 0, 'end': 0,
                     'text': 'x', 'baseRevision': self.broker.revision})
            base = self.broker.revision
            op = {'type': kind, 'baseRevision': base, 'targetRevision': base - 1,
                  'project': copy.deepcopy(self.broker.project)}
            self.op(op)
            with self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({'type': 'patch-file', 'path': 'note.md', 'start': 0, 'end': 0, 'text': 'BAD', 'baseRevision': base})
            with self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({'type': 'update-file', 'path': 'note.md', 'content': 'BAD', 'baseRevision': base})

    def test_folder_rename_blocks_stale_descendant_writes(self):
        self.op({'type': 'create-folder', 'parentPath': '', 'name': 'old'})
        self.op({'type': 'create-file', 'parentPath': 'old', 'name': 'nested.md', 'content': 'kept'})
        base = self.broker.revision
        self.op({'type': 'rename-node', 'path': 'old', 'name': 'new'})
        for kind in ('patch-file', 'update-file'):
            with self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({'type': kind, 'path': 'new/nested.md', 'start': 0, 'end': 0,
                         'text': 'BAD', 'content': 'BAD', 'baseRevision': base})
        self.assertEqual(self.content(path='new/nested.md'), 'kept')

    def test_overlapping_or_mismatched_removals_are_not_insertions(self):
        base = self.broker.revision
        self.op({'type': 'patch-file', 'path': 'note.md', 'start': 1, 'end': 3,
                 'removedText': '😀', 'text': 'X', 'baseRevision': base})
        for revision in (base, self.broker.revision):
            with self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({'type': 'patch-file', 'path': 'note.md', 'start': 1, 'end': 3,
                         'removedText': '😀', 'text': 'BAD', 'baseRevision': revision})
        self.assertEqual(self.content(), 'AXBC')

    def test_missing_negative_and_future_patch_bases_are_refused(self):
        for base in (None, -1, self.broker.revision + 1):
            with self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({'type': 'patch-file', 'path': 'note.md', 'start': 0, 'end': 0,
                         'text': 'BAD', 'baseRevision': base})

    def test_rename_collision_is_refused(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'other.md', 'content': 'other'})
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.op({'type': 'rename-node', 'path': 'note.md', 'name': 'other.md'})
        self.assertEqual(self.content(self.reopen(), 'other.md'), 'other')
        self.assertEqual(self.content(), 'A😀BC')

    def chat(self, messages, revision=0):
        return self.broker.set_chat_workspace(self.token, {'baseRevision': revision, 'threads': [
            {'id': 'thread', 'messages': [{'id': text, 'role': 'user', 'content': text} for text in messages]}
        ]})

    def test_stale_chat_save_cannot_erase_new_messages(self):
        saved = self.chat(['original'])
        self.chat(['original', 'new'], saved['revision'])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.chat(['original'], saved['revision'])
        self.assertEqual([m['id'] for m in self.broker.get_chat_workspace(self.token)['threads'][0]['messages']], ['original', 'new'])
        self.assertEqual(self.broker.revision, 1, 'chat has an independent revision')

    def test_chat_persists_across_restart_and_returns_detached_copies(self):
        result = self.chat(['kept'])
        result['threads'].clear()
        loaded = self.reopen()
        token = loaded.connect('2468', 'reopened')['token']
        chat = loaded.get_chat_workspace(token)
        self.assertEqual(chat['revision'], 1)
        self.assertEqual(chat['threads'][0]['messages'][0]['content'], 'kept')
        chat['threads'].clear()
        self.assertEqual(len(loaded.get_chat_workspace(token)['threads']), 1)

    def test_chat_disk_failure_does_not_confirm_or_broadcast_a_save(self):
        self.chat(['kept'])
        with patch.object(server, '_atomic_write', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.chat(['kept', 'failed'], 1)
        self.assertEqual(self.broker.get_chat_workspace(self.token)['revision'], 1)
        loaded = self.reopen()
        self.assertEqual(loaded.chat_workspace['threads'][0]['messages'][0]['content'], 'kept')

    def test_concurrent_chat_saves_have_one_winner_and_one_conflict(self):
        barrier = threading.Barrier(2)
        outcomes = []
        def save(text):
            barrier.wait()
            try: self.chat([text]); outcomes.append('saved')
            except ValueError: outcomes.append('conflict')
        workers = [threading.Thread(target=save, args=(name,)) for name in ('A', 'B')]
        for worker in workers: worker.start()
        for worker in workers: worker.join()
        self.assertCountEqual(outcomes, ['saved', 'conflict'])
        self.assertEqual(self.broker.chat_workspace['revision'], 1)

    def test_chat_save_requires_revision_and_unique_merge_ids(self):
        for payload in ({'threads': []}, {'baseRevision': 0, 'threads': [{'id': 't', 'messages': [{'id': 'a'}, {'id': 'a'}]}]}):
            with self.assertRaises(ValueError): self.broker.set_chat_workspace(self.token, payload)
        self.assertEqual(self.broker.chat_workspace['revision'], 0)

    def test_stale_agent_structural_edits_are_refused(self):
        for op in ({'type': 'delete-node', 'path': 'note.md'}, {'type': 'rename-node', 'path': 'note.md', 'name': 'wrong.md'}):
            with self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({**op, 'expectedRevision': 0})
        self.assertEqual(self.content(), 'A😀BC')

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
