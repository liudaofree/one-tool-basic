import type { HttpKeyValueItem, HttpRequestPayload } from '../types/http';

// The URL field is the source of truth. Query rows are an editor for that URL,
// not a second set of parameters for the native HTTP client to append.
export function urlOnlyPayload(payload: HttpRequestPayload): HttpRequestPayload {
  const { params: _params, ...request } = payload;
  return request;
}

export function queryFromUrl(url: string): HttpKeyValueItem[] {
  const beforeHash = url.split('#', 1)[0];
  const index = beforeHash.indexOf('?');
  if (index === -1) return [];
  return [...new URLSearchParams(beforeHash.slice(index + 1))].map(([key, value]) => ({ key, value, enabled: true }));
}

export function updateUrlQuery(url: string, params: HttpKeyValueItem[]): string {
  const hashIndex = url.indexOf('#');
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const base = beforeHash.split('?', 1)[0];
  const search = new URLSearchParams();
  for (const param of params) if (param.enabled && param.key.trim()) search.append(param.key.trim(), param.value);
  const query = search.toString();
  return base + (query ? '?' + query : '') + fragment;
}
