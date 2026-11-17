import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = readFileSync(new URL('../src/utils/http-query.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const { urlOnlyPayload, queryFromUrl, updateUrlQuery } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const kv = (key, value, enabled = true) => ({ key, value, enabled });
test('UI query rows are not appended twice by the native sender', () => {
  const params = [kv('id', '123'), kv('keyword', '测试 + & =')];
  const url = updateUrlQuery('https://example.test/api', params);
  const request = urlOnlyPayload({ method: 'GET', url, params });
  // Same append contract as Rust execute_http_request.
  const outgoing = new URL(request.url);
  for (const p of request.params ?? []) if (p.enabled) outgoing.searchParams.append(p.key, p.value);
  assert.deepEqual(outgoing.searchParams.getAll('id'), ['123']);
  assert.deepEqual(outgoing.searchParams.getAll('keyword'), ['测试 + & =']);
  assert.equal(request.params, undefined);
});
test('intentional repeated keys and existing URL encoding are preserved', () => {
  const url = 'https://example.test/api?tag=a&tag=b&signature=a%2Bb%20c';
  assert.equal(urlOnlyPayload({ method: 'GET', url, params: queryFromUrl(url) }).url, url);
  assert.deepEqual(queryFromUrl(url).map(p => p.value), ['a', 'b', 'a+b c']);
});
test('disabled and deleted parameters disappear while fragment is retained', () => {
  assert.equal(updateUrlQuery('http://localhost/api?old=1#section', [kv('q', 'hello world'), kv('skip', '1', false)]), 'http://localhost/api?q=hello+world#section');
  assert.equal(updateUrlQuery('http://localhost/api?old=1#section', []), 'http://localhost/api#section');
  assert.deepEqual(queryFromUrl('http://localhost/api#section?not=query'), []);
  assert.deepEqual(queryFromUrl('http://localhost/api'), []);
});
test('history without query rows still retains query in URL and body', () => {
  const request = { method: 'POST', url: 'http://localhost/api?id=1', body_type: 'json', body_content: '{"id":2}' };
  assert.deepEqual(urlOnlyPayload(request), request);
});
