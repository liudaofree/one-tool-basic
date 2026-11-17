import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = readFileSync(new URL('../src/utils/json-response.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const { parseJsonTree } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('nested response creates independently foldable object and array nodes', () => {
  const tree = parseJsonTree('{"data":{"items":[{"id":1},{"id":2}],"empty":[]},"ok":true}');
  assert.equal(tree.kind, 'object');
  assert.equal(tree.children[0].label, '"data"');
  const items = tree.children[0].node.children[0].node;
  assert.equal(items.kind, 'array'); assert.equal(items.children.length, 2);
  assert.equal(items.children[1].label, '[1]');
  assert.equal(tree.children[0].node.children[1].node.raw, '[]');
});
test('source tokens preserve large IDs, numeric notation, duplicate keys and escaped strings', () => {
  const tree = parseJsonTree('{"id":9223372036854775807,"id":1.00e+5,"text":"<script>\\n\\\"x\\\"</script>"}');
  assert.equal(tree.children[0].node.raw, '9223372036854775807');
  assert.equal(tree.children[1].node.raw, '1.00e+5');
  assert.equal(tree.children[0].label, tree.children[1].label);
  assert.equal(tree.children[2].node.raw, '"<script>\\n\\\"x\\\"</script>"');
});
test('primitive and empty JSON remain valid while invalid and excessively deep JSON fall back to raw', () => {
  assert.equal(parseJsonTree('null').raw, 'null');
  assert.equal(parseJsonTree('{}').children.length, 0);
  assert.throws(() => parseJsonTree('{"bad":}'));
  assert.throws(() => parseJsonTree('['.repeat(160) + '0' + ']'.repeat(160)), /层级过深/);
});
