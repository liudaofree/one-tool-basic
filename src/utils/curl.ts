import type { HttpRequestPayload, HttpKeyValueItem } from '../types/http';

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '', quote = '', started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = ''; else current += c;
    } else if (quote === '"') {
      if (c === '"') quote = '';
      else if (c === '\\' && /["\\$`]/.test(command[i + 1] || ' ')) current += command[++i];
      else current += c;
    } else if (c === "'" || c === '"') { quote = c; started = true; }
    else if (c === '\\') {
      if (i + 1 >= command.length) throw new Error('cURL 末尾存在不完整转义');
      current += command[++i]; started = true;
    } else if (/\s/.test(c)) {
      if (started) { tokens.push(current); current = ''; started = false; }
    } else { current += c; started = true; }
  }
  if (quote) throw new Error('cURL 引号没有闭合');
  if (started) tokens.push(current);
  return tokens;
}
const kv = (key: string, value: string): HttpKeyValueItem => ({ key, value, enabled: true });
export function parseCurlCommand(rawInput: string): Partial<HttpRequestPayload> {
  const tokens = tokenize(rawInput.replace(/(?:\\|\^|`)\r?\n/g, ' ').trim());
  if (!/^curl(?:\.exe)?$/i.test(tokens[0] || '')) throw new Error('必须以 curl 或 curl.exe 开头');
  let method = '', url = '', ignore_ssl = false, timeout_seconds: number | undefined;
  const headers: HttpKeyValueItem[] = [], form_data: HttpKeyValueItem[] = [], bodies: string[] = [];
  let get = false, suppressContentType = false;
  const value = (i: number) => { if (i >= tokens.length) throw new Error('cURL 选项缺少参数'); return tokens[i]; };
  for (let i = 1; i < tokens.length; i++) {
    let token = tokens[i];
    if (token.startsWith('--') && token.includes('=')) {
      const index = token.indexOf('='); tokens.splice(i + 1, 0, token.slice(index + 1)); token = token.slice(0, index);
    }
    if (token === '-X' || token === '--request') method = value(++i).toUpperCase();
    else if (token === '-H' || token === '--header') {
      const h = value(++i), colon = h.indexOf(':');
      if (colon < 1) throw new Error('请求头格式应为 Name: Value');
      const name = h.slice(0, colon).trim(), content = h.slice(colon + 1).trim();
      if (name.toLowerCase() === 'content-type' && !content) suppressContentType = true;
      else headers.push(kv(name, content));
    } else if (token === '-b' || token === '--cookie') {
      const cookie = value(++i);
      if (!cookie.includes('=')) throw new Error('暂不支持 Cookie 文件，请提供 name=value');
      headers.push(kv('Cookie', cookie));
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(token)) {
      let content = value(++i);
      if (token !== '--data-raw' && content.startsWith('@')) throw new Error('暂不支持从文件读取请求体');
      if (token === '--data-urlencode') {
        const eq = content.indexOf('=');
        if (eq < 1) throw new Error('--data-urlencode 需要 name=value');
        content = new URLSearchParams([[content.slice(0, eq), content.slice(eq + 1)]]).toString();
      }
      bodies.push(content);
    } else if (['-F', '--form', '--form-string'].includes(token)) {
      const field = value(++i), eq = field.indexOf('=');
      if (eq < 1) throw new Error('form-data 需要 name=value');
      const content = field.slice(eq + 1);
      if (token !== '--form-string' && /^[@<]/.test(content)) throw new Error('当前 form-data 仅支持文本，暂不支持文件上传');
      if (token !== '--form-string' && content.includes(';')) throw new Error('暂不支持 -F 字段属性，请使用 --form-string 传入文本');
      form_data.push(kv(field.slice(0, eq), content));
    } else if (token === '--url') url = value(++i);
    else if (token === '-k' || token === '--insecure') ignore_ssl = true;
    else if (token === '-I' || token === '--head') method = 'HEAD';
    else if (token === '-G' || token === '--get') get = true;
    else if (token === '-m' || token === '--max-time') {
      timeout_seconds = Number(value(++i));
      if (!Number.isInteger(timeout_seconds) || timeout_seconds <= 0) throw new Error('超时秒数应为正整数');
    } else if (['--compressed', '-L', '--location', '-s', '--silent', '-S', '--show-error'].includes(token)) { /* No payload changes. */ }
    else if (token.startsWith('-')) throw new Error(`暂不支持 cURL 选项：${token}`);
    else if (!url) url = token;
    else throw new Error('仅支持导入单个 URL');
  }
  if (!url) throw new Error('缺少请求 URL');
  if (form_data.length && bodies.length) throw new Error('不能同时使用 form-data 和普通请求体');
  const body_content = bodies.join('&');
  const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
  let body_type = form_data.length ? 'form-data' : bodies.length ? 'raw' : 'none';
  if (bodies.length) {
    if (contentType.includes('application/json')) body_type = 'json';
    else if (contentType.includes('application/x-www-form-urlencoded') || (!contentType && !suppressContentType)) body_type = 'x-www-form-urlencoded';
  }
  if (get) {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
    new URLSearchParams(body_content).forEach((v, k) => parsed.searchParams.append(k, v));
    url = parsed.toString(); body_type = 'none';
  }
  return { method: method || (get ? 'GET' : bodies.length || form_data.length ? 'POST' : 'GET'), url, headers, cookies: [], params: undefined, body_type, body_content: get ? '' : body_content,
    form_data: body_type === 'x-www-form-urlencoded' ? [...new URLSearchParams(body_content)].map(([k, v]) => kv(k, v)) : form_data, ignore_ssl, timeout_seconds };
}

// POSIX quoting works in bash / Git Bash / WSL. Never execute imported cURL.
export function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }
export function generateCurlCommand(req: HttpRequestPayload): string {
  const parts = ['curl', '-X', shellQuote(req.method.toUpperCase())];
  const url = new URL(/^https?:\/\//i.test(req.url.trim()) ? req.url.trim() : `http://${req.url.trim()}`);
  for (const p of req.params || []) if (p.enabled && p.key.trim()) url.searchParams.append(p.key.trim(), p.value);
  parts.push('--url', shellQuote(url.toString()));
  if (req.ignore_ssl) parts.push('--insecure');
  if (req.timeout_seconds) parts.push('--max-time', String(req.timeout_seconds));
  const headers = (req.headers || []).filter(h => h.enabled && h.key.trim());
  for (const h of headers) parts.push('--header', shellQuote(`${h.key.trim()}: ${h.value}`));
  const cookies = (req.cookies || []).filter(c => c.enabled && c.key.trim());
  if (cookies.length) parts.push('--cookie', shellQuote(cookies.map(c => `${c.key.trim()}=${c.value}`).join('; ')));
  if (req.body_type === 'form-data') {
    for (const f of req.form_data || []) if (f.enabled && f.key.trim()) parts.push('--form-string', shellQuote(`${f.key.trim()}=${f.value}`));
  } else if (req.body_type === 'x-www-form-urlencoded') {
    if (!headers.some(h => h.key.trim().toLowerCase() === 'content-type')) parts.push('--header', shellQuote('Content-Type: application/x-www-form-urlencoded'));
    const body = req.form_data ? new URLSearchParams(req.form_data.filter(f => f.enabled && f.key.trim()).map(f => [f.key.trim(), f.value])).toString() : req.body_content || '';
    parts.push('--data-raw', shellQuote(body));
  } else if (req.body_type === 'json' || req.body_type === 'raw') {
    if (req.body_type === 'json' && !headers.some(h => h.key.trim().toLowerCase() === 'content-type')) parts.push('--header', shellQuote('Content-Type: application/json; charset=utf-8'));
    if (req.body_type === 'raw' && !headers.some(h => h.key.trim().toLowerCase() === 'content-type')) parts.push('--header', shellQuote('Content-Type:'));
    parts.push('--data-raw', shellQuote(req.body_content || ''));
  }
  return parts.join(' \\\n  ');
}
