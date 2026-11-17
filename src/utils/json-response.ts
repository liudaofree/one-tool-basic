export interface JsonNode {
  kind: 'object' | 'array' | 'value';
  raw: string;
  children: { label: string; node: JsonNode }[];
}

export interface JsonFieldMatch {
  path: string;
  value: string;
  kind: JsonNode['kind'];
}

export function findJsonFields(root: JsonNode, query: string): JsonFieldMatch[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const matches: JsonFieldMatch[] = [];
  function visit(node: JsonNode, path: string) {
    for (const child of node.children) {
      const key = node.kind === 'array' ? child.label : JSON.parse(child.label) as string;
      const nextPath = node.kind === 'array' ? `${path}${key}` : `${path}${/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`}`;
      if (key.toLowerCase().includes(term) || nextPath.toLowerCase() === term || nextPath.slice(2).toLowerCase() === term) {
        matches.push({ path: nextPath, value: child.node.raw, kind: child.node.kind });
      }
      visit(child.node, nextPath);
    }
  }
  visit(root, '$');
  return matches;
}

// Validate with JSON.parse, but keep source tokens for display so large numeric
// IDs, duplicate keys and numeric notation are never rewritten by JavaScript.
export function parseJsonTree(source: string): JsonNode {
  JSON.parse(source);
  const tokens = [...source.matchAll(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g)].map(m => m[0]);
  let index = 0;
  function parse(depth: number): JsonNode {
    if (depth > 150) throw new Error('JSON 层级过深，请使用原文查看');
    const first = tokens[index++];
    if (first !== '{' && first !== '[') return { kind: 'value', raw: first, children: [] };
    const kind = first === '{' ? 'object' : 'array';
    const close = kind === 'object' ? '}' : ']';
    const children: JsonNode['children'] = [];
    while (tokens[index] !== close) {
      const label = kind === 'object' ? tokens[index++] : `[${children.length}]`;
      if (kind === 'object') index++; // colon
      children.push({ label, node: parse(depth + 1) });
      if (tokens[index] === ',') index++;
    }
    index++;
    return { kind, raw: first + close, children };
  }
  return parse(0);
}

export function renderJsonTree(container: HTMLElement, root: JsonNode) {
  container.replaceChildren();
  const branches: { details: HTMLDetailsElement; populate: () => void }[] = [];
  const locations = new Map<string, { element: HTMLElement; ancestors: HTMLDetailsElement[] }>();
  function render(node: JsonNode, label: string, path: string, ancestors: HTMLDetailsElement[], isRoot = false): HTMLElement {
    if (node.kind === 'value' || !node.children.length) {
      const line = document.createElement('div'); line.className = 'json-response-value';
      line.textContent = `${label}${node.raw}`;
      locations.set(path, { element: line, ancestors });
      return line;
    }
    const details = document.createElement('details'); details.className = 'json-response-branch';
    const summary = document.createElement('summary');
    summary.textContent = `${label}${node.kind === 'object' ? '{' : '['} ${node.children.length} ${node.kind === 'object' ? '个字段' : '项'} ${node.kind === 'object' ? '}' : ']'}`;
    details.append(summary);
    locations.set(path, { element: summary, ancestors });
    let populated = false;
    function populate() {
      if (populated) return;
      populated = true;
      const children = document.createElement('div'); children.className = 'json-response-children';
      node.children.forEach(child => {
        const key = node.kind === 'array' ? child.label : JSON.parse(child.label) as string;
        const childPath = node.kind === 'array' ? `${path}${key}` : `${path}${/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`}`;
        children.append(render(child.node, child.label + (node.kind === 'object' ? ': ' : ' '), childPath, [...ancestors, details]));
      });
      details.append(children);
    }
    details.addEventListener('toggle', () => { if (details.open) populate(); });
    branches.push({ details, populate });
    if (isRoot) { populate(); details.open = true; }
    return details;
  }
  container.append(render(root, '', '$', [], true));
  return {
    expandAll() {
      // Populating a branch adds its descendants to the same queue.
      for (let i = 0; i < branches.length; i++) { branches[i].populate(); branches[i].details.open = true; }
    },
    collapseAll() { branches.forEach(branch => { branch.details.open = false; }); },
    focusPath(path: string) {
      // Lazy branches must be populated in order, from the root down.
      for (let i = 0; i < branches.length; i++) branches[i].populate();
      const location = locations.get(path);
      if (!location) return false;
      location.ancestors.forEach(ancestor => { ancestor.open = true; });
      container.querySelector('.json-response-focused')?.classList.remove('json-response-focused');
      location.element.classList.add('json-response-focused');
      location.element.scrollIntoView({ block: 'center' });
      return true;
    },
  };
}
