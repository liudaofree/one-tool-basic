import type { JsonNode } from './json-response';
import type { BusinessField } from './field-mapping';

export interface EntityMappingResult {
  fields: BusinessField[];
  ambiguous: string[];
  unmatched: string[];
}

interface EntityField { name: string; type: string; label?: string }

function annotationText(block: string): string | undefined {
  for (const pattern of [
    /@JsonProperty\s*\(\s*"([^"]+)"\s*\)/,
    /@JSONField\s*\(\s*name\s*=\s*"([^"]+)"/,
  ]) {
    const match = block.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function chineseLabel(block: string): string | undefined {
  for (const pattern of [
    /@Schema\s*\([^)]*?(?:description|title)\s*=\s*"([^"]+)"/s,
    /@ApiModelProperty\s*\([^)]*?(?:value\s*=\s*)?"([^"]+)"/s,
  ]) {
    const match = block.match(pattern);
    if (match?.[1] && /[\u3400-\u9fff]/.test(match[1])) return match[1].trim();
  }
  const comment = block.match(/\/\*\*?([\s\S]*?)\*\/\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*$/);
  if (comment) {
    const text = comment[1].replace(/^\s*\*\s?/gm, '').split(/@\w+/)[0].trim();
    if (/[\u3400-\u9fff]/.test(text)) return text.replace(/\s+/g, ' ');
  }
  const line = block.match(/\/\/\s*([^\r\n]+)\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*$/);
  if (line && /[\u3400-\u9fff]/.test(line[1])) return line[1].trim();
  return undefined;
}

export function generateBusinessFieldsFromJava(sources: string[], root: JsonNode): EntityMappingResult {
  const classes = new Map<string, EntityField[]>();
  const labels = new Map<string, Set<string>>();
  for (const source of sources) {
    const classPattern = /\bclass\s+([A-Za-z_$][\w$]*)\b[^{}]*\{/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classPattern.exec(source))) {
      const start = classPattern.lastIndex;
      let depth = 1;
      let end = start;
      for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
      }
      if (depth) continue;
      const body = source.slice(start, end - 1);
      const fields: EntityField[] = [];
      const fieldPattern = /((?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|@[\w.]+(?:\([^)]*\))?)\s*)*)(?:private|protected|public)\s+(?!static\b)(?:(?:final|transient)\s+)*([\w$.?<>\[\], ]+?)\s+([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/g;
      let match: RegExpExecArray | null;
      while ((match = fieldPattern.exec(body))) {
        let nesting = 0;
        for (const char of body.slice(0, match.index)) {
          if (char === '{') nesting++;
          else if (char === '}') nesting--;
        }
        if (nesting !== 0) continue;
        const name = annotationText(match[1]) || match[3];
        const label = chineseLabel(match[1]);
        fields.push({ name, type: match[2].trim(), label });
        if (label) {
          if (!labels.has(name)) labels.set(name, new Set());
          labels.get(name)!.add(label);
        }
      }
      classes.set(classMatch[1], fields);
      classPattern.lastIndex = start;
    }
  }
  const fields: BusinessField[] = [];
  const ambiguous = new Set<string>();
  const matched = new Set<string>();
  function classForShape(node: JsonNode): string | undefined {
    if (node.kind !== 'object') return undefined;
    const keys = new Set(node.children.map(child => JSON.parse(child.label) as string));
    let best: string | undefined;
    let bestScore = 0;
    let tied = false;
    for (const [name, classFields] of classes) {
      const score = classFields.filter(field => keys.has(field.name)).length;
      if (score > bestScore) { best = name; bestScore = score; tied = false; }
      else if (score > 0 && score === bestScore) tied = true;
    }
    return tied ? undefined : best;
  }
  function childClass(type?: string): string | undefined {
    if (!type) return undefined;
    const generic = type.match(/<(?:\?\s+extends\s+)?([\w$.]+)\s*>/);
    const name = (generic?.[1] || type.replace(/\[\]$/, '')).split('.').pop()!;
    return classes.has(name) ? name : undefined;
  }
  function visit(node: JsonNode, path: string, expectedClass?: string) {
    const entity = classes.get(expectedClass || '') || classes.get(classForShape(node) || '');
    for (const child of node.children) {
      const key = node.kind === 'array' ? child.label : JSON.parse(child.label) as string;
      const next = node.kind === 'array' ? `${path}[]` : `${path}${/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`}`;
      if (node.kind === 'object') {
        const exact = entity?.find(field => field.name === key);
        const options = exact?.label ? new Set([exact.label]) : labels.get(key);
        if (options?.size === 1) {
          if (!fields.some(field => field.path === next)) fields.push({ path: next, label: [...options][0] });
          matched.add(key);
        } else if (options && options.size > 1) ambiguous.add(next);
        visit(child.node, next, childClass(exact?.type));
      } else {
        visit(child.node, next, expectedClass);
      }
    }
  }
  visit(root, '$');
  return { fields, ambiguous: [...ambiguous], unmatched: [...labels.keys()].filter(key => !matched.has(key)) };
}
