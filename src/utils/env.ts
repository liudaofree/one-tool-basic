import type { HttpRequestPayload, HttpKeyValueItem } from '../types/http';

export function interpolateString(template: string, vars: Record<string, string>): string {
  if (!template || !vars || Object.keys(vars).length === 0) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

export function applyEnvironmentVariables(
  req: HttpRequestPayload,
  vars: Record<string, string>
): HttpRequestPayload {
  if (!vars || Object.keys(vars).length === 0) return req;

  const replaceKv = (items?: HttpKeyValueItem[]) => {
    if (!items) return undefined;
    return items.map((item) => ({
      key: interpolateString(item.key, vars),
      value: interpolateString(item.value, vars),
      enabled: item.enabled,
    }));
  };

  return {
    ...req,
    url: interpolateString(req.url, vars),
    headers: replaceKv(req.headers),
    params: replaceKv(req.params),
    cookies: replaceKv(req.cookies),
    body_content: req.body_content ? interpolateString(req.body_content, vars) : undefined,
    form_data: replaceKv(req.form_data),
  };
}
