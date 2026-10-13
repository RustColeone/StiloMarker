import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findMentions, personaHandle } from '../app/services/persona-service.js';

// The server decides which characters reply (server/conversations.py) and the
// browser highlights mentions; both read this table so they agree.
const table = JSON.parse(await readFile(new URL('./mention-cases.json', import.meta.url), 'utf8'));

test('browser mention parsing matches the shared table', () => {
  const members = table.handles.map((handle) => ({ handle }));
  for (const { text, expect } of table.cases) assert.deepEqual(findMentions(text, members), expect, text);
  for (const { path, expect } of table.handleCases) assert.equal(personaHandle(path), expect, path);
});
