import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/text-diff.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const { compareTexts } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('finds a change inside an otherwise identical method', () => {
  const result = compareTexts('void save() {\n  send(user, 1);\n}', 'void save() {\n  send(user, 2);\n}');
  assert.deepEqual([result.added, result.removed, result.modified], [0, 0, 1]);
  assert.equal(result.rows[1].leftLine, 2);
  assert.equal(result.rows[1].rightLine, 2);
  assert.deepEqual(result.rows[1].leftParts.filter(part => part.changed).map(part => part.text), ['1']);
  assert.deepEqual(result.rows[1].rightParts.filter(part => part.changed).map(part => part.text), ['2']);
});

test('aligns inserted and deleted lines around unchanged code', () => {
  const result = compareTexts('start\nold\nkeep\nend', 'start\nkeep\nnew\nend');
  assert.deepEqual(result.rows.map(row => row.kind), ['equal', 'removed', 'equal', 'added', 'equal']);
  assert.deepEqual([result.removed, result.added, result.modified], [1, 1, 0]);
});

test('reports whitespace and line-ending differences separately', () => {
  const whitespace = compareTexts('return a + b;', 'return a+b;');
  assert.equal(whitespace.modified, 1);
  const endings = compareTexts('a\r\nb\r\n', 'a\nb\n');
  assert.equal(endings.changes.length, 0);
  assert.equal(endings.lineEndingDifferent, true);
  assert.equal(compareTexts('a\n', 'a').changes.length, 1);
});

test('keeps both sides intact across repeated lines and mixed edits', () => {
  let state = 17;
  const random = () => ((state = (state * 48271) % 2147483647) % 5);
  for (let sample = 0; sample < 80; sample++) {
    const left = Array.from({ length: random() + 3 }, () => `line ${random()}`).join('\n');
    const right = Array.from({ length: random() + 3 }, () => `line ${random()}`).join('\n');
    const result = compareTexts(left, right);
    assert.equal(result.rows.filter(row => row.left !== undefined).map(row => row.left).join('\n'), left);
    assert.equal(result.rows.filter(row => row.right !== undefined).map(row => row.right).join('\n'), right);
    assert.equal(result.changes.length === 0, left === right);
  }
});
