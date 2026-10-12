"""Roleplay persona turns: prompt, read-only tools, transcript mapping, limits."""
import copy, json, sys, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
import mdnotes_server as server

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
        proxy = server.ChatProxy()
        proxy.manual_content = 'APP MANUAL TEXT'
        seen = []
        queue = list(responses)

        def completion(payload, headers, emit):
            seen.append(copy.deepcopy(payload))
            return queue.pop(0)
        proxy._stream_completion = completion
        messages = messages if messages is not None else [{'name': 'Leo', 'content': 'Aria, the hold is flooding.', 'self': False}]
        with patch.object(server, '_log'):
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
        proxy_steps = server.ChatProxy().max_tool_iterations
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
        proxy = server.ChatProxy()
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
        proxy = server.ChatProxy()
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
        handler = object.__new__(server.MDNotesRequestHandler)
        calls = []
        handler.chat_proxy = type('Proxy', (), {
            'authorize_client': lambda self, ip: None,
            'chat': lambda self, *args, **kwargs: calls.append(kwargs) or {
                'message': 'ok', 'contextPaths': [], 'proposedOperations': []},
        })()
        handler.client_address = ('127.0.0.1', 0)
        handler.registry = type('Registry', (), {
            'accounts': type('Accounts', (), {'enabled': True})(),
            'account_for_token': lambda self, token: {'username': 'leo', 'teams': []} if token == 'acct' else None,
        })()
        handler._read_json = lambda: {'mode': 'persona', 'persona': PERSONA, 'cast': CAST, 'accountToken': 'acct',
                                      'messages': [{'name': 'Leo', 'content': 'hi', 'self': False}]}
        handler.send_response = handler.send_header = handler.end_headers = lambda *a: None
        handler._send_cors_headers = lambda: None
        handler._log_request = lambda *a: None
        written = []
        handler.wfile = type('W', (), {'write': lambda self, b: written.append(b), 'flush': lambda self: None})()
        handler._handle_chat()
        self.assertEqual(calls[0]['persona']['name'], 'Aria')
        self.assertEqual(calls[0]['cast'], CAST)
        self.assertEqual(calls[0]['mcp_configs'], [])
        self.assertEqual(calls[0]['identity'], {'username': 'leo', 'teams': []})
        self.assertIn(b'"type": "result"', b''.join(written))

    def test_stale_tabs_are_refused(self):
        self.assertEqual(server.MIN_CLIENT_VERSION, 116)
        handler = object.__new__(server.MDNotesRequestHandler)
        results = []
        handler._write_json = lambda status, body: results.append((status, body))
        handler._log_request = lambda *a: None
        self.assertTrue(handler._refuse_if_stale(115))
        self.assertEqual(results[0][0], 426)
        self.assertFalse(handler._refuse_if_stale(116))


if __name__ == '__main__':
    unittest.main()
