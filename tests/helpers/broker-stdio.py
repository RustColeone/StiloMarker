"""Test-only JSON-line transport to the production broker; never opens a socket."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
# Answers go to stdout; everything the server logs goes to stderr.
ANSWERS, sys.stdout = sys.stdout, sys.stderr
spec = importlib.util.spec_from_file_location('server', Path(__file__).resolve().parents[2] / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
server._log = lambda *args, **kwargs: None
from stilo.modules.sync import open_live  # noqa: E402
with tempfile.TemporaryDirectory() as directory:
    broker = open_live('2468', state_file=Path(directory) / 'state.json')
    tokens = {name: broker.connect('2468', name)['token'] for name in ('a', 'b')}
    broker.apply_operation(tokens['a'], {'type': 'create-file', 'parentPath': '', 'name': 'note.md', 'content': 'x'})
    for line in sys.stdin:
        request = json.loads(line)
        name = request.get('client', 'a')
        try:
            if request['type'] == 'open':
                result = {'token': name, 'clientId': broker.sessions.tokens[tokens[name]], 'revision': broker.revision}
            elif request['type'] == 'get':
                result = broker.get_state(tokens[name])
            else:
                result = broker.apply_operation(tokens[name], request['operation'])
            print(json.dumps({'result': result}), file=ANSWERS, flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), file=ANSWERS, flush=True)
