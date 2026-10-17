"""Workspace backups: one per day the workspace changed, plus a safety copy just
before anything destructive, so "everything was deleted" can be undone."""
import gzip
import importlib.util
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mdnotes_server', ROOT / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
DAY = 86400
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='


class WorkspaceBackupTests(unittest.TestCase):
    def setUp(self):
        self.logs = patch.object(server, '_log'); self.logs.start(); self.addCleanup(self.logs.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        data = Path(self.tmp.name) / 'data'
        accounts = server.AccountStore(None)
        accounts.users = {'alice': {'password': 'pw', 'teams': ['qa']}, 'bob': {'password': 'pw', 'teams': ['qa']},
                          'carol': {'password': 'pw', 'teams': ['other']}}
        self.reg = server.WorkspaceRegistry('2468', Path(self.tmp.name) / 'state.json', accounts=accounts, data_dir=data)
        self.alice = self.reg.identity.login('alice', 'pw')['token']
        self.reg.create_workspace(self.alice, 'qa', 'Novel')
        self.path = 'workspaces/Novel'
        self.session = self.reg.open_workspace(self.alice, 'qa', self.path)['token']
        self.broker = self.reg.brokers[f'qa/{self.path}']
        self.t0 = time.mktime((2026, 10, 1, 12, 0, 0, 0, 0, 0)) - time.timezone  # noon UTC, Oct 1

    def op(self, operation):
        return self.broker.apply_operation(self.session, operation)

    def backups(self):
        return self.reg.history.list_backups(self.alice, 'qa', self.path)['backups']

    def content(self, backup_id, file):
        return self.reg.history.get_backup_content(self.alice, 'qa', self.path, backup_id, file)['content']

    def test_backups_only_on_days_with_changes(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': '第一回.md', 'content': 'v1'})
        self.assertEqual(self.reg.backup_sweep(now=self.t0), 1, 'first sweep takes a baseline')
        self.assertEqual(self.reg.backup_sweep(now=self.t0 + 600), 0, 'nothing changed: no backup')
        self.op({'type': 'update-file', 'path': '第一回.md', 'content': 'v2', 'baseRevision': self.broker.revision})
        self.reg.backup_sweep(now=self.t0 + 1200)
        dailies = [b for b in self.backups() if b['kind'] == 'daily']
        self.assertEqual(len(dailies), 1, 'one daily per active day, refreshed rather than added')
        self.assertEqual(self.content(dailies[0]['id'], '第一回.md'), 'v2', 'it holds the day\'s latest state')
        for day in (1, 2, 3):  # three idle days
            self.assertEqual(self.reg.backup_sweep(now=self.t0 + day * DAY), 0)
        self.op({'type': 'update-file', 'path': '第一回.md', 'content': 'v3', 'baseRevision': self.broker.revision})
        self.reg.backup_sweep(now=self.t0 + 4 * DAY)
        days = sorted(b['day'] for b in self.backups() if b['kind'] == 'daily')
        self.assertEqual(days, ['2026-10-01', '2026-10-05'], 'idle days add nothing')

    def test_deleting_everything_is_recoverable(self):
        self.op({'type': 'create-folder', 'parentPath': '', 'name': '第一卷'})
        self.op({'type': 'create-file', 'parentPath': '第一卷', 'name': '第七回.md', 'content': '正文😀'})
        self.op({'type': 'create-file', 'parentPath': '', 'name': '大纲.md', 'content': 'outline'})
        self.op({'type': 'delete-node', 'path': '第一卷'})
        self.op({'type': 'delete-node', 'path': '大纲.md'})
        safety = [b for b in self.backups() if b['kind'] == 'safety']
        self.assertEqual(len(safety), 1, 'a burst of deletes shares the copy taken before it began')
        before_first = safety[0]
        files = {f['path'] for f in self.reg.history.list_backup_files(self.alice, 'qa', self.path, before_first['id'])['files']}
        self.assertEqual(files, {'第一卷/第七回.md', '大纲.md'})
        self.assertEqual(self.content(before_first['id'], '第一卷/第七回.md'), '正文😀')
        self.assertIn('第一卷', self.reg.history.list_backup_files(self.alice, 'qa', self.path, before_first['id'])['folders'])
        self.assertEqual([n for n in self.broker.project['nodes'].values() if n['kind'] == 'file'], [], 'workspace is empty now')

    def test_a_later_destructive_change_gets_its_own_copy(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'a.md', 'content': 'a'})
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'b.md', 'content': 'b'})
        with patch.object(server.time, 'time', return_value=self.t0):
            self.op({'type': 'delete-node', 'path': 'a.md'})
        with patch.object(server.time, 'time', return_value=self.t0 + 120):  # two minutes later
            self.op({'type': 'delete-node', 'path': 'b.md'})
        safety = sorted((b for b in self.backups() if b['kind'] == 'safety'), key=lambda b: b['createdAt'])
        self.assertEqual(len(safety), 2)
        later = {f['path'] for f in self.reg.history.list_backup_files(self.alice, 'qa', self.path, safety[1]['id'])['files']}
        self.assertEqual(later, {'b.md'}, 'the second copy holds the state just before the second delete')

    def test_replacing_the_whole_project_takes_a_safety_copy(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'keep.md', 'content': 'precious'})
        self.broker.set_state(self.session, self.broker._default_project(), base_revision=self.broker.revision)
        safety = [b for b in self.backups() if b['kind'] == 'safety']
        self.assertEqual(len(safety), 1)
        self.assertEqual(self.content(safety[0]['id'], 'keep.md'), 'precious')

    def test_unchanged_files_share_storage(self):
        for i in range(5):
            self.op({'type': 'create-file', 'parentPath': '', 'name': f'{i}.md', 'content': f'chapter {i} ' * 200})
        self.reg.backup_sweep(now=self.t0)
        blobs = Path(self.tmp.name) / 'data/_backups/qa/workspaces/Novel/blobs'
        before = len(list(blobs.iterdir()))
        self.op({'type': 'update-file', 'path': '0.md', 'content': 'changed', 'baseRevision': self.broker.revision})
        self.reg.backup_sweep(now=self.t0 + DAY)
        self.assertEqual(len(list(blobs.iterdir())), before + 1, 'a second day stores only what changed')

    def test_retention_keeps_recent_days_then_weekly_then_monthly(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'a.md', 'content': 'x'})
        for day in range(120):  # four months of daily writing
            self.op({'type': 'update-file', 'path': 'a.md', 'content': f'day {day}', 'baseRevision': self.broker.revision})
            self.reg.backup_sweep(now=self.t0 + day * DAY)
        days = sorted({b['day'] for b in self.backups() if b['kind'] == 'daily'})
        self.assertLessEqual(len(days), 14 + 8 + 6)
        self.assertGreaterEqual(len(days), 14, 'every one of the last 14 active days')
        self.assertEqual(days[-1], time.strftime('%Y-%m-%d', time.gmtime(self.t0 + 119 * DAY)))
        index = self.reg.history.backups.store('qa', self.path).load()
        referenced = {e['blob'] for b in index['backups'] for e in b['files']}
        stored = {p.name[:-3] for p in (Path(self.tmp.name) / 'data/_backups/qa/workspaces/Novel/blobs').iterdir()}
        self.assertEqual(stored, referenced, 'pruned backups release their blobs; nothing orphaned or missing')

    def test_images_are_backed_up_from_disk(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'map.png', 'content': PNG})
        self.reg.backup_sweep(now=self.t0)
        backup = self.backups()[0]
        restored = self.content(backup['id'], 'map.png')
        self.assertTrue(restored.startswith('data:image/png;base64,'))
        self.assertEqual(restored.split(',', 1)[1], PNG.split(',', 1)[1])

    def test_permissions(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'a.md', 'content': 'x'})
        self.reg.set_access(self.alice, 'qa', self.path, [], [], ['bob'])  # bob becomes a reader
        bob = self.reg.identity.login('bob', 'pw')['token']
        self.reg.history.list_backups(bob, 'qa', self.path)  # readers may look
        with self.assertRaises(PermissionError):
            self.reg.history.create_backup(bob, 'qa', self.path)
        carol = self.reg.identity.login('carol', 'pw')['token']
        with self.assertRaises((PermissionError, ValueError)):
            self.reg.history.list_backups(carol, 'qa', self.path)
        self.assertTrue(self.reg.history.create_backup(self.alice, 'qa', self.path, 'by hand')['created'])

    def test_backups_live_outside_the_project_folder(self):
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'a.md', 'content': 'x'})
        self.reg.backup_sweep(now=self.t0)
        project_dir = self.broker.workspace_dir
        self.assertFalse(any('_backups' in str(p) for p in project_dir.rglob('*')))

    def test_shutdown_takes_a_final_backup(self):
        httpd = server.build_server('127.0.0.1', 0, '2468', ROOT, Path(self.tmp.name) / 's.json',
                                    data_dir=Path(self.tmp.name) / 'data')
        httpd.RequestHandlerClass.keywords['registry'].brokers.update(self.reg.brokers)
        reg = httpd.RequestHandlerClass.keywords['registry']
        reg.data_dir = self.reg.data_dir
        self.op({'type': 'create-file', 'parentPath': '', 'name': 'late.md', 'content': 'written just before a restart'})
        httpd.server_close()
        names = {f['path'] for b in self.reg.history.list_backups(self.alice, 'qa', self.path)['backups']
                 for f in self.reg.history.list_backup_files(self.alice, 'qa', self.path, b['id'])['files']}
        self.assertIn('late.md', names)


if __name__ == '__main__':
    unittest.main()
