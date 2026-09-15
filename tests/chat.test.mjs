import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, sanitizeChat, isCommand, parseCommand, DEFAULT_MAX_LEN } from '../src/shared/chat.mjs';

test('escapeHtml neutralises specials', () => {
  assert.equal(escapeHtml('<b>"hi"</b>'), '&lt;b&gt;&quot;hi&quot;&lt;/b&gt;');
  assert.equal(escapeHtml("a'b"), 'a&#39;b');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml('already & safe'), 'already &amp; safe');
});

test('sanitizeChat trims and caps length', () => {
  assert.equal(sanitizeChat('  hi  '), 'hi');
  assert.equal(sanitizeChat('x'.repeat(200), 140).length, 140);
  assert.equal(sanitizeChat(null), '');
});

test('isCommand distinguishes slash commands', () => {
  assert.equal(isCommand('/name Bob'), true);
  assert.equal(isCommand('hello'), false);
});

test('parseCommand splits command + args and lowercases', () => {
  assert.deepEqual(parseCommand('/name Alice'), { command: 'name', args: 'Alice' });
  assert.deepEqual(parseCommand('/HELP me'), { command: 'help', args: 'me' });
  assert.equal(parseCommand('not a command'), null);
});

test('DEFAULT_MAX_LEN is 140', () => {
  assert.equal(DEFAULT_MAX_LEN, 140);
});
