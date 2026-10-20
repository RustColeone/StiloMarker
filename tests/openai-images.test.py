"""OpenAI provider: model catalog, routing, sign-in gate, and image generation."""
import base64, copy, io, json, sys, tempfile, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from stilo.modules.assistant.service import agent as agent_module  # noqa: E402
from stilo.modules import models as oa
from stilo.modules.assistant import Agent
from stilo.modules.assistant.adapters.routes import add_routes as add_assistant_routes
from helpers.routes import FakeRequest, FakeTransport, call
from stilo.modules.models.adapters import openai as oa_adapter

CATALOG = ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1',
           'gpt-5.1-mini', 'gpt-5-2025-08-07', 'gpt-4o-audio-preview', 'gpt-realtime', 'gpt-5.1-codex',
           'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'dall-e-3', 'text-embedding-3-large']
PNG = b'\x89PNG\r\n\x1a\nfake-image-bytes'
PROJECT = {'rootId': 'root', 'nodes': {
    'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'parentId': None, 'children': ['f1']},
    'f1': {'id': 'f1', 'kind': 'file', 'name': 'chapter.md', 'parentId': 'root', 'content': 'A lighthouse.'}}}
USER = {'username': 'leo', 'teams': ['blue']}


class FakeResponse(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *exc): self.close()


class FakeOpenAI:
    """Stands in for api.openai.com: /models and /images/generations."""
    def __init__(self, fail=None):
        self.requests, self.fail = [], fail

    def __call__(self, request, timeout):
        body = json.loads(request.data) if request.data else None
        self.requests.append({'url': request.full_url, 'body': body, 'auth': request.get_header('Authorization'), 'timeout': timeout})
        if self.fail:
            raise HTTPError(request.full_url, 400, 'bad', {}, io.BytesIO(json.dumps({'error': {'message': self.fail}}).encode()))
        if request.full_url.endswith('/models'):
            return FakeResponse(json.dumps({'data': [{'id': m} for m in CATALOG]}).encode())
        return FakeResponse(json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())


def proxy_with_openai(opener=None, env=None, store_dir=None):
    proxy = Agent()
    openai = oa.OpenAIProvider({'OPENAI_API_KEY': 'openai-key', **(env or {})}, opener=opener or FakeOpenAI())
    proxy.providers = oa.open_providers({'MDNOTES_CHAT_API_KEY': 'deepseek-key',
                                         'MDNOTES_CHAT_API_URL': 'https://deepseek.example.invalid/chat'}, openai=openai)
    proxy.openai.apply_catalog(CATALOG)
    if store_dir:
        proxy.generated = oa.GeneratedImages(Path(store_dir))
    return proxy


