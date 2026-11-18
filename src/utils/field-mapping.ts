import type { JsonFieldMatch, JsonNode } from './json-response';

export interface BusinessField { path: string; label: string }
export interface BusinessProfile { id: string; name: string; fields: BusinessField[] }
export interface BusinessMatch extends JsonFieldMatch { label: string; fieldName: string }

export function validateBusinessProfile(value: unknown): BusinessProfile {
  if (!value || typeof value !== 'object') throw new Error('映射配置应为 JSON 对象');
  const profile = value as Partial<BusinessProfile>;
  if (typeof profile.id !== 'string' || !/^[\w-]{1,60}$/.test(profile.id) ||
      typeof profile.name !== 'string' || !profile.name.trim() || !Array.isArray(profile.fields)) {
    throw new Error('需要 id、name 和 fields 数组');
  }
  if (!profile.fields.length || profile.fields.length > 2000 || !profile.fields.every(field =>
    field && typeof field.path === 'string' && /^\$(?:\.[A-Za-z_$][\w$]*|\[\]|\[".*"\])+$/.test(field.path) &&
    typeof field.label === 'string' && field.label.trim())) {
    throw new Error('fields 每项需要有效的 path 和显示名称');
  }
  return { id: profile.id, name: profile.name.trim(), fields: profile.fields.map(field => ({ path: field.path, label: field.label.trim() })) };
}

export function resolveBusinessFields(root: JsonNode, profile: BusinessProfile, query: string): BusinessMatch[] {
  const term = query.trim().toLowerCase();
  const results: BusinessMatch[] = [];
  function visit(node: JsonNode, path: string) {
    for (const child of node.children) {
      const fieldName = node.kind === 'array' ? child.label : JSON.parse(child.label) as string;
      const next = node.kind === 'array' ? `${path}${fieldName}` : `${path}${/^[A-Za-z_$][\w$]*$/.test(fieldName) ? `.${fieldName}` : `[${JSON.stringify(fieldName)}]`}`;
      const template = next.replace(/\[\d+\]/g, '[]');
      for (const field of profile.fields) {
        if (field.path !== template) continue;
        if (!term || field.label.toLowerCase().includes(term) || fieldName.toLowerCase().includes(term) || next.toLowerCase() === term || template.toLowerCase() === term) {
          results.push({ path: next, value: child.node.raw, kind: child.node.kind, label: field.label, fieldName });
        }
      }
      visit(child.node, next);
    }
  }
  visit(root, '$');
  return results;
}
