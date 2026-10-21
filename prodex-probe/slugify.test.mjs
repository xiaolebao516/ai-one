import test from 'node:test';
import assert from 'node:assert/strict';

import { slugify } from './slugify.mjs';

test('lowercases, trims, and collapses consecutive separators', () => {
  assert.equal(slugify('  Hello___WORLD!!!  '), 'hello-world');
});

test('preserves Unicode letters and numbers', () => {
  assert.equal(slugify(' 中文 日本 123 '), '中文-日本-123');
});

test('preserves combining marks inside Unicode words after NFC normalization', () => {
  assert.equal(slugify('İstanbul'), 'i\u0307stanbul');
  assert.equal(slugify('re\u0301sume\u0301'), 'résumé');
});

test('never leaves a leading or trailing hyphen', () => {
  assert.equal(slugify('--- Hello ---'), 'hello');
});

test('truncates to maxLength and removes a hyphen at the truncation boundary', () => {
  assert.equal(slugify('alpha beta', 6), 'alpha');
});

test('uses untitled for empty, symbol-only, and non-string inputs', () => {
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('---___!!!'), 'untitled');
  assert.equal(slugify(null), 'untitled');
  assert.equal(slugify(123), 'untitled');
});

test('does not modify the input value', () => {
  const input = '  Keep Me  ';
  slugify(input);
  assert.equal(input, '  Keep Me  ');
});

test('honors maxLength at the boundary', () => {
  assert.equal(slugify('abcde', 5), 'abcde');
  assert.equal(slugify('abcdef', 5), 'abcde');
  assert.equal(slugify('ab', 1), 'a');
});

test('uses the default maxLength of 40', () => {
  assert.equal(slugify('a'.repeat(41)), 'a'.repeat(40));
});
