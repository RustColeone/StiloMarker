"""Chats: per-project conversations between people and characters (SQLite)."""
import importlib.util
import json
import queue
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from stilo.modules.chats.adapters import store as chats  # noqa: E402

spec = importlib.util.spec_from_file_location('mdnotes_server', ROOT / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

ARIA = 'char:Cast/aria.persona.skill'
LEO, AMY, BEN = 'user:leo', 'user:amy', 'user:ben'


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.store = chats.ProjectChats(Path(self.tmp.name) / chats.DB_NAME)
        self.addCleanup(self.store.close)

    def test_a_pair_is_reused_and_order_does_not_matter(self):
        first, created = self.store.start(LEO, [AMY])
        again, created_again = self.store.start(AMY, [LEO])
        self.assertTrue(created); self.assertFalse(created_again)
        self.assertEqual(first['id'], again['id'])
        self.assertEqual(first['kind'], 'pair')
        with self.assertRaises(ValueError):
            self.store.start(LEO, [])  # alone
        with self.assertRaises(ValueError):
            self.store.start(LEO, ['amy'])  # not a member key

    def test_inviting_into_a_pair_starts_a_new_group_and_keeps_the_pair(self):
        pair, _ = self.store.start(LEO, [AMY])
        self.store.send(LEO, pair['id'], 'just us')
        group, created = self.store.invite(LEO, pair['id'], [BEN])
        self.assertTrue(created)
        self.assertNotEqual(group['id'], pair['id'])
        self.assertEqual(group['kind'], 'group')
        self.assertEqual(sorted(group['members']), sorted([LEO, AMY, BEN]))
        self.assertEqual(sorted(self.store.members(pair['id'])), sorted([LEO, AMY]))
        self.assertEqual([m['content'] for m in self.store.messages(AMY, pair['id'])], ['just us'])
        self.assertEqual(self.store.messages(BEN, group['id']), [])  # the new group starts empty
        # Inviting into a group adds to that same group.
        same, created = self.store.invite(AMY, group['id'], [ARIA])
        self.assertFalse(created); self.assertEqual(same['id'], group['id'])
        self.assertIn(ARIA, same['members'])
        with self.assertRaises(ValueError):
            self.store.invite(AMY, group['id'], [ARIA])  # already there

    def test_members_only(self):
        pair, _ = self.store.start(LEO, [AMY])
        self.store.send(LEO, pair['id'], 'secret')
        for call in (lambda: self.store.messages(BEN, pair['id']), lambda: self.store.send(BEN, pair['id'], 'hi'),
                     lambda: self.store.get(BEN, pair['id']), lambda: self.store.search(BEN, pair['id'], 'secret'),
                     lambda: self.store.messages(LEO, 'nope')):
            with self.assertRaises(LookupError):
                call()
        self.assertEqual(self.store.list_for(BEN), [])
        with self.assertRaises(LookupError):
            self.store.post_as(pair['id'], ARIA, 'Aria', 'not in this chat')

    def test_unread_counts_and_read_pointer(self):
        pair, _ = self.store.start(LEO, [AMY])
        for text in ('one', 'two', 'three'):
            self.store.send(LEO, pair['id'], text)
        self.assertEqual(self.store.get(AMY, pair['id'])['unread'], 3)
        self.assertEqual(self.store.get(LEO, pair['id'])['unread'], 0)  # your own messages are read
        second = self.store.messages(AMY, pair['id'])[1]['id']
        self.store.mark_read(AMY, pair['id'], second)
        self.assertEqual(self.store.get(AMY, pair['id'])['unread'], 1)
        self.store.mark_read(AMY, pair['id'], 10 ** 9)  # clamps to the last message
        self.assertEqual(self.store.get(AMY, pair['id'])['unread'], 0)
        self.store.mark_read(AMY, pair['id'], 1)  # never moves backwards
        self.assertEqual(self.store.get(AMY, pair['id'])['unread'], 0)

    def test_paging(self):
        pair, _ = self.store.start(LEO, [AMY])
        ids = [self.store.send(LEO, pair['id'], f'm{i}')['id'] for i in range(120)]
        newest = self.store.messages(AMY, pair['id'])
        self.assertEqual([m['id'] for m in newest], ids[-50:])
        older = self.store.messages(AMY, pair['id'], before=newest[0]['id'])
        self.assertEqual([m['id'] for m in older], ids[-100:-50])
        since = self.store.messages(AMY, pair['id'], after=ids[-3])
        self.assertEqual([m['id'] for m in since], ids[-2:])

    def test_search_with_full_text_and_without(self):
        pair, _ = self.store.start(LEO, [AMY])
        self.store.send(LEO, pair['id'], 'The lighthouse keeper hid a letter')
        self.store.send(AMY, pair['id'], 'Ask her about the letters')
        self.store.send(LEO, pair['id'], 'Something else: 50% off')
        for fts in (True, False):
            self.store.fts = fts and self.store.fts
            found = self.store.search(AMY, pair['id'], 'lett')
            self.assertEqual(len(found), 2, f'fts={self.store.fts}')
            self.assertEqual(len(self.store.search(AMY, pair['id'], 'lighthouse letter')), 1)
            self.assertEqual(len(self.store.search(AMY, pair['id'], '50%')), 1)
            self.assertEqual(self.store.search(AMY, pair['id'], '   '), [])
            self.assertEqual(self.store.search(AMY, pair['id'], 'quote"s'), [])
        self.assertTrue(chats.ProjectChats(Path(self.tmp.name) / 'other.sqlite').fts, 'this SQLite has FTS5')

    def test_notes_are_private_to_their_owner(self):
        self.store.set_note(LEO, AMY, alias='Captain', note='plays Aria')
        self.assertEqual(self.store.notes_for(LEO)[AMY]['alias'], 'Captain')
        self.assertEqual(self.store.notes_for(AMY), {})
        self.store.set_note(LEO, AMY, '', '')  # clearing removes it
        self.assertEqual(self.store.notes_for(LEO), {})

    def test_groups_can_be_left_and_renamed_pairs_cannot(self):
        pair, _ = self.store.start(LEO, [AMY])
        group, _ = self.store.start(LEO, [AMY, BEN])
        with self.assertRaises(ValueError):
            self.store.leave(LEO, pair['id'])
        with self.assertRaises(ValueError):
            self.store.rename(LEO, pair['id'], 'x')
        self.assertEqual(self.store.rename(AMY, group['id'], ' Night watch ')['title'], 'Night watch')
        self.store.leave(BEN, group['id'])
        with self.assertRaises(LookupError):
            self.store.messages(BEN, group['id'])

    def test_characters_follow_their_files(self):
        pair, _ = self.store.start(LEO, [ARIA])
        self.store.post_as(pair['id'], ARIA, 'Aria', 'Aye.')
        self.store.set_note(LEO, ARIA, alias='Cap')
        self.assertEqual(self.store.rename_character_paths('Cast', 'People/Cast'), 3)  # member, author, note
        moved = 'char:People/Cast/aria.persona.skill'
        self.assertEqual(sorted(self.store.members(pair['id'])), sorted([LEO, moved]))
        self.assertEqual(self.store.messages(LEO, pair['id'])[0]['author'], moved)
        self.assertIn(moved, self.store.notes_for(LEO))
        again, created = self.store.start(LEO, [moved])
        self.assertFalse(created); self.assertEqual(again['id'], pair['id'])  # the pair key followed too

    def test_backup_copy_is_a_readable_database(self):
        pair, _ = self.store.start(LEO, [AMY])
        self.store.send(LEO, pair['id'], 'keep me')
        copy = Path(self.tmp.name) / 'b' / 'copy.sqlite'
        self.store.backup_to(copy)
        restored = chats.ProjectChats(copy)
        self.addCleanup(restored.close)
        self.assertEqual(restored.messages(AMY, pair['id'])[0]['content'], 'keep me')


class RegistryBase(unittest.TestCase):
    """A registry with three teammates in one shared project, all subscribed to
    its live events, and one character file."""
    def setUp(self):
        self.logs = patch.object(server, '_log'); self.logs.start(); self.addCleanup(self.logs.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        accounts = server.AccountStore(None)
        accounts.users = {name: {'password': 'pw', 'teams': ['qa']} for name in ('leo', 'amy', 'ben')}
        accounts.users['eve'] = {'password': 'pw', 'teams': ['other']}
        self.data = Path(self.tmp.name) / 'data'
        self.reg = server.WorkspaceRegistry('2468', Path(self.tmp.name) / 'state.json', accounts=accounts, data_dir=self.data)
        self.addCleanup(self.reg.chats.close)
        self.tokens = {name: self.reg.identity.login(name, 'pw')['token'] for name in ('leo', 'amy', 'ben', 'eve')}
        self.reg.projects.create_workspace(self.tokens['leo'], 'qa', 'Novel', share_team=True)
        self.path = 'workspaces/Novel'
        self.sessions = {name: self.reg.open_workspace(self.tokens[name], 'qa', self.path)['token'] for name in ('leo', 'amy', 'ben')}
        self.broker = self.reg.brokers[f'qa/{self.path}']
        self.queues = {name: self.broker.subscribe(token) for name, token in self.sessions.items()}
        for q in self.queues.values():
            q.get_nowait()  # the "ready" event
        self.op({'type': 'create-folder', 'parentPath': '', 'name': 'Cast'})
        self.op({'type': 'create-file', 'parentPath': 'Cast', 'name': 'aria.persona.skill',
                 'content': '---\nname: Captain Aria Voss\n---\nA smuggler.'})

    def op(self, operation):
        return self.broker.apply_operation(self.sessions['leo'], {**operation, 'baseRevision': self.broker.revision})

    def call(self, name, method, *args):
        return getattr(self.reg.chats, method)(self.tokens[name], 'qa', self.path, *args)

    def events(self, name, kind):
        out, q = [], self.queues[name]
        while True:
            try:
                event = q.get_nowait()
            except queue.Empty:
                return out
            if event.get('type') == kind:
                out.append(event)

class RegistryTests(RegistryBase):
    def test_contacts_are_people_with_access_and_the_project_characters(self):
        overview = self.call('leo', 'overview')
        self.assertEqual(overview['me'], LEO)
        self.assertEqual([p['username'] for p in overview['people']], ['amy', 'ben', 'leo'])
        self.assertTrue(all(p['online'] for p in overview['people']))
        self.assertEqual(overview['characters'], [{'key': ARIA, 'path': 'Cast/aria.persona.skill',
                                                   'name': 'Captain Aria Voss', 'handle': 'aria'}])
        with self.assertRaises(PermissionError):
            self.call('eve', 'overview')  # not in the team

    def test_only_project_people_and_real_characters_can_join(self):
        with self.assertRaises(ValueError):
            self.call('leo', 'start', ['user:eve'])
        with self.assertRaises(ValueError):
            self.call('leo', 'start', ['char:Cast/ghost.persona.skill'])
        result = self.call('leo', 'start', [AMY])
        self.assertTrue(result['created'])

    def test_messages_go_live_to_members_only(self):
        pair = self.call('leo', 'start', [AMY])['conversation']
        self.assertEqual(len(self.events('amy', 'chat-update')), 1)  # amy sees the new chat
        self.assertEqual(self.events('ben', 'chat-update'), [])
        self.call('leo', 'send', pair['id'], 'hello amy')
        [event] = self.events('amy', 'chat-message')
        self.assertEqual(event['message']['content'], 'hello amy')
        self.assertEqual(event['conversationId'], pair['id'])
        self.assertEqual(len(self.events('leo', 'chat-message')), 1)  # the sender's other tabs too
        self.assertEqual(self.events('ben', 'chat-message'), [])  # not a member: nothing at all

    def test_send_hands_new_messages_to_the_reply_hook(self):
        seen = []
        self.reg.chats.on_message = lambda reg, team, relpath, conversation, message, identity, options: seen.append(
            (conversation['id'], message['content'], identity['username'], options['model']))
        pair = self.call('leo', 'start', [ARIA])['conversation']
        self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], 'Ahoy', [], {'model': 'gpt-5.5'})
        self.assertEqual(seen, [(pair['id'], 'Ahoy', 'leo', 'gpt-5.5')])

    def test_moving_a_character_file_moves_it_in_chats(self):
        pair = self.call('leo', 'start', [ARIA])['conversation']
        self.op({'type': 'rename-node', 'path': 'Cast/aria.persona.skill', 'name': 'captain.persona.skill'})
        members = lambda: [m for m in self.reg.chats.store('qa', self.path).members(pair['id']) if m.startswith('char:')]
        self.assertEqual(members(), ['char:Cast/captain.persona.skill'])
        self.op({'type': 'move-node', 'path': 'Cast', 'parentPath': '', 'index': 0})  # a no-op path: same place
        self.op({'type': 'create-folder', 'parentPath': '', 'name': 'People'})
        self.op({'type': 'move-node', 'path': 'Cast', 'parentPath': 'People'})
        self.assertEqual(members(), ['char:People/Cast/captain.persona.skill'])

    def test_the_database_survives_a_publish_and_is_never_a_project_file(self):
        pair = self.call('leo', 'start', [AMY])['conversation']
        self.call('leo', 'send', pair['id'], 'still here')
        folder = self.data / 'team_qa' / 'workspaces' / 'Novel'
        self.assertTrue((folder / chats.DB_NAME).is_file())
        # Publishing replaces the whole tree: the folder is wiped and rewritten.
        project = json.loads(json.dumps(self.broker.project))
        self.broker.apply_operation(self.sessions['leo'], {'type': 'replace-project', 'project': project,
                                                          'baseRevision': self.broker.revision})
        self.assertTrue((folder / chats.DB_NAME).is_file())
        self.assertEqual(self.call('amy', 'messages', pair['id'])['messages'][0]['content'], 'still here')
        self.assertNotIn(chats.DB_NAME, json.dumps(self.broker.project))
        self.assertTrue(all(self.reg.projects.is_reserved(name) for name in chats.SIDE_FILES))

    def test_chats_get_a_daily_backup_only_when_they_changed(self):
        pair = self.call('leo', 'start', [AMY])['conversation']
        self.call('leo', 'send', pair['id'], 'one')
        self.reg.backup_sweep(now=time.mktime((2026, 10, 1, 12, 0, 0, 0, 0, 0)))
        folder = self.reg.history.backups.store('qa', self.path).folder / 'chats'
        self.assertEqual([p.name for p in folder.glob('*.sqlite')], ['2026-10-01.sqlite'])
        self.reg.backup_sweep(now=time.mktime((2026, 10, 2, 12, 0, 0, 0, 0, 0)))
        self.assertEqual(len(list(folder.glob('*.sqlite'))), 1, 'no change: no new copy')
        self.call('amy', 'send', pair['id'], 'two')
        self.reg.backup_sweep(now=time.mktime((2026, 10, 3, 12, 0, 0, 0, 0, 0)))
        self.assertEqual(len(list(folder.glob('*.sqlite'))), 2)

    def test_old_roleplay_threads_import_as_groups(self):
        result = self.call('leo', 'import_group', 'Storm', ['Cast/aria.persona.skill', 'Cast/ghost.persona.skill'], [
            {'role': 'user', 'content': 'The lamp is out', 'authorName': 'Leo', 'createdAt': 1_700_000_000_000},
            {'role': 'assistant', 'content': 'Bail faster.', 'speaker': 'Cast/aria.persona.skill', 'speakerName': 'Aria'},
            {'role': 'assistant', 'content': 'ghost line', 'speaker': 'Cast/ghost.persona.skill'},
            {'role': 'system', 'content': 'Stopped before the agent replied.'},
            {'role': 'assistant', 'content': 'half a', 'speaker': 'Cast/aria.persona.skill', 'interrupted': True}])
        conversation = result['conversation']
        self.assertEqual((conversation['kind'], conversation['title']), ('group', 'Storm'))
        self.assertEqual(sorted(conversation['members']), sorted([LEO, ARIA]))  # the missing character is dropped
        messages = self.call('leo', 'messages', conversation['id'])['messages']
        self.assertEqual([(m['author'], m['content'], m['state']) for m in messages],
                         [(LEO, 'The lamp is out', 'done'), (ARIA, 'Bail faster.', 'done'), (ARIA, 'half a', 'interrupted')])
        self.assertAlmostEqual(messages[0]['createdAt'], 1_700_000_000)
        self.assertEqual(conversation['unread'], 0)
        with self.assertRaises(LookupError):
            self.call('amy', 'messages', conversation['id'])  # imported for the importer only

    def test_notes_and_search_through_the_registry(self):
        pair = self.call('leo', 'start', [AMY])['conversation']
        self.call('leo', 'send', pair['id'], 'The lamp went dark')
        self.call('leo', 'note', AMY, 'Captain', 'plays Aria')
        self.assertEqual(self.call('leo', 'overview')['notes'][AMY]['alias'], 'Captain')
        self.assertEqual(self.call('amy', 'overview')['notes'], {})
        self.assertEqual(len(self.call('amy', 'search', pair['id'], 'lamp')['results']), 1)
        with self.assertRaises(LookupError):
            self.call('ben', 'search', pair['id'], 'lamp')



