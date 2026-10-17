import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChats } from '../app/modules/chats/index.js';

// Chats in a browser-only workspace: characters only, kept in this browser,
// replies run here. Same behaviour as the server where they overlap.
const ARIA = 'char:Cast/aria.persona.skill';
const BRAM = 'char:Cast/bram.persona.skill';
const characters = [
  { key: ARIA, path: 'Cast/aria.persona.skill', name: 'Captain Aria Voss', handle: 'aria', content: 'A smuggler.', body: 'A smuggler.' },
  { key: BRAM, path: 'Cast/bram.persona.skill', name: 'Bram', handle: 'bram', content: 'A cook.', body: 'A cook.' }
];

function harness({ reply = ({ character }) => `${character.name} says hi`, hold } = {}) {
  const saved = new Map(), events = [], turns = [];
  const records = { load: async (key) => structuredClone(saved.get(key) ?? null), save: async (record) => { saved.set(record.key, structuredClone(record)); } };
  let clock = 1_000_000;
  const store = createLocalChats({
    workspaceKey: 'w', listCharacters: () => characters, records, onEvent: (event) => events.push(event), now: () => (clock += 1000),
    async runReply(job) {
      turns.push(job);
      const text = reply(job);
      job.onText(text.slice(0, 4));
      if (hold) await hold(job);
      if (job.signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      return text;
    }
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { store, events, turns, saved, settle };
}

test('a pair with a character is reused, and the character answers every message', async () => {
  const h = harness();
  const first = await h.store.start([ARIA]);
  const again = await h.store.start([ARIA]);
  assert.equal(first.created, true); assert.equal(again.created, false);
  assert.equal(first.conversation.id, again.conversation.id);
  const sent = await h.store.send(first.conversation.id, 'Ahoy', ['notes.md']);
  assert.deepEqual(sent.replies, [ARIA]);
  await h.settle();
  const { messages } = await h.store.messages(first.conversation.id);
  assert.deepEqual(messages.map((m) => [m.author, m.content]), [['user:you', 'Ahoy'], [ARIA, 'Captain Aria Voss says hi']]);
  assert.deepEqual(h.turns[0].transcript, [{ name: 'You', content: 'Ahoy', self: false }]);
  assert.deepEqual(h.turns[0].trigger.contextPaths, ['notes.md']);
  const typing = h.events.filter((e) => e.type === 'chat-typing').map((e) => e.state);
  assert.deepEqual([typing[0], typing.at(-1)], ['queued', 'end']);
  assert.ok(typing.includes('writing'));
  assert.equal(h.events.filter((e) => e.type === 'chat-message').length, 2);
});

test('in a group only mentioned characters reply, in order, each seeing the earlier replies', async () => {
  const h = harness();
  const { conversation } = await h.store.start([ARIA, BRAM]);
  assert.equal(conversation.kind, 'group');
  assert.deepEqual((await h.store.send(conversation.id, 'The storm hits.')).replies, []);
  assert.deepEqual((await h.store.send(conversation.id, '@bram then @aria')).replies, [BRAM, ARIA]);
  await h.settle();
  assert.deepEqual(h.turns.map((t) => t.character.key), [BRAM, ARIA]);
  assert.deepEqual(h.turns[1].transcript.at(-1), { name: 'Bram', content: 'Bram says hi', self: false });
  assert.deepEqual((await h.store.send(conversation.id, '@all')).replies, [ARIA, BRAM]);
  await h.settle();
});

test('inviting into a pair starts a new group and keeps the pair', async () => {
  const h = harness();
  const pair = (await h.store.start([ARIA])).conversation;
  await h.store.send(pair.id, 'just us');
  await h.settle();
  const invited = await h.store.invite(pair.id, [BRAM]);
  assert.equal(invited.created, true);
  assert.notEqual(invited.conversation.id, pair.id);
  assert.deepEqual([...invited.conversation.members].sort(), ['user:you', ARIA, BRAM].sort());
  assert.equal((await h.store.messages(pair.id)).messages.length, 2);
  await assert.rejects(h.store.invite(pair.id, [ARIA]), /already/);
});

test('stop keeps what was written and stops the queue', async () => {
  let release;
  const h = harness({ reply: () => 'one two three', hold: () => new Promise((r) => { release = r; }) });
  const { conversation } = await h.store.start([ARIA, BRAM]);
  await h.store.send(conversation.id, '@all go');
  await h.settle();
  assert.equal(h.store.isBusy(conversation.id), true);
  assert.equal((await h.store.stop(conversation.id)).stopped, true);
  release();
  await h.settle();
  const last = (await h.store.messages(conversation.id)).messages.at(-1);
  assert.equal(last.state, 'interrupted');
  assert.equal(last.content, 'one'); // what was written so far, trimmed
  assert.equal(h.turns.length, 1, 'the second character never started');
});

test('unread, search, notes, and only characters can join here', async () => {
  const h = harness();
  const { conversation } = await h.store.start([ARIA]);
  await h.store.send(conversation.id, 'The lighthouse keeper');
  await h.settle();
  let overview = await h.store.overview();
  assert.equal(overview.conversations[0].unread, 1); // the reply
  assert.deepEqual(overview.people, []);
  const last = (await h.store.messages(conversation.id)).messages.at(-1);
  await h.store.read(conversation.id, last.id);
  overview = await h.store.overview();
  assert.equal(overview.conversations[0].unread, 0);
  assert.equal((await h.store.search(conversation.id, 'lighthouse')).results.length, 1);
  await h.store.note(ARIA, 'Cap', 'plays the smuggler');
  assert.equal((await h.store.overview()).notes[ARIA].alias, 'Cap');
  await assert.rejects(h.store.start(['user:bob']), /characters/);
  assert.ok(h.saved.get('w'), 'it is saved in this browser');
});

test('old Roleplay threads come in as groups; renamed character files are followed', async () => {
  const h = harness();
  const { conversation } = await h.store.importGroup('Storm', ['Cast/aria.persona.skill', 'Cast/ghost.persona.skill'], [
    { role: 'user', content: 'The lamp is out', authorName: 'Leo', createdAt: 1_700_000_000_000 },
    { role: 'assistant', content: 'Bail faster.', speaker: 'Cast/aria.persona.skill', speakerName: 'Aria' },
    { role: 'assistant', content: 'ghost line', speaker: 'Cast/ghost.persona.skill' },
    { role: 'system', content: 'Stopped' }
  ]);
  assert.equal(conversation.kind, 'group');
  assert.deepEqual(conversation.members, ['user:you', ARIA]);
  const { messages } = await h.store.messages(conversation.id);
  assert.deepEqual(messages.map((m) => [m.author, m.content]), [['user:you', 'The lamp is out'], [ARIA, 'Bail faster.']]);
  assert.equal(messages[0].createdAt, 1_700_000_000);
  await h.store.renameCharacterPaths('Cast', 'People/Cast');
  const moved = (await h.store.messages(conversation.id)).messages[1].author;
  assert.equal(moved, 'char:People/Cast/aria.persona.skill');
});
