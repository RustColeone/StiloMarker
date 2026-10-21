"""Roleplay persona turns: prompt, read-only tools, transcript mapping, limits.
And the server's half of spec/characters/reply-request.cases.json (the
browser's is reply-request.test.mjs): a character's request as both build it."""
from types import SimpleNamespace
import copy, json, sys, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from stilo.modules.assistant.service import agent as agent_module  # noqa: E402
from stilo.modules.assistant import Agent  # noqa: E402
from stilo.modules.assistant.adapters.routes import add_routes as add_assistant_routes  # noqa: E402
from stilo.modules.sync import VERSION as SYNC_VERSION  # noqa: E402
from helpers.routes import FakeRequest, FakeTransport, call  # noqa: E402

OVERRIDE = {'apiKey': 'model-test-key', 'apiUrl': 'https://model.example.invalid'}
PROJECT = {'rootId': 'root', 'nodes': {
    'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'parentId': None, 'children': ['f1', 'f2']},
    'f1': {'id': 'f1', 'kind': 'file', 'name': 'chapter.md', 'parentId': 'root', 'content': 'The ship sank at dawn.'},
    'f2': {'id': 'f2', 'kind': 'file', 'name': 'aria.persona.skill', 'parentId': 'root', 'content': 'sheet'},
}}
PERSONA = {'path': 'aria.persona.skill', 'name': 'Aria',
           'content': '---\nname: Aria\n---\n## How they speak\nClipped, sardonic.', 'temperature': 0.9}
CAST = [{'name': 'Aria', 'summary': 'me'}, {'name': 'Bram', 'summary': 'A nervous cook.'}]


def reply(text):
    return {'choices': [{'message': {'content': text}}]}


