"""Test-only JSON-line transport to the production broker; never opens a socket."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
spec = importlib.util.spec_from_file_location('server', Path(__file__).resolve().parents[2] / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
server._log = lambda *args, **kwargs: None
with tempfile.TemporaryDirectory() as directory:
    broker = server.CollaborationBroker('2468', Path(directory) / 'state.json')
    tokens = {name: broker.connect('2468', name)['token'] for name in ('a', 'b')}
    broker.apply_operation(tokens['a'], {'type': 'create-file', 'parentPath': '', 'name': 'note.md', 'content': 'x'})
    for line in sys.stdin:
        request = json.loads(line)
        name = request.get('client', 'a')
        try:
            if request['type'] == 'open':
                result = {'token': name, 'clientId': broker.tokens[tokens[name]], 'revision': broker.revision}
            elif request['type'] == 'get':
                result = broker.get_state(tokens[name])
            else:
                result = broker.apply_operation(tokens[name], request['operation'])
            print(json.dumps({'result': result}), flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), flush=True)
