"""Models (server): where each request goes, what it carries for its model,
and both streams put back together, with the provider's endpoint faked at
the HTTP edge."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from stilo.modules.models import ChatStream, OpenAIProvider, open_providers  # noqa: E402

ENV = {"MDNOTES_CHAT_API_KEY": "ds-key", "MDNOTES_CHAT_API_URL": "https://ds.invalid/chat", "MDNOTES_CHAT_MODELS": "deepseek-extra"}


def providers(**env):
    openai = OpenAIProvider({"OPENAI_API_KEY": "oa-key", "MDNOTES_OPENAI_MODELS": "gpt-5.1,gpt-6.1,gpt-6.1-sol"})
    openai.apply_catalog(["gpt-5.1", "gpt-6.1", "gpt-6.1-sol", "gpt-image-1"])
    return open_providers({**ENV, **env}, openai=openai)


class FakeHTTP:
    def __init__(self, events):
        self.events, self.sent = events, []

    def stream_events(self, url, payload, headers, timeout):
        self.sent.append({"url": url, "payload": payload, "headers": headers, "timeout": timeout})
        yield from self.events

    def post_json(self, url, payload, headers, timeout):
        self.sent.append({"url": url, "payload": payload, "headers": headers})
        return {"choices": [{"message": {"content": "whole"}}]}


class Routes(unittest.TestCase):
    def test_each_model_goes_to_its_provider_and_unknown_ones_get_the_default(self):
        p = providers()
        self.assertEqual(p.all_models()[:2], ["deepseek-flash", "deepseek-extra"])
        self.assertIn("gpt-6.1-sol", p.all_models())
        ds = p.route("deepseek-extra")
        self.assertEqual((ds.model, ds.url, ds.key, ds.label, ds.responses_url), ("deepseek-extra", "https://ds.invalid/chat", "ds-key", "DeepSeek", ""))
        gpt5 = p.route("gpt-5.1")
        self.assertEqual((gpt5.url, gpt5.key, gpt5.label, gpt5.responses_url), ("https://api.openai.com/v1/chat/completions", "oa-key", "OpenAI", ""))
        self.assertEqual(p.route("gpt-6.1-sol").responses_url, "https://api.openai.com/v1/responses", "GPT 6 needs the Responses API")
        self.assertEqual(p.route("gpt-99").model, "deepseek-flash")
        self.assertEqual(p.route().model, "deepseek-flash")
        self.assertEqual(p.provider_of("gpt-6.1"), "OpenAI")
        self.assertEqual(p.provider_of("deepseek-extra"), "DeepSeek")

    def test_a_users_own_key_goes_where_they_say_with_the_model_they_chose(self):
        p = providers()
        own = p.route("gpt-5.1", own_key="mine", own_url="https://mine.invalid/v1/chat", own_model="llama")
        self.assertEqual((own.model, own.url, own.key), ("llama", "https://mine.invalid/v1/chat", "mine"))
        self.assertEqual(p.route(None, own_key="mine").url, "https://ds.invalid/chat")
        self.assertTrue(p.route("gpt-6.1", own_key="mine", own_url="https://api.openai.com/v1/chat/completions").responses_url)
        self.assertFalse(open_providers({}, openai=OpenAIProvider({})).route().ready, "no key, not ready")


class Streams(unittest.TestCase):
    def test_a_chat_stream_shows_text_and_progress_and_returns_the_whole_reply(self):
        p = providers(DEEPSEEK_ENABLE_THINKING="1", MDNOTES_CHAT_ORGANIZATION="org-1")
        p.http = FakeHTTP([
            {"choices": [{"delta": {"reasoning_content": "hm"}}]},
            {"choices": [{"delta": {"content": "Writing "}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "edit_file", "arguments": '{"pa'}}]}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'th":"a.md"}'}}]}, "finish_reason": "tool_calls"}]},
        ])
        shown = []
        result = p.stream(p.route(), {"model": "deepseek-flash", "temperature": 0.2, "messages": []}, shown.append)
        sent = p.http.sent[0]
        self.assertEqual(sent["payload"]["thinking"], {"type": "enabled"})
        self.assertTrue(sent["payload"]["stream"])
        self.assertEqual(sent["headers"]["Authorization"], "Bearer ds-key")
        self.assertEqual(sent["headers"]["OpenAI-Organization"], "org-1")
        self.assertEqual([e["type"] for e in shown[:2]], ["reasoning", "delta"])
        self.assertIn({"type": "writing", "name": "edit_file", "chars": 4}, shown)
        message = result["choices"][0]["message"]
        self.assertEqual(message["content"], "Writing ")
        self.assertEqual(message["tool_calls"][0]["function"], {"name": "edit_file", "arguments": '{"path":"a.md"}'})
        self.assertEqual(result["choices"][0]["finish_reason"], "tool_calls")

    def test_gpt_6_goes_through_the_responses_api_in_chat_form(self):
        p = providers()
        p.http = FakeHTTP([
            {"type": "response.output_text.delta", "delta": "Aye."},
            {"type": "response.completed"},
        ])
        shown = []
        result = p.stream(p.route("gpt-6.1-sol"), {"model": "gpt-6.1-sol", "temperature": 0.8,
                                                    "messages": [{"role": "system", "content": "be Mara"}]}, shown.append)
        sent = p.http.sent[0]
        self.assertEqual(sent["url"], "https://api.openai.com/v1/responses")
        self.assertNotIn("temperature", sent["payload"], "reasoning models take only the default")
        self.assertEqual(sent["payload"]["input"][0], {"role": "developer", "content": "be Mara"})
        self.assertEqual(shown, [{"type": "delta", "text": "Aye."}])
        self.assertEqual(result["choices"][0]["message"], {"role": "assistant", "content": "Aye."})

    def test_complete_sends_the_same_request_without_streaming(self):
        p = providers()
        p.http = FakeHTTP([])
        result = p.complete(p.route("gpt-5.1"), {"model": "gpt-5.1", "temperature": 0.4, "messages": []})
        self.assertEqual(result["choices"][0]["message"]["content"], "whole")
        self.assertNotIn("temperature", p.http.sent[0]["payload"])
        self.assertEqual(p.options({"model": "deepseek-flash", "temperature": 0.4})["temperature"], 0.4)

    def test_a_chunk_with_text_and_reasoning_shows_both_in_order(self):
        stream = ChatStream()
        self.assertEqual(stream.feed({"choices": [{"delta": {"content": "a", "reasoning_content": "b"}}]}),
                         [{"text": "a"}, {"reasoning": "b"}])
        self.assertEqual(stream.feed({"choices": []}), [])


if __name__ == "__main__":
    unittest.main()