class FakeProxy:
    """Stands in for ChatProxy.chat: streams a reply and records each turn."""
    def __init__(self, reply=lambda persona, messages: f"{persona['name']} says hi", fail=None, hold=None):
        self.turns, self.reply, self.fail, self.hold = [], reply, fail, hold

    def chat(self, messages, context_files, project_name, client_project=None, progress=None, model=None,
             cancelled=None, identity=None, persona=None, cast=None, **_):
        self.turns.append({'persona': persona, 'messages': messages, 'cast': cast, 'model': model,
                           'identity': identity, 'context': context_files})
        progress({'type': 'status', 'iteration': 0})
        text = self.reply(persona, messages)
        for word in text.split(' '):
            progress({'type': 'delta', 'text': word + ' '})
            if self.hold:
                self.hold.wait(5)
            if cancelled and cancelled():
                raise RuntimeError('Chat stopped.')
        if self.fail:
            raise RuntimeError(self.fail)
        return {'message': text}


class ReplyTests(RegistryBase):
    def setUp(self):
        super().setUp()
        self.op({'type': 'create-file', 'parentPath': 'Cast', 'name': 'bram.persona.skill',
                 'content': '## Who\nA nervous cook.'})
        self.reg.chats.runner = FakeProxy()
        self.reg.chats.typing_interval = 0

    def wait(self, pair_id):
        key = f'qa/{self.path}#{pair_id}'
        for _ in range(200):
            if not self.reg.chats.replies.busy(key):
                return
            time.sleep(0.02)
        self.fail('replies did not finish')

    def test_a_private_chat_with_a_character_gets_a_reply_to_every_message(self):
        pair = self.call('leo', 'start', [ARIA])['conversation']
        sent = self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], 'Ahoy', [], {'model': 'gpt-5.5'})
        self.assertEqual(sent['replies'], [ARIA])
        self.wait(pair['id'])
        messages = self.call('leo', 'messages', pair['id'])['messages']
        self.assertEqual([(m['author'], m['content'], m['state']) for m in messages],
                         [(LEO, 'Ahoy', 'done'), (ARIA, 'Captain Aria Voss says hi', 'done')])
        turn = self.reg.chats.runner.turns[0]
        self.assertEqual(turn['persona']['name'], 'Captain Aria Voss')
        self.assertEqual(turn['messages'], [{'name': 'leo', 'content': 'Ahoy', 'self': False}])
        self.assertEqual(turn['model'], 'gpt-5.5')
        self.assertEqual(turn['identity']['username'], 'leo')
        typing = [e['state'] for e in self.events('leo', 'chat-typing')]
        self.assertEqual(typing[0], 'queued'); self.assertEqual(typing[-1], 'end'); self.assertIn('writing', typing)
        self.assertEqual(self.events('amy', 'chat-typing'), [])  # a private chat stays private, live too

    def test_in_a_group_only_mentioned_characters_reply_in_order(self):
        group = self.call('leo', 'start', [AMY, ARIA, 'char:Cast/bram.persona.skill'])['conversation']
        self.assertEqual(self.reg.chats.send(self.tokens['leo'], 'qa', self.path, group['id'], 'The storm hits.')['replies'], [])
        sent = self.reg.chats.send(self.tokens['amy'], 'qa', self.path, group['id'], '@bram then @aria: what now?')
        self.assertEqual(sent['replies'], ['char:Cast/bram.persona.skill', ARIA])
        self.wait(group['id'])
        authors = [m['author'] for m in self.call('leo', 'messages', group['id'])['messages']]
        self.assertEqual(authors, [LEO, AMY, 'char:Cast/bram.persona.skill', ARIA])
        second = self.reg.chats.runner.turns[1]  # Aria sees Bram's reply
        self.assertEqual(second['messages'][-1], {'name': 'bram', 'content': 'bram says hi', 'self': False})
        self.assertEqual({c['name'] for c in second['cast']}, {'Captain Aria Voss', 'bram'})
        self.assertTrue(self.events('amy', 'chat-typing'))  # every member watches it being written
        sent = self.reg.chats.send(self.tokens['leo'], 'qa', self.path, group['id'], '@all')
        self.assertEqual(len(sent['replies']), 2)
        self.wait(group['id'])

    def test_a_reply_is_never_queued_twice(self):
        pair = self.call('leo', 'start', [ARIA])['conversation']
        message = self.reg.chats.store('qa', self.path).send(LEO, pair['id'], 'hi', 'leo')
        conversation = self.reg.chats.store('qa', self.path).get(LEO, pair['id'])
        first = self.reg.chats._queue_replies(self.reg.chats, 'qa', self.path, conversation, message, {'username': 'leo'}, {})
        again = self.reg.chats._queue_replies(self.reg.chats, 'qa', self.path, conversation, message, {'username': 'leo'}, {})
        self.assertEqual((first, again), ([ARIA], []))
        self.wait(pair['id'])
        self.assertEqual(len(self.reg.chats.runner.turns), 1)

    def test_stop_keeps_what_was_written(self):
        import threading
        hold = threading.Event()
        self.reg.chats.runner = FakeProxy(reply=lambda p, m: 'one two three four', hold=hold)
        pair = self.call('leo', 'start', [ARIA])['conversation']
        self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], 'Talk')
        time.sleep(0.1)
        self.assertTrue(self.call('leo', 'stop', pair['id'])['stopped'])
        hold.set()
        self.wait(pair['id'])
        last = self.call('leo', 'messages', pair['id'])['messages'][-1]
        self.assertEqual((last['author'], last['state']), (ARIA, 'interrupted'))
        self.assertTrue(last['content'].startswith('one'))
        with self.assertRaises(LookupError):
            self.call('ben', 'stop', pair['id'])  # only members can stop it

    def test_a_failed_reply_is_a_visible_message(self):
        self.reg.chats.runner = FakeProxy(fail='Sign in to use the agent')
        pair = self.call('leo', 'start', [ARIA])['conversation']
        self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], 'Hi')
        self.wait(pair['id'])
        last = self.call('leo', 'messages', pair['id'])['messages'][-1]
        self.assertEqual(last['state'], 'error')
        self.assertIn('could not reply', last['content'])
        # Errors are not fed back to the next turn as things the character said.
        self.reg.chats.runner = FakeProxy()
        self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], 'Again')
        self.wait(pair['id'])
        self.assertEqual([m['content'] for m in self.reg.chats.runner.turns[0]['messages']], ['Hi', 'Again'])

    def test_a_browser_can_write_the_reply_itself(self):
        group = self.call('leo', 'start', [AMY, ARIA])['conversation']
        sent = self.reg.chats.send(self.tokens['leo'], 'qa', self.path, group['id'], '@aria hello', [], {'runner': 'client'})
        self.assertEqual(sent['claims'], [{'character': ARIA, 'trigger': sent['message']['id'], 'name': 'Captain Aria Voss'}])
        self.assertEqual(self.reg.chats.runner.turns, [])  # the server did not call a model
        self.assertEqual([e['state'] for e in self.events('amy', 'chat-typing')], ['queued'])
        trigger = sent['message']['id']
        self.reg.chats.runner = server.ChatProxy()  # builds the prompt; never calls a model here
        prompt = self.call('leo', 'prompt', group['id'], ARIA, trigger)
        self.assertIn('You are playing Captain Aria Voss', prompt['payload']['messages'][0]['content'])
        self.assertEqual(prompt['payload']['messages'][-1], {'role': 'user', 'content': 'leo: @aria hello'})
        self.assertNotIn('model', prompt['payload'])
        self.assertEqual(sorted(t['function']['name'] for t in prompt['payload']['tools']), ['list_files', 'read_file'])
        with self.assertRaises(LookupError):
            self.call('amy', 'prompt', group['id'], ARIA, trigger)  # not amy's to write
        self.call('leo', 'typing', group['id'], ARIA, trigger, 'Hel')
        self.assertEqual(self.events('amy', 'chat-typing')[-1]['text'], 'Hel')
        with self.assertRaises(LookupError):
            self.call('amy', 'reply', group['id'], ARIA, trigger, 'forged')
        reply = self.call('leo', 'reply', group['id'], ARIA, trigger, 'Hello there.')['message']
        self.assertEqual((reply['author'], reply['content'], reply['state']), (ARIA, 'Hello there.', 'done'))
        self.assertEqual(self.events('amy', 'chat-message')[-1]['message']['content'], 'Hello there.')
        with self.assertRaises(LookupError):
            self.call('leo', 'reply', group['id'], ARIA, trigger, 'twice')  # a claim is used once

    def test_a_reply_whose_browser_went_away_is_closed(self):
        pair = self.call('leo', 'start', [ARIA])['conversation']
        sent = self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], 'Hi', [], {'runner': 'client'})
        self.call('leo', 'typing', pair['id'], ARIA, sent['message']['id'], 'Half a th')
        self.assertEqual(self.reg.chats.expire_claims(), 0)  # still fresh
        self.assertEqual(self.reg.chats.expire_claims(now=time.monotonic() + 120), 1)
        last = self.call('leo', 'messages', pair['id'])['messages'][-1]
        self.assertEqual((last['author'], last['content'], last['state']), (ARIA, 'Half a th', 'interrupted'))

    def test_the_stateless_prompt_needs_no_key(self):
        handler = object.__new__(server.MDNotesRequestHandler)
        handler.chat_proxy = server.ChatProxy()
        handler._read_json = lambda: {'persona': {'name': 'Aria', 'content': 'A smuggler.'}, 'cast': [],
                                      'messages': [{'name': 'You', 'content': 'hi', 'self': False}], 'projectName': 'Novel'}
        results = []
        handler._write_json = lambda status, body: results.append((status, body))
        handler._handle_persona_prompt()
        status, body = results[0]
        self.assertEqual(status, 200)
        self.assertEqual(body['payload']['messages'][-1], {'role': 'user', 'content': 'You: hi'})
        self.assertNotIn('tools', body['payload'])  # no project sent, so no file tools

    def test_people_in_a_pair_get_no_automatic_replies(self):
        pair = self.call('leo', 'start', [AMY])['conversation']
        self.assertEqual(self.reg.chats.send(self.tokens['leo'], 'qa', self.path, pair['id'], '@aria?')['replies'], [])


if __name__ == '__main__':
    unittest.main()
