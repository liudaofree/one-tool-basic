import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const modules = new Map();
function moduleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href);
  let js = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  js = js.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, (_match, spec) => `from '${moduleUrl(new URL(spec + '.ts', url))}'`);
  const result = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64'); modules.set(url.href, result); return result;
}
const cookies = await import(moduleUrl('../src/utils/http-cookies.ts'));
const { Storage } = await import(moduleUrl('../src/utils/storage.ts'));
const { prepareHttpRequest, requestPreview } = await import(moduleUrl('../src/utils/http-request.ts'));
const { parseCurlCommand, generateCurlCommand } = await import(moduleUrl('../src/utils/curl.ts'));
const saved = new Map();
globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) };
const kv = (key, value, enabled = true) => ({ key, value, enabled });
const cookie = (name, value, extra = {}) => ({ id: name, name, value, domain: 'example.com', path: '/', hostOnly: true, ...extra });
test('jar matches host-only/domain, path boundary, secure and expiry', () => {
  const map = { 'example.com': [cookie('host', '1'), cookie('domain', '2', { hostOnly: false }), cookie('api', '3', { path: '/api' }), cookie('secure', '4', { secure: true }), cookie('old', '5', { expires: '2000-01-01' })] };
  assert.deepEqual(cookies.cookiesForUrl(map, 'http://example.com/apix').map(c => c.name), ['host', 'domain']);
  assert.deepEqual(cookies.cookiesForUrl(map, 'https://sub.example.com/api').map(c => c.name), ['domain']);
  assert.deepEqual(cookies.cookiesForUrl(map, 'https://example.com/api/users').map(c => c.name), ['api', 'host', 'domain', 'secure']);
});
test('Set-Cookie scope, default path, Max-Age precedence and deletion', () => {
  const now = Date.now();
  const c = cookies.parseSetCookie('https://api.example.com/a/b', 'sid=abc; HttpOnly; Secure; Expires=Wed, 01 Jan 2000 00:00:00 GMT; Max-Age=60', now);
  assert.equal(c.path, '/a'); assert.equal(c.hostOnly, true); assert.equal(c.secure, true);
  assert.equal(Date.parse(c.expires), now + 60000);
  assert.equal(cookies.parseSetCookie('https://api.example.com', 'sid=x; Domain=evil.test'), undefined);
  assert.equal(cookies.parseSetCookie('https://api.example.com', 'sid=x; Domain=example.com').hostOnly, false);
  assert.equal(Date.parse(cookies.parseSetCookie('https://example.com', 'sid=; Max-Age=0').expires), 0);
});
test('editing keeps ID, supports renaming/path changes and does not delete sibling paths', () => {
  saved.clear();
  Storage.addOrUpdateCookie('example.com', { name: 'sid', value: 'root', path: '/' });
  Storage.addOrUpdateCookie('example.com', { name: 'sid', value: 'api', path: '/api' });
  const root = Storage.getDomainCookies()['example.com'].find(c => c.path === '/');
  Storage.addOrUpdateCookie('example.com', { name: 'session', value: 'edited', path: '/v2', secure: true }, root.id);
  const result = Storage.getDomainCookies()['example.com'];
  assert.equal(result.length, 2);
  assert.equal(result.find(c => c.id === root.id).name, 'session');
  Storage.deleteCookie('example.com', root.id);
  assert.equal(Storage.getDomainCookies()['example.com'][0].path, '/api');
  Storage.saveSetCookies('https://example.com/api', ['sid=; Path=/api; Max-Age=0']);
  assert.equal(Storage.getDomainCookies()['example.com'].length, 0);
});
test('request cookie rows override header and jar case-sensitively', () => {
  const result = cookies.mergeCookies([cookie('sid', 'jar'), cookie('SID', 'upper')], [kv('Cookie', 'sid=header; token=h')], [kv('sid', 'row')]);
  assert.deepEqual(result.map(c => [c.key, c.value]), [['SID', 'upper'], ['token', 'h'], ['sid', 'row']]);
});
test('preview and cURL use resolved URL, body and one merged Cookie header', () => {
  const raw = { method: 'post', url: '{{base}}/api?id=1', headers: [kv('Cookie', 'sid=header')], cookies: [kv('sid', '{{token}}')], body_type: 'json', body_content: '{"message":"{{token}}"}' };
  const req = prepareHttpRequest(raw, { base: 'https://example.com', token: 'resolved' }, () => [cookie('sid', 'jar')]);
  assert.equal(req.url, 'https://example.com/api?id=1');
  assert.equal(req.headers.find(h => h.key === 'Cookie').value, 'sid=resolved');
  assert.deepEqual(req.cookies, []);
  assert.match(requestPreview(req), /sid=resolved/);
  assert.match(generateCurlCommand(req), /sid=resolved/);
  assert.equal(raw.cookies[0].value, '{{token}}');
});
test('cURL round-trip preserves apostrophes, backslashes, Unicode, empty body and explicit GET', () => {
  for (const body of ['', JSON.stringify({ text: "O'Brien", path: 'C:\\temp\\a', text2: '你好\\n"quoted"' })]) {
    const req = { method: 'GET', url: 'https://example.test/api?a=1&a=2', body_type: 'json', body_content: body, headers: [kv('X-Quote', "a'b\\c")] };
    const parsed = parseCurlCommand(generateCurlCommand(req));
    assert.equal(parsed.method, 'GET'); assert.equal(parsed.body_content, body); assert.equal(parsed.headers[0].value, "a'b\\c");
    assert.equal(parsed.headers.filter(h => h.key.toLowerCase() === 'content-type').length, 1);
  }
});
test('form-data text round-trip, no manual boundary and file uploads explicitly rejected', () => {
  const req = prepareHttpRequest({ method: 'POST', url: 'https://example.test/api', headers: [kv('Content-Type', 'multipart/form-data; boundary=old')], body_type: 'form-data', form_data: [kv('text', "@literal;O'Brien\\x")] }, {}, () => []);
  assert.equal(req.headers.length, 0);
  const parsed = parseCurlCommand(generateCurlCommand(req));
  assert.equal(parsed.body_type, 'form-data'); assert.equal(parsed.form_data[0].value, "@literal;O'Brien\\x");
  assert.throws(() => parseCurlCommand("curl https://example.test -F 'file=@a.txt'"), /文件上传/);
});
test('urlencoded repeated and empty values survive cURL round-trip', () => {
  const raw = { method: 'POST', url: 'http://example.test/api', body_type: 'x-www-form-urlencoded', form_data: [kv('a', '1'), kv('a', '2'), kv('empty', ''), kv('name', '中 文+')] };
  const parsed = parseCurlCommand(generateCurlCommand(raw));
  assert.deepEqual(parsed.form_data, raw.form_data);
  assert.equal(parseCurlCommand("curl -X GET https://example.test -d 'q=1'").method, 'GET');
});
test('invalid headers, cookies and malformed cURL produce explicit errors', () => {
  assert.throws(() => prepareHttpRequest({ method: 'GET', url: 'https://example.test', headers: [kv('X-Test', 'x\r\ny')] }, {}, () => []), /非法/);
  assert.throws(() => Storage.addOrUpdateCookie('example.test', { name: 'bad name', value: 'x' }), /非法/);
  assert.throws(() => parseCurlCommand("curl 'https://example.test"), /引号/);
  assert.throws(() => parseCurlCommand('curl https://example.test --unknown x'), /暂不支持/);
});
test('raw cURL does not introduce a form content type', () => {
  const req = { method: 'POST', url: 'https://example.test', body_type: 'raw', body_content: '{"raw":true}' };
  const command = generateCurlCommand(req);
  assert.match(command, /Content-Type:'/);
  const parsed = parseCurlCommand(command);
  assert.equal(parsed.body_type, 'raw');
  assert.equal(parsed.body_content, req.body_content);
  assert.equal(parsed.headers.length, 0);
});
test('renaming to another cookie identity fails without changing persisted values', () => {
  saved.clear();
  Storage.addOrUpdateCookie('example.test', { name: 'one', value: '1', path: '/' });
  Storage.addOrUpdateCookie('example.test', { name: 'two', value: '2', path: '/' });
  const before = Storage.getDomainCookies();
  assert.throws(() => Storage.addOrUpdateCookie('example.test', { name: 'two', value: 'new', path: '/' }, before['example.test'][0].id), /已存在/);
  assert.deepEqual(Storage.getDomainCookies(), before);
});
