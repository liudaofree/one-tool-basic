import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function load(source) {
  const code = ts.transpileModule(readFileSync(new URL(source, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const tree = await load('../src/utils/json-response.ts');
const mapping = await load('../src/utils/field-mapping.ts');
const java = await load('../src/utils/java-field-mapping.ts');

test('generic mapping has no built-in business profile and validates custom labels', () => {
  assert.equal('BUILTIN_BUSINESS_PROFILES' in mapping, false);
  assert.deepEqual(mapping.validateBusinessProfile({ id: 'sample', name: 'Example', fields: [{ path: '$.items[].code', label: 'Code' }] }),
    { id: 'sample', name: 'Example', fields: [{ path: '$.items[].code', label: 'Code' }] });
  assert.throws(() => mapping.validateBusinessProfile({ id: 'sample', name: 'Example', fields: [{ path: 'items.code', label: 'Code' }] }));
});

test('field mapping resolves nested arrays and preserves source number text', () => {
  const root = tree.parseJsonTree('{"items":[{"code":12345678901234567890},{"code":2}]}');
  const profile = { id: 'sample', name: 'Example', fields: [{ path: '$.items[].code', label: '编号' }] };
  assert.deepEqual(mapping.resolveBusinessFields(root, profile, '').map(item => [item.path, item.value]), [
    ['$.items[0].code', '12345678901234567890'], ['$.items[1].code', '2'],
  ]);
  assert.equal(mapping.resolveBusinessFields(root, profile, '编号').length, 2);
});

test('Java entity annotations generate a field mapping draft', () => {
  const root = tree.parseJsonTree('{"id":7}');
  const result = java.generateBusinessFieldsFromJava(['class Sample { @Schema(description="编号") private Long id; }'], root);
  assert.deepEqual(result.fields, [{ path: '$.id', label: '编号' }]);
});
