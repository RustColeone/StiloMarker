"""move-node on the production broker: a drag must MOVE, never leave a copy.

Before this operation existed, a drag changed only the dragging browser's tree;
the server kept the old path, and the next reconnect's reconcile uploaded the
file again at its new path — so both existed. These tests pin the server side:
paths move on disk, the order matches the browser's moveNode() exactly, unsafe
moves are refused as conflicts, and stale text patches cannot cross a move."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mdnotes_server', ROOT / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
from stilo.modules.sync import open_live  # noqa: E402
from stilo.modules.workspace import node_id_by_path  # noqa: E402
CASES = json.loads((ROOT / 'spec/workspace/move-node.cases.json').read_text(encoding='utf-8'))


class MoveNodeTests(unittest.TestCase):
    def setUp(self):
        self.logs = patch.object(server, '_log'); self.logs.start(); self.addCleanup(self.logs.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name) / 'workspace'
        self.broker = open_live('2468', folder=self.directory)
        self.token = self.broker.connect('2468', 'Tester')['token']

    def op(self, operation):
        return self.broker.apply_operation(self.token, operation)

    def reopen(self):
        return open_live('2468', folder=self.directory)

    def names(self, broker, folder_path=''):
        folder = node_id_by_path(broker.project, folder_path) if folder_path else broker.project['rootId']
        return [broker.project['nodes'][c]['name'] for c in broker.project['nodes'][folder]['children']]

    def test_file_moves_on_disk_without_leaving_a_copy(self):
        self.op({'type': 'create-folder', 'parentPath': '', 'name': '第一卷'})
        self.op({'type': 'create-file', 'parentPath': '', 'name': '第七回试写.md', 'content': '正文'})
        self.op({'type': 'move-node', 'path': '第七回试写.md', 'parentPath': '第一卷'})
        reopened = self.reopen()
        self.assertIsNotNone(node_id_by_path(reopened.project, '第一卷/第七回试写.md'))
        self.assertIsNone(node_id_by_path(reopened.project, '第七回试写.md'), 'old path must be gone')
        self.assertFalse((self.directory / '第七回试写.md').exists(), 'old file must be removed from disk')
        self.assertEqual((self.directory / '第一卷' / '第七回试写.md').read_text(encoding='utf-8'), '正文')

    def test_folder_moves_with_everything_inside_it(self):
        for path, name in (('', 'A'), ('', 'B'), ('A', 'inner')):
            self.op({'type': 'create-folder', 'parentPath': path, 'name': name})
        self.op({'type': 'create-file', 'parentPath': 'A/inner', 'name': 'deep.md', 'content': 'deep'})
        self.op({'type': 'move-node', 'path': 'A', 'parentPath': 'B'})
        reopened = self.reopen()
        self.assertIsNotNone(node_id_by_path(reopened.project, 'B/A/inner/deep.md'))
        self.assertIsNone(node_id_by_path(reopened.project, 'A'))
        self.assertFalse((self.directory / 'A').exists())
        self.assertEqual((self.directory / 'B/A/inner/deep.md').read_text(encoding='utf-8'), 'deep')

    def test_order_matches_the_browser_for_every_shared_case(self):
        for case in CASES['cases']:
            with self.subTest(case=case['name']):
                self.setUp()
                for name in CASES['start']:
                    self.op({'type': 'create-file', 'parentPath': '', 'name': name, 'content': name})
                move = {'type': 'move-node', 'path': case['move'], 'parentPath': ''}
                if case['index'] is not None:
                    move['index'] = case['index']
                self.op(move)
                self.assertEqual(self.names(self.broker), case['expect'])
                self.assertEqual(self.names(self.reopen()), case['expect'], 'order must persist')

    def test_unsafe_moves_are_refused_as_conflicts_and_change_nothing(self):
        self.op({'type': 'create-folder', 'parentPath': '', 'name': 'A'})
        self.op({'type': 'create-folder', 'parentPath': 'A', 'name': 'child'})
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'Note.md', 'content': 'x'})
        self.op({'type': 'create-file', 'parentPath': 'A', 'name': 'note.md', 'content': 'y'})
        revision = self.broker.revision
        for bad in ({'path': 'A', 'parentPath': 'A/child'},          # into its own descendant
                    {'path': 'A', 'parentPath': 'A'},                # into itself
                    {'path': 'Note.md', 'parentPath': 'A'}):         # case-insensitive name clash
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, 'conflict'):
                self.op({'type': 'move-node', **bad})
        for bad in ({'path': 'missing.md', 'parentPath': ''},
                    {'path': 'Note.md', 'parentPath': 'A/note.md'}):  # target is a file
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.op({'type': 'move-node', **bad})
        self.assertEqual(self.broker.revision, revision, 'a refused move must not bump the revision')
        self.assertIsNotNone(self.reopen()._get_node_id_by_path('Note.md'))

    def test_a_stale_text_patch_cannot_cross_the_move(self):
        self.op({'type': 'create-folder', 'parentPath': '', 'name': 'A'})
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'note.md', 'content': 'hello'})
        base = self.broker.revision
        self.op({'type': 'move-node', 'path': 'note.md', 'parentPath': 'A'})
        with self.assertRaises(ValueError):  # the old path no longer exists
            self.op({'type': 'patch-file', 'path': 'note.md', 'start': 0, 'end': 0, 'text': 'X', 'baseRevision': base})
        with self.assertRaisesRegex(ValueError, 'conflict'):  # the new path changed after that base
            self.op({'type': 'patch-file', 'path': 'A/note.md', 'start': 0, 'end': 0, 'text': 'X', 'baseRevision': base})
        # Based on the post-move revision it applies normally.
        self.op({'type': 'patch-file', 'path': 'A/note.md', 'start': 5, 'end': 5, 'text': '!', 'baseRevision': self.broker.revision})
        self.assertEqual((self.directory / 'A/note.md').read_text(encoding='utf-8'), 'hello!')

    def test_moved_image_keeps_its_bytes(self):
        png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        self.op({'type': 'create-folder', 'parentPath': '', 'name': 'img'})
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'dot.png', 'content': png})
        before = (self.directory / 'dot.png').read_bytes()
        self.op({'type': 'move-node', 'path': 'dot.png', 'parentPath': 'img'})
        self.assertFalse((self.directory / 'dot.png').exists())
        self.assertEqual((self.directory / 'img/dot.png').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
