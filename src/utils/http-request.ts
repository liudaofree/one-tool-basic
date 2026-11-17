import type { CookieItem, HttpRequestPayload, HttpKeyValueItem } from '../types/http';
import { applyEnvironmentVariables } from './env';
import { mergeCookies, normalizeUrl } from './http-cookies';

export function prepareHttpRequest(raw: HttpRequestPayload, variables: Record<string, string>, jar: (url: string) => CookieItem[]): HttpRequestPayload {
  const request = applyEnvironmentVariables(structuredClone(raw), variables);
  request.url = normalizeUrl(request.url).toString();
  request.method = request.method.toUpperCase();
  let headers = (request.headers || []).filter(h => h.enabled && h.key.trim()).map(h => ({ ...h, key: h.key.trim() }));
  for (const h of headers) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(h.key)) throw new Error(`请求头名称不合法：${h.key}`);
    if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(h.value)) throw new Error(`请求头 ${h.key} 含非法控制字符`);
  }
  const cookies = mergeCookies(jar(request.url), headers, request.cookies || []);
  headers = headers.filter(h => h.key.toLowerCase() !== 'cookie');
  if (cookies.length) headers.push({ key: 'Cookie', value: cookies.map(c => `${c.key}=${c.value}`).join('; '), enabled: true });
  if (request.body_type === 'form-data') headers = headers.filter(h => h.key.toLowerCase() !== 'content-type');
  if (!headers.some(h => h.key.toLowerCase() === 'content-type')) {
    const types: Record<string, string> = { json: 'application/json; charset=utf-8', 'x-www-form-urlencoded': 'application/x-www-form-urlencoded' };
    if (types[request.body_type || '']) headers.push({ key: 'Content-Type', value: types[request.body_type!], enabled: true });
  }
  return { ...request, headers, cookies: [] };
}

export function requestPreview(request: HttpRequestPayload): string {
  let body = request.body_content || '';
  if (request.body_type === 'form-data') body = '[multipart 文本字段；boundary 由发送引擎生成]\n' + (request.form_data || []).filter(f => f.enabled).map(f => `${f.key}=${f.value}`).join('\n');
  if (request.body_type === 'x-www-form-urlencoded' && request.form_data) body = new URLSearchParams(request.form_data.filter(f => f.enabled && f.key.trim()).map(f => [f.key.trim(), f.value])).toString();
  if (request.body_type === 'none') body = '';
  return `${request.method} ${request.url}\n${(request.headers || []).map(h => `${h.key}: ${h.value}`).join('\n')}\n\n${body}`;
}

export function enabledFormItems(items?: HttpKeyValueItem[]): HttpKeyValueItem[] {
  return (items || []).filter(f => f.enabled && f.key.trim());
}