def tool_call(name, args, call_id='call-1'):
    return {'choices': [{'message': {'tool_calls': [
        {'id': call_id, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}}]}


def reply(text):
    return {'choices': [{'message': {'content': text}}]}


class CatalogTests(unittest.TestCase):
    def test_newest_flagship_mini_and_image_model(self):
        self.assertEqual(oa.pick_chat_models(CATALOG), ['gpt-5.1', 'gpt-5.1-mini'])
        self.assertEqual(oa.pick_image_model(CATALOG), 'gpt-image-1.5')
        self.assertEqual(oa.pick_image_model(['gpt-image-1-mini']), 'gpt-image-1-mini')
        self.assertEqual(oa.pick_chat_models(['gpt-4o', 'gpt-4.1-mini']), ['gpt-4.1-mini'])
        self.assertEqual(oa.pick_chat_models(['dall-e-3']), [])
        self.assertIsNone(oa.pick_image_model(['gpt-5']))

    def test_named_variants_of_the_newest_version_are_offered(self):
        ids = ['gpt-5.5', 'gpt-5.4-mini', 'gpt-6.1-sol', 'gpt-6.1-luna', 'gpt-6.1-sol-2026-09-01', 'gpt-6-luna']
        self.assertEqual(oa.pick_chat_models(ids), ['gpt-6.1-sol', 'gpt-6.1-luna'])
        self.assertEqual(oa.pick_chat_models(ids + ['gpt-6.1']), ['gpt-6.1', 'gpt-6.1-sol', 'gpt-6.1-luna'])
        self.assertEqual(oa.pick_chat_models(['gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.5']),
                         ['gpt-6.1-sol', 'gpt-6-luna'])
        self.assertEqual(oa.newest_gpt_ids(ids), ['gpt-6-luna', 'gpt-6.1-luna', 'gpt-6.1-sol', 'gpt-6.1-sol-2026-09-01'])
        self.assertTrue(oa.uses_fixed_temperature('gpt-6.1-sol') and oa.uses_fixed_temperature('gpt-10'))
        self.assertTrue(oa.is_openai_model('gpt-6.1-luna'))
        self.assertTrue(oa.uses_responses_api('gpt-6.1-sol') and not oa.uses_responses_api('gpt-5.5'))

    def test_responses_translation_round_trip(self):
        payload = {"model": "gpt-6.1-sol", "temperature": 0.4, "tool_choice": "auto", "messages": [
            {"role": "system", "content": "sys"}, {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"a.md"}'}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "file body"}],
            "tools": [{"type": "function", "function": {"name": "read_file", "description": "Read", "parameters": {"type": "object"}}}]}
        r = oa.to_responses_request(payload)
        self.assertEqual(r["input"], [{"role": "developer", "content": "sys"}, {"role": "user", "content": "hi"},
                                      {"type": "function_call", "call_id": "c1", "name": "read_file", "arguments": '{"path":"a.md"}'},
                                      {"type": "function_call_output", "call_id": "c1", "output": "file body"}])
        self.assertEqual(r["tools"], [{"type": "function", "name": "read_file", "description": "Read", "parameters": {"type": "object"}}])
        self.assertNotIn("temperature", r); self.assertEqual(r["tool_choice"], "auto"); self.assertTrue(r["stream"])
        stream = oa.ResponsesStream()
        self.assertEqual(stream.feed({"type": "response.output_text.delta", "delta": "Hel"}), {"text": "Hel"})
        stream.feed({"type": "response.output_item.added", "output_index": 1, "item": {"type": "function_call", "call_id": "c2", "name": "list_files", "arguments": ""}})
        stream.feed({"type": "response.function_call_arguments.delta", "output_index": 1, "delta": '{"a"'})
        stream.feed({"type": "response.function_call_arguments.delta", "output_index": 1, "delta": ':1}'})
        stream.feed({"type": "response.completed", "response": {}})
        message = stream.result()["choices"][0]
        self.assertEqual(message["finish_reason"], "tool_calls")
        self.assertEqual(message["message"]["tool_calls"], [{"id": "c2", "type": "function", "function": {"name": "list_files", "arguments": '{"a":1}'}}])
        with self.assertRaises(RuntimeError):
            oa.ResponsesStream().feed({"type": "response.failed", "response": {"error": {"message": "nope"}}})

    def test_versions_compare_numerically(self):
        self.assertEqual(oa.pick_chat_models(['gpt-5.9', 'gpt-5.10']), ['gpt-5.10'])

    def test_overrides_are_kept_only_if_the_account_has_them(self):
        provider = oa.OpenAIProvider({'OPENAI_API_KEY': 'k', 'MDNOTES_OPENAI_MODELS': 'gpt-4.1, gpt-9',
                                      'MDNOTES_OPENAI_IMAGE_MODEL': 'gpt-image-1'})
        provider.apply_catalog(CATALOG)
        self.assertEqual(provider.models, ['gpt-4.1'])
        self.assertEqual(provider.image_model, 'gpt-image-1')

    def test_catalog_is_read_with_the_key_and_failures_keep_a_reason(self):
        opener = FakeOpenAI()
        provider = oa.OpenAIProvider({'OPENAI_API_KEY': 'k'}, opener=opener)
        provider.load_catalog()
        self.assertEqual(opener.requests[0]['url'], 'https://api.openai.com/v1/models')
        self.assertEqual(opener.requests[0]['auth'], 'Bearer k')
        self.assertEqual(provider.models, ['gpt-5.1', 'gpt-5.1-mini'])
        failing = oa.OpenAIProvider({'OPENAI_API_KEY': 'k'}, opener=FakeOpenAI(fail='Incorrect API key'))
        logs = []
        with patch.object(oa_adapter.time, 'sleep', side_effect=SystemExit):
            try:
                failing.start(lambda *a, **k: logs.append((a, k)), retry_seconds=0)
                time.sleep(0.2)
            except SystemExit:
                pass
        self.assertEqual(failing.models, [])
        self.assertIn('Incorrect API key', failing.catalog_error or '')
        self.assertNotIn('k', json.dumps(failing.catalog_error).replace('key', ''))

    def test_no_key_means_nothing_offered(self):
        proxy = Agent()
        proxy.providers = oa.open_providers({}, openai=oa.OpenAIProvider({}))
        proxy.openai.apply_catalog(CATALOG)
        self.assertNotIn('gpt-5.1', proxy.all_models())
        self.assertFalse(proxy.public_status()['imageGeneration'])


class RoutingTests(unittest.TestCase):
    def run_chat(self, proxy, model, **kwargs):
        seen = []

        class FakeHTTP:
            """The provider's endpoint, at the edge of Models: what was sent where."""
            @staticmethod
            def stream_events(url, payload, headers, timeout):
                seen.append({'payload': copy.deepcopy(payload), 'url': url, 'auth': headers['Authorization']})
                yield {'choices': [{'delta': {'content': 'Done.'}, 'finish_reason': 'stop'}]}
        proxy.providers.http = FakeHTTP
        with patch.object(agent_module, '_log'):
            result = proxy.chat([{'role': 'user', 'content': 'hi'}], [], 'Novel', PROJECT, model=model, **kwargs)
        return result, seen[0]

    def test_gpt_models_go_to_openai_without_unsupported_options(self):
        proxy = proxy_with_openai()
        proxy.providers.thinking = True
        result, call = self.run_chat(proxy, 'gpt-5.1')
        self.assertEqual(call['url'], 'https://api.openai.com/v1/chat/completions')
        self.assertEqual(call['auth'], 'Bearer openai-key')
        self.assertNotIn('temperature', call['payload'])
        self.assertNotIn('thinking', call['payload'])
        self.assertEqual(result['provider'], 'OpenAI')
        self.assertEqual(result['model'], 'gpt-5.1')

    def test_deepseek_stays_the_default_and_keeps_its_options(self):
        proxy = proxy_with_openai()
        proxy.providers.thinking = True
        result, call = self.run_chat(proxy, None)
        self.assertEqual(call['auth'], 'Bearer deepseek-key')
        self.assertEqual(call['payload']['model'], proxy.providers.default_model)
        self.assertEqual(call['payload']['thinking'], {'type': 'enabled'})
        self.assertEqual(call['payload']['temperature'], 0.2)
        self.assertEqual(result['provider'], 'DeepSeek')
        # An unknown model falls back to the default rather than being sent anywhere.
        _, call = self.run_chat(proxy, 'gpt-99')
        self.assertEqual(call['auth'], 'Bearer deepseek-key')

    def test_own_key_is_never_replaced_by_a_server_key(self):
        proxy = proxy_with_openai()
        _, call = self.run_chat(proxy, 'gpt-5.1', override={'apiKey': 'mine', 'apiUrl': 'https://mine.invalid/chat', 'model': 'gpt-5.1'})
        self.assertEqual(call['auth'], 'Bearer mine')
        self.assertEqual(call['url'], 'https://mine.invalid/chat')

    def test_route_state_does_not_leak_between_requests(self):
        proxy = proxy_with_openai()
        self.run_chat(proxy, 'gpt-5.1')
        self.assertIsNone(proxy._req.route)
        _, call = self.run_chat(proxy, None)
        self.assertEqual(call['auth'], 'Bearer deepseek-key')

    def test_status_lists_both_providers(self):
        status = proxy_with_openai().public_status()
        self.assertEqual(status['models'][:1], [Agent().providers.default_model])
        self.assertIn('gpt-5.1', status['models'])
        info = {row['id']: row['provider'] for row in status['modelInfo']}
        self.assertEqual(info['gpt-5.1'], 'OpenAI')
        self.assertEqual(info[status['model']], 'DeepSeek')
        self.assertTrue(status['imageGeneration'])


class ImageToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.opener = FakeOpenAI()
        self.proxy = proxy_with_openai(self.opener, store_dir=self.tmp.name)

    def turn(self, responses, identity=USER):
        seen, queue = [], list(responses)

        def completion(payload, emit):
            seen.append(copy.deepcopy(payload))
            return queue.pop(0)
        self.proxy._complete = completion
        with patch.object(agent_module, '_log'):
            result = self.proxy.chat([{'role': 'user', 'content': 'Draw the lighthouse'}], [], 'Novel', PROJECT, identity=identity)
        return result, seen

    def test_image_is_generated_stored_and_proposed_by_id(self):
        result, seen = self.turn([
            tool_call('generate_image', {'prompt': 'A lighthouse in a storm, ink wash', 'name': 'lighthouse.webp',
                                         'parentPath': 'Art/', 'orientation': 'portrait'}),
            reply('Here is the lighthouse.')])
        self.assertIn('generate_image', [t['function']['name'] for t in seen[0]['tools']])
        request = self.opener.requests[-1]
        self.assertEqual(request['url'], 'https://api.openai.com/v1/images/generations')
        self.assertEqual(request['auth'], 'Bearer openai-key')
        self.assertEqual(request['body'], {'model': 'gpt-image-1.5', 'prompt': 'A lighthouse in a storm, ink wash', 'n': 1,
                                           'size': '1024x1536', 'quality': 'medium', 'output_format': 'webp'})
        [op] = result['proposedOperations']
        self.assertEqual((op['type'], op['parentPath'], op['name'], op['content']), ('create-file', 'Art', 'lighthouse.webp', ''))
        image = op['generatedImage']
        self.assertEqual(image['mime'], 'image/webp')
        self.assertNotIn('b64', json.dumps(result))  # no image bytes in the chat
        self.assertEqual(self.proxy.generated.load(image['id'], 'leo'), (PNG, 'image/webp'))
        self.assertIsNone(self.proxy.generated.load(image['id'], 'someone-else'))
        told = json.loads(seen[1]['messages'][-1]['content'])
        self.assertEqual(told['path'], 'Art/lighthouse.webp')

    def test_at_most_two_images_per_request(self):
        calls = [tool_call('generate_image', {'prompt': f'p{i}', 'name': f'i{i}.png'}, f'c{i}') for i in range(3)]
        result, seen = self.turn([*calls, reply('Made two.')])
        self.assertEqual(len(result['proposedOperations']), 2)
        self.assertEqual(sum(r['url'].endswith('/images/generations') for r in self.opener.requests), 2)
        self.assertIn('Image limit reached', seen[3]['messages'][-1]['content'])

    def test_bad_names_become_png_and_paths_are_stripped(self):
        result, _ = self.turn([tool_call('generate_image', {'prompt': 'x', 'name': '../../etc/cover.gif'}), reply('ok')])
        op = result['proposedOperations'][0]
        self.assertEqual(op['name'], 'cover.png')
        self.assertEqual(op['generatedImage']['mime'], 'image/png')

    def test_not_offered_without_sign_in_or_store_or_image_model(self):
        _, seen = self.turn([reply('no')], identity=None)
        self.assertNotIn('generate_image', [t['function']['name'] for t in seen[0]['tools']])
        # A model calling it anyway gets an error, and nothing is spent.
        result, _ = self.turn([tool_call('generate_image', {'prompt': 'x', 'name': 'a.png'}), reply('no')], identity=None)
        self.assertEqual(result['proposedOperations'], [])
        self.assertFalse(any(r['url'].endswith('/images/generations') for r in self.opener.requests))
        self.proxy.openai.image_model = None
        _, seen = self.turn([reply('no')])
        self.assertNotIn('generate_image', [t['function']['name'] for t in seen[0]['tools']])

    def test_persona_turns_never_get_the_image_tool(self):
        seen = []
        self.proxy._complete = lambda p, e: seen.append(p) or reply('Aye.')
        with patch.object(agent_module, '_log'):
            self.proxy.chat([{'name': 'Leo', 'content': 'hi', 'self': False}], [], 'Novel', PROJECT, identity=USER,
                            persona={'name': 'Mara', 'content': 'sheet'}, cast=[])
        self.assertEqual(sorted(t['function']['name'] for t in seen[0]['tools']), ['list_files', 'read_file'])

    def test_provider_errors_reach_the_model_without_secrets(self):
        self.proxy.openai._opener = FakeOpenAI(fail='Your request was rejected by the safety system.')
        result, seen = self.turn([tool_call('generate_image', {'prompt': 'x', 'name': 'a.png'}), reply('Sorry.')])
        self.assertEqual(result['proposedOperations'], [])
        told = seen[1]['messages'][-1]['content']
        self.assertIn('safety system', told)
        self.assertNotIn('openai-key', told)


class StoreTests(unittest.TestCase):
    def test_owner_only_bad_ids_and_expiry(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = oa.GeneratedImages(Path(tmp), ttl_seconds=60)
            image_id = store.store(PNG, 'image/png', '.png', 'leo', 'prompt')
            self.assertEqual(store.load(image_id, 'leo'), (PNG, 'image/png'))
            self.assertIsNone(store.load(image_id, 'amy'))
            self.assertIsNone(store.load('../../whitelist', 'leo'))
            meta = Path(tmp) / f'{image_id}.json'
            data = json.loads(meta.read_text()); data['created'] -= 120; meta.write_text(json.dumps(data))
            store.store(PNG, 'image/png', '.png', 'leo', 'newer')  # storing purges expired ones
            self.assertIsNone(store.load(image_id, 'leo'))
            self.assertEqual(len(list(Path(tmp).glob('*.png'))), 1)


class GateTests(unittest.TestCase):
    """The Assistant's routes: spending the server's keys needs a signed-in account."""

    def routes(self, accounts=True, store=None):
        transport = FakeTransport()
        calls = []
        agent = SimpleNamespace(authorize_client=lambda ip: None, generated=store,
                                chat=lambda *a, **k: calls.append(k) or {'message': 'ok', 'contextPaths': [], 'proposedOperations': []},
                                generate=lambda *a: calls.append(a) or {'message': 'ok'},
                                public_status=lambda: {'configured': True})
        identity = SimpleNamespace(enabled=accounts, who=lambda token: USER if token == 'acct' else None,
                                   require=lambda token: USER if token == 'acct' else (_ for _ in ()).throw(PermissionError()))
        add_assistant_routes(transport, agent=agent, threads=None, identity=identity, directory=None, version=117)
        return transport, calls

    def chat(self, payload, **options):
        transport, calls = self.routes(**options)
        return call(transport, 'POST', '/api/chat', FakeRequest(payload, client_ip='203.0.113.9')), calls

    def test_server_keys_need_a_signed_in_account(self):
        (status, body), calls = self.chat({'messages': [{'role': 'user', 'content': 'hi'}]})
        self.assertEqual(status, 403)
        self.assertIn('Sign in', body['message'])
        self.assertEqual(calls, [])

    def test_signed_in_requests_pass_their_identity(self):
        _, calls = self.chat({'messages': [{'role': 'user', 'content': 'hi'}], 'accountToken': 'acct'})
        self.assertEqual(calls[0]['identity'], USER)

    def test_own_key_and_account_free_servers_are_unchanged(self):
        _, calls = self.chat({'messages': [{'role': 'user', 'content': 'hi'}], 'apiKey': 'mine'})
        self.assertEqual(len(calls), 1)
        self.assertIsNone(calls[0]['identity'])
        _, calls = self.chat({'messages': [{'role': 'user', 'content': 'hi'}]}, accounts=False)
        self.assertEqual(len(calls), 1)

    def test_quick_generate_is_gated_too(self):
        transport, calls = self.routes()
        self.assertEqual(call(transport, 'POST', '/api/generate', FakeRequest({'subject': 'x'}))[0], 403)
        self.assertEqual(calls, [])

    def test_quick_generate_passes_a_named_overview(self):
        transport, calls = self.routes()
        payload = {'subject': 'Plot', 'accountToken': 'acct', 'overview': {'title': 'Brainstorm map overview', 'text': 'A -> B'}}
        self.assertEqual(call(transport, 'POST', '/api/generate', FakeRequest(payload))[0], 200)
        self.assertEqual(calls[0][3], {'title': 'Brainstorm map overview', 'text': 'A -> B'})
        call(transport, 'POST', '/api/generate', FakeRequest({'subject': 'Plot', 'accountToken': 'acct', 'overview': 'not an object'}))
        self.assertEqual(calls[1][3], {'title': '', 'text': ''}, 'a malformed overview is none')

    def test_the_overview_is_named_in_the_generators_instructions(self):
        sent = []
        agent = Agent()
        agent.providers = SimpleNamespace(configured=lambda: True, route=lambda: SimpleNamespace(model='m', label='L'),
                                          complete=lambda route, payload: sent.append(payload) or {'choices': [{'message': {'content': '# Doc'}}]})
        result = agent.generate('Plot', '', [], {'title': 'Brainstorm map overview', 'text': 'A -> B'}, 'Novel')
        self.assertEqual(result['content'], '# Doc')
        system = sent[0]['messages'][0]['content']
        self.assertIn('Brainstorm map overview:\nA -> B', system)
        agent.generate('Plot', '', [], {'title': '', 'text': ''}, 'Novel')
        self.assertNotIn('overview:', sent[1]['messages'][0]['content'].lower().replace('use the overview', ''), 'no overview, no section')

    def test_status_says_an_account_is_needed(self):
        transport, _ = self.routes()
        self.assertTrue(call(transport, 'GET', '/api/chat/status', FakeRequest())[1]['requiresAccount'])

    def test_generated_images_are_served_to_their_owner_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = oa.GeneratedImages(Path(tmp))
            image_id = store.store(PNG, 'image/png', '.png', 'leo', 'p')
            other_id = oa.GeneratedImages(Path(tmp)).store(PNG, 'image/png', '.png', 'amy', 'p')
            transport, _ = self.routes(store=store)
            status, image = call(transport, 'GET', '/api/generated', FakeRequest(query={'token': 'acct', 'id': image_id}))
            self.assertEqual((status, image.data, image.content_type), (200, PNG, 'image/png'))
            self.assertEqual(call(transport, 'GET', '/api/generated', FakeRequest(query={'token': 'acct', 'id': other_id}))[0], 404)
            self.assertEqual(call(transport, 'GET', '/api/generated', FakeRequest(query={'token': 'nobody', 'id': image_id}))[0], 403)


if __name__ == '__main__':
    unittest.main()
