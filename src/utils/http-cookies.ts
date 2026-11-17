import type { CookieItem, HttpKeyValueItem } from '../types/http';

export function normalizeUrl(raw: string): URL {
  if (/^[a-z][\w+.-]*:\/\//i.test(raw.trim()) && !/^https?:\/\//i.test(raw.trim())) throw new Error('仅支持 HTTP / HTTPS URL');
  const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP / HTTPS URL');
  return url;
}
export function normalizeDomain(domain: string): string {
  const value = domain.trim().toLowerCase();
  if (!/^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(value)) throw new Error('请输入域名，不要包含协议、端口或路径');
  return value.replace(/^\./, '');
}
export function validateCookie(cookie: Pick<CookieItem, 'name' | 'value' | 'path' | 'expires'>): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name)) throw new Error('Cookie 名称包含非法字符');
  if (/[;\r\n\x00-\x1f\x7f]/.test(cookie.value)) throw new Error('Cookie 值不能包含分号或控制字符');
  if (cookie.path && !cookie.path.startsWith('/')) throw new Error('Cookie Path 必须以 / 开头');
  if (cookie.expires && !Number.isFinite(Date.parse(cookie.expires))) throw new Error('Cookie 有效期格式不正确');
}
function domainMatches(host: string, domain: string): boolean {
  return host === domain || (!/^[\d.]+$/.test(host) && host.endsWith(`.${domain}`));
}
export function cookiesForUrl(map: Record<string, CookieItem[]>, raw: string, now = Date.now()): CookieItem[] {
  const url = normalizeUrl(raw);
  return Object.entries(map).flatMap(([domain, cookies]) => cookies.filter(cookie => {
    const hostOnly = cookie.hostOnly ?? !domain.startsWith('.');
    const clean = domain.toLowerCase().replace(/^\./, '');
    const path = cookie.path || '/';
    const pathMatches = url.pathname === path || (url.pathname.startsWith(path) && (path.endsWith('/') || url.pathname[path.length] === '/'));
    return (hostOnly ? url.hostname === clean : domainMatches(url.hostname, clean)) && pathMatches &&
      (!cookie.secure || url.protocol === 'https:') && (!cookie.expires || Date.parse(cookie.expires) > now);
  })).sort((a, b) => (b.path || '/').length - (a.path || '/').length);
}
export function parseCookieHeader(value: string): HttpKeyValueItem[] {
  return value.split(';').filter(v => v.trim()).map(pair => {
    const index = pair.indexOf('=');
    if (index < 1) throw new Error('Cookie 格式应为 name=value');
    return { key: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim(), enabled: true };
  });
}
// Per-request cookie rows override the Cookie header, which overrides the jar.
// Preserve same-name jar cookies with distinct paths; explicit overrides replace all.
export function mergeCookies(jar: CookieItem[], headers: HttpKeyValueItem[], rows: HttpKeyValueItem[]): HttpKeyValueItem[] {
  let result = jar.map(c => ({ key: c.name, value: c.value, enabled: true }));
  for (const group of [headers.filter(h => h.enabled && h.key.trim().toLowerCase() === 'cookie').flatMap(h => parseCookieHeader(h.value)), rows.filter(c => c.enabled && c.key.trim())]) {
    const names = new Set(group.map(c => c.key.trim()));
    result = result.filter(c => !names.has(c.key));
    const unique = new Map(group.map(c => [c.key.trim(), { ...c, key: c.key.trim() }]));
    result.push(...unique.values());
  }
  result.forEach(c => validateCookie({ name: c.key, value: c.value }));
  return result;
}
export function parseSetCookie(rawUrl: string, header: string, now = Date.now()): Omit<CookieItem, 'id'> | undefined {
  const url = normalizeUrl(rawUrl);
  const [pair, ...attributes] = header.split(';');
  const index = pair.indexOf('=');
  if (index < 1) return;
  const attributesMap = new Map(attributes.map(attribute => {
    const i = attribute.indexOf('=');
    return [attribute.slice(0, i < 0 ? undefined : i).trim().toLowerCase(), i < 0 ? '' : attribute.slice(i + 1).trim()];
  }));
  const domainValue = attributesMap.get('domain');
  let domain = url.hostname;
  if (domainValue) { try { domain = normalizeDomain(domainValue); } catch { return; } }
  if (!domainMatches(url.hostname, domain)) return;
  // Reject single-label Domain broadening; this tool does not maintain a public suffix list.
  if (domain !== url.hostname && !domain.includes('.')) return;
  const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
  const attributePath = attributesMap.get('path');
  let expires: string | undefined;
  const expiryDate = Date.parse(attributesMap.get('expires') || '');
  if (Number.isFinite(expiryDate)) expires = new Date(expiryDate).toISOString();
  const maxAge = attributesMap.get('max-age');
  if (maxAge && /^-?\d+$/.test(maxAge)) {
    const seconds = Number(maxAge);
    const timestamp = seconds <= 0 ? 0 : Math.min(8640000000000000, now + seconds * 1000);
    expires = new Date(timestamp).toISOString();
  }
  const cookie = { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim(), domain, path: attributePath?.startsWith('/') ? attributePath : defaultPath, expires, hostOnly: !domainValue, secure: attributesMap.has('secure'), httpOnly: attributesMap.has('httponly') };
  try { validateCookie(cookie); return cookie; } catch { return; }
}