def tool_call(name, args, call_id='call-1'):
    return {'choices': [{'message': {'tool_calls': [
        {'id': call_id, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}}]}


class PersonaTurnTests(unittest.TestCase):
    def run_turn(self, responses, messages=None, persona=PERSONA, cast=CAST, context=None, project=PROJECT):
        proxy = Agent()
        proxy.manual_content = 'APP MANUAL TEXT'
        seen = []
        queue = list(responses)

        def completion(payload, emit):
            seen.append(copy.deepcopy(payload))
            return queue.pop(0)
        proxy._complete = completion
        messages = messages if messages is not None else [{'name': 'Leo', 'content': 'Aria, the hold is flooding.', 'self': False}]
        with patch.object(agent_module, '_log'):
            result = proxy.chat(messages, context or [], 'Novel', project, override=OVERRIDE,
                                persona=copy.deepcopy(persona), cast=cast)
        return result, seen

    def test_prompt_has_sheet_and_cast_but_not_the_manual(self):
        result, seen = self.run_turn([reply('Then bail faster.')])
        self.assertEqual(result['message'], 'Then bail faster.')
        self.assertEqual(result['proposedOperations'], [])
        self.assertEqual(result['speaker'], 'aria.persona.skill')
        system = seen[0]['messages'][0]['content']
        self.assertIn('You are playing Aria', system)
        self.assertIn('Clipped, sardonic.', system)
        self.assertIn('- Bram: A nervous cook.', system)
        self.assertNotIn('- Aria', system)  # a character is not listed as someone else
        self.assertIn('chapter.md', system)  # the file tree
        self.assertNotIn('APP MANUAL TEXT', system)
        self.assertEqual(seen[0]['temperature'], 0.9)

    def test_authors_notes_stay_hidden_unless_the_sheet_allows_hints(self):
        sheet = '---\nname: Mara\n---\n## Who\nA keeper.\n\n## Author\'s notes\nGoes blind in chapter nine.'
        _, seen = self.run_turn([reply('Hm.')], persona={**PERSONA, 'name': 'Mara', 'content': sheet})
        system = seen[0]['messages'][0]['content']
        self.assertIn('A keeper.', system)
        self.assertNotIn('blind', system, 'hidden notes never reach the character')
        self.assertNotIn('name: Mara', system, 'the header is not part of the sheet')
        hinted = sheet.replace('name: Mara', 'name: Mara\nnotes: hints')
        _, seen = self.run_turn([reply('Hm.')], persona={**PERSONA, 'name': 'Mara', 'content': hinted})
        system = seen[0]['messages'][0]['content']
        self.assertIn('Goes blind in chapter nine.', system)
        self.assertIn('must never state it, reveal it, or act on it as knowledge', system)

    def test_characters_never_see_plans_or_anyone_s_notes(self):
        project = copy.deepcopy(PROJECT)
        project['nodes']['root']['children'] += ['plans', 'ending']
        project['nodes']['plans'] = {'id': 'plans', 'kind': 'folder', 'name': 'Plans', 'parentId': 'root', 'children': ['act']}
        project['nodes']['act'] = {'id': 'act', 'kind': 'file', 'name': 'act-two.md', 'parentId': 'plans', 'content': 'The traitor is Tobias.'}
        project['nodes']['ending'] = {'id': 'ending', 'kind': 'file', 'name': 'ending.plan.md', 'parentId': 'root', 'content': 'She survives.'}
        project['nodes']['f2']['content'] = "## Who\nA smuggler.\n## Author's notes\nShe dies in act three."
        responses = [tool_call('list_files', {}, 'c1'), tool_call('read_file', {'path': 'Plans/act-two.md'}, 'c2'),
                     tool_call('read_file', {'path': 'aria.persona.skill'}, 'c3'), reply('Nothing.')]
        _, seen = self.run_turn(responses, project=project)
        system = seen[0]['messages'][0]['content']
        self.assertNotIn('Plans', system); self.assertNotIn('ending.plan.md', system)
        results = [m['content'] for m in seen[-1]['messages'] if m.get('role') == 'tool']
        self.assertNotIn('act-two', results[0]); self.assertNotIn('ending', results[0]); self.assertIn('chapter.md', results[0])
        self.assertIn('not found', results[1].lower())
        self.assertIn('A smuggler.', results[2]); self.assertNotIn('dies', results[2])
        self.assertIn('She dies in act three.', project['nodes']['f2']['content'], 'the real project is untouched')

    def test_only_read_tools_are_offered_and_writes_are_refused(self):
        responses = [tool_call('update_file', {'path': 'chapter.md', 'content': 'hijacked'}),
                     tool_call('read_file', {'path': 'chapter.md'}, 'call-2'),
                     reply('Dawn. I remember.')]
        result, seen = self.run_turn(responses)
        names = sorted(tool['function']['name'] for tool in seen[0]['tools'])
        self.assertEqual(names, ['list_files', 'read_file'])
        refused = json.loads(seen[1]['messages'][-1]['content'])
        self.assertIn('cannot change', refused['error'])
        read = json.loads(seen[2]['messages'][-1]['content'])
        self.assertEqual(read['content'], 'The ship sank at dawn.')
        self.assertEqual(PROJECT['nodes']['f1']['content'], 'The ship sank at dawn.')
        self.assertEqual(result['proposedOperations'], [])

    def test_last_step_forces_an_answer(self):
        proxy_steps = Agent().max_tool_iterations
        responses = [tool_call('list_files', {}, f'call-{i}') for i in range(proxy_steps)] + [reply('Fine.')]
        result, seen = self.run_turn(responses)
        self.assertEqual(seen[-1]['tool_choice'], 'none')
        self.assertEqual(result['message'], 'Fine.')

    def test_transcript_maps_self_to_assistant_and_merges_others(self):
        messages = [
            {'name': 'Leo', 'content': 'The storm hits.', 'self': False},
            {'name': 'Bram', 'content': 'We are doomed!', 'self': False},
            {'name': 'Aria', 'content': 'Not yet.', 'self': True},
            {'name': 'Leo', 'content': 'A wave breaks over the rail.', 'self': False},
            {'name': 'Leo', 'content': '', 'self': False},
        ]
        _, seen = self.run_turn([reply('Hold on.')], messages=messages)
        turns = seen[0]['messages'][1:]
        self.assertEqual([turn['role'] for turn in turns], ['user', 'assistant', 'user'])
        self.assertEqual(turns[0]['content'], 'Leo: The storm hits.\n\nBram: We are doomed!')
        self.assertEqual(turns[1]['content'], 'Not yet.')
        self.assertEqual(turns[2]['content'], 'Leo: A wave breaks over the rail.')

    def test_transcript_edges_and_budget(self):
        proxy = Agent()
        turns = proxy._persona_transcript([{'name': 'Aria', 'content': 'I spoke first.', 'self': True},
                                           {'name': 'Leo', 'content': 'Go on.', 'self': False},
                                           {'name': 'Aria', 'content': 'And again.', 'self': True}])
        self.assertEqual([t['role'] for t in turns], ['user', 'assistant', 'user', 'assistant', 'user'])
        self.assertEqual(turns[0]['content'], '(Earlier conversation omitted.)')
        self.assertEqual(turns[-1]['content'], '(Continue.)')
        with self.assertRaises(ValueError):
            proxy._persona_transcript([{'name': 'Aria', 'content': 'Alone.', 'self': True}])
        many = [{'name': 'Leo', 'content': f'{i} ' + 'x' * 3000, 'self': False} for i in range(80)]
        kept = proxy._persona_transcript(many)[0]['content']
        self.assertLessEqual(len(kept), proxy.PERSONA_MAX_TRANSCRIPT_CHARS + 200)
        self.assertIn('79 ', kept)  # the newest messages are the ones kept
        self.assertNotIn('Leo: 0 ', kept)

    def test_temperature_is_clamped_and_defaulted(self):
        proxy = Agent()
        self.assertEqual(proxy._persona_temperature(9), 1.5)
        self.assertEqual(proxy._persona_temperature(-2), 0.0)
        self.assertEqual(proxy._persona_temperature(None), 0.8)
        self.assertEqual(proxy._persona_temperature('warm'), 0.8)
        self.assertEqual(proxy._persona_temperature(float('nan')), 0.8)

    def test_own_name_prefix_is_stripped_and_empty_reply_fails(self):
        result, _ = self.run_turn([reply('Aria: Bail, then pray.')])
        self.assertEqual(result['message'], 'Bail, then pray.')
        with self.assertRaises(RuntimeError):
            self.run_turn([reply('')])

    def test_persona_needs_a_name(self):
        with self.assertRaises(ValueError):
            self.run_turn([reply('x')], persona={**PERSONA, 'name': '  '})

    def test_handler_routes_persona_mode_without_mcp(self):
        calls = []
        agent = SimpleNamespace(authorize_client=lambda ip: None,
                                chat=lambda *args, **kwargs: calls.append(kwargs) or {'message': 'ok', 'contextPaths': [], 'proposedOperations': []})
        identity = SimpleNamespace(enabled=True, who=lambda token: {'username': 'leo', 'teams': []} if token == 'acct' else None)
        transport = FakeTransport()
        add_assistant_routes(transport, agent=agent, threads=None, identity=identity, directory=None, version=117)
        status, response = call(transport, 'POST', '/api/chat', FakeRequest(
            {'mode': 'persona', 'persona': PERSONA, 'cast': CAST, 'accountToken': 'acct',
             'messages': [{'name': 'Leo', 'content': 'hi', 'self': False}]}))
        self.assertEqual(calls[0]['persona']['name'], 'Aria')
        self.assertEqual(calls[0]['cast'], CAST)
        self.assertEqual(calls[0]['mcp_configs'], [])
        self.assertEqual(calls[0]['identity'], {'username': 'leo', 'teams': []})
        self.assertEqual((status, response['message']), (200, 'ok'))

    def test_stale_tabs_are_refused(self):
        self.assertEqual(SYNC_VERSION, 117)
        saved = []
        threads = SimpleNamespace(set=lambda workspace, token, payload: saved.append(payload) or {'threads': [], 'revision': 1})
        directory = SimpleNamespace(broker_for_token=lambda token: None)
        transport = FakeTransport()
        add_assistant_routes(transport, agent=None, threads=threads, identity=None, directory=directory, version=SYNC_VERSION)
        status, body = call(transport, 'POST', '/api/chat/workspace', FakeRequest({'version': 116, 'threads': []}, query={'token': 't'}))
        self.assertEqual((status, body['upgradeRequired'], body['minVersion']), (426, True, 117))
        self.assertEqual(saved, [])
        self.assertEqual(call(transport, 'POST', '/api/chat/workspace', FakeRequest({'version': 117, 'threads': []}, query={'token': 't'}))[0], 200)


class SharedReplyRequestCases(unittest.TestCase):
    """spec/characters/reply-request.cases.json, built by the server."""

    def test_cases(self):
        table = json.loads((Path(__file__).resolve().parents[1] / 'spec/characters/reply-request.cases.json').read_text(encoding='utf-8'))
        agent = Agent()
        agent.providers = SimpleNamespace(options=lambda payload: payload)
        for case in table['cases']:
            with self.subTest(case['name']):
                build = lambda: agent.build_persona_payload(case['messages'], case['contextFiles'], case['projectName'],
                                                            copy.deepcopy(case['project']), case['persona'], case['cast'], case['model'])
                if 'error' in case:
                    with self.assertRaises(ValueError) as raised:
                        build()
                    self.assertEqual(str(raised.exception), case['error'])
                    continue
                payload, used = build()
                self.assertEqual(payload, case['payload'])
                self.assertEqual(used, case['usedPaths'])


if __name__ == '__main__':
    unittest.main()
