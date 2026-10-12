import test from 'node:test';
import assert from 'node:assert/strict';
import { colorFor, findMentions, initialsFor, parsePersona, personaFileName, personaHandle, personaSummary, personaTemplate } from '../app/services/persona-service.js';
import { isAllowedFileName, isMarkdownFileName, isPersonaFileName, isTextFileName } from '../app/domain/project-model.js';

test('persona files are allowed, text, and Markdown', () => {
  assert.ok(isAllowedFileName('aria.persona.skill'));
  assert.ok(isTextFileName('aria.persona.skill'));
  assert.ok(isMarkdownFileName('aria.persona.skill'));
  assert.ok(isMarkdownFileName('notes.md'));
  assert.ok(!isMarkdownFileName('map.bmap'));
  assert.ok(isPersonaFileName('Cast/Aria.Persona.Skill'));
  assert.ok(!isPersonaFileName('aria.skill'));
  assert.ok(!isPersonaFileName('aria.persona.md'));
});

test('header keys are read; comments, quotes and CRLF are tolerated', () => {
  const persona = parsePersona([
    '---',
    'name: "Captain Aria Voss"',
    'avatar: portraits/aria.png      # relative to this file',
    'color: #b5523b',
    'temperature: 0.9',
    'mood: grim',
    '---',
    '## Who they are',
    'A smuggler.'
  ].join('\r\n'), 'Cast/aria.persona.skill');
  assert.equal(persona.name, 'Captain Aria Voss');
  assert.equal(persona.handle, 'aria');
  assert.equal(persona.avatar, 'portraits/aria.png');
  assert.equal(persona.color, '#b5523b');
  assert.equal(persona.temperature, 0.9);
  assert.equal(persona.body, '## Who they are\nA smuggler.');
});

test('no header: name from the file, colour derived, whole file is the sheet', () => {
  const persona = parsePersona('Speaks in riddles.', 'Old Hermit.persona.skill');
  assert.equal(persona.name, 'Old Hermit');
  assert.equal(persona.handle, 'old-hermit');
  assert.equal(persona.avatar, '');
  assert.equal(persona.color, colorFor('Old Hermit'));
  assert.equal(persona.temperature, null);
  assert.equal(persona.body, 'Speaks in riddles.');
});

test('bad colour and temperature fall back or clamp', () => {
  const header = (lines) => `---\n${lines.join('\n')}\n---\nbody`;
  assert.equal(parsePersona(header(['name: X', 'color: red']), 'x.persona.skill').color, colorFor('X'));
  assert.equal(parsePersona(header(['temperature: 9']), 'x.persona.skill').temperature, 1.5);
  assert.equal(parsePersona(header(['temperature: -1']), 'x.persona.skill').temperature, 0);
  assert.equal(parsePersona(header(['temperature: warm']), 'x.persona.skill').temperature, null);
  // An unterminated header is just text.
  assert.equal(parsePersona('---\nname: Y\nbody', 'y.persona.skill').name, 'y');
});

test('handles are lowercase, hyphenated, and keep non-Latin letters', () => {
  assert.equal(personaHandle('a/b/Captain Aria.persona.skill'), 'captain-aria');
  assert.equal(personaHandle('李白.persona.skill'), '李白');
  assert.equal(personaHandle('!!!.persona.skill'), 'character');
});

test('mentions: order, de-duplication, @all, e-mails, unknown handles', () => {
  const members = [{ handle: 'aria' }, { handle: 'old-hermit' }, { handle: '李白' }];
  assert.deepEqual(findMentions('@old-hermit, then @aria. @aria again', members), ['old-hermit', 'aria']);
  assert.deepEqual(findMentions('mail aria@ship.com or @bob', members), []);
  assert.deepEqual(findMentions('(@ARIA) what now?', members), ['aria']);
  assert.deepEqual(findMentions('@李白 写首诗', members), ['李白']);
  assert.deepEqual(findMentions('@aria first, then @all', members), ['aria', 'old-hermit', '李白']);
  assert.deepEqual(findMentions('@everyone', members), ['aria', 'old-hermit', '李白']);
  assert.deepEqual(findMentions('no mention here', members), []);
  assert.deepEqual(findMentions('@aria-', members), ['aria']);
});

test('summary is the first prose paragraph, trimmed', () => {
  assert.equal(personaSummary('## Who\nA *smuggler* with\na debt.\n\nMore.'), 'A smuggler with a debt.');
  assert.equal(personaSummary('# Only headings'), '');
  assert.ok(personaSummary('x'.repeat(500)).length <= 200);
});

test('initials, file names and the template', () => {
  assert.equal(initialsFor('Captain Aria Voss'), 'CV');
  assert.equal(initialsFor('aria'), 'A');
  assert.equal(initialsFor(''), '?');
  assert.equal(personaFileName('Aria / Voss'), 'Aria Voss.persona.skill');
  assert.equal(personaFileName(''), 'new character.persona.skill');
  const persona = parsePersona(personaTemplate('Aria'), 'aria.persona.skill');
  assert.equal(persona.name, 'Aria');
  assert.equal(persona.avatar, '');
  assert.match(persona.body, /^## Who they are/);
});
