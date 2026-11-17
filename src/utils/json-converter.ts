/**
 * JSON 转换工具核心函数库
 */

export interface JavaBeanOptions {
  className?: string;
  useLombok?: boolean;
  useJackson?: boolean;
  useCamelCase?: boolean;
  packagePath?: string;
}

/**
 * 格式化/美化 JSON
 */
export function formatJson(jsonStr: string, indent: number = 2): string {
  const parsed = JSON.parse(jsonStr);
  return JSON.stringify(parsed, null, indent);
}

/**
 * 压缩 JSON
 */
export function minifyJson(jsonStr: string): string {
  const parsed = JSON.parse(jsonStr);
  return JSON.stringify(parsed);
}

/**
 * 转义字符串（加反斜杠，适合将 JSON 嵌入字符串/Java/代码中）
 */
export function escapeJsonString(jsonStr: string): string {
  return JSON.stringify(jsonStr);
}

/**
 * 去转义字符串（移除外层转义反斜杠）
 */
export function unescapeJsonString(str: string): string {
  const trimmed = str.trim();
  // 如果带有首尾引号，尝试当作 JSON string 反解析
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // ignore
    }
  }
  return trimmed
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * 中文转 Unicode (\u4e2d\u6587)
 */
export function toUnicode(str: string): string {
  return str.replace(/[\u007F-\uFFFF]/g, (ch) => {
    return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

/**
 * Unicode 解码为正常文本
 */
export function fromUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * 下划线/连字符转驼峰
 */
function toCamelCase(str: string): string {
  return str
    .replace(/[-_]([a-z0-9])/gi, (_, letter) => letter.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/**
 * 首字母大写（PascalCase）
 */
function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * JSON 转 Java Bean (POJO)
 */
export function jsonToJavaBean(jsonStr: string, options: JavaBeanOptions = {}): string {
  const className = options.className?.trim() || 'RootModel';
  const useLombok = options.useLombok ?? true;
  const useJackson = options.useJackson ?? true;
  const useCamelCase = options.useCamelCase ?? true;

  const parsed = JSON.parse(jsonStr);
  const classDefs: Map<string, string> = new Map();

  function inferJavaType(val: any, fieldName: string): string {
    if (val === null || val === undefined) return 'Object';
    if (typeof val === 'boolean') return 'Boolean';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? (val > 2147483647 || val < -2147483648 ? 'Long' : 'Integer') : 'Double';
    }
    if (typeof val === 'string') {
      return 'String';
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return 'List<Object>';
      const innerType = inferJavaType(val[0], fieldName + 'Item');
      return `List<${innerType}>`;
    }
    if (typeof val === 'object') {
      const nestedClassName = toPascalCase(fieldName);
      generateClass(nestedClassName, val);
      return nestedClassName;
    }
    return 'Object';
  }

  function generateClass(name: string, obj: any) {
    if (classDefs.has(name)) return;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
    classDefs.set(name, '');

    const fields: string[] = [];
    const gettersSetters: string[] = [];

    const keys = Object.keys(obj);
    for (const key of keys) {
      const val = obj[key];
      const javaType = inferJavaType(val, key);
      const fieldProp = useCamelCase ? toCamelCase(key) : key;
      const capitalizedProp = fieldProp.charAt(0).toUpperCase() + fieldProp.slice(1);

      let fieldStr = '';
      if (useJackson && fieldProp !== key) {
        fieldStr += `    @JsonProperty("${key}")\n`;
      }
      fieldStr += `    private ${javaType} ${fieldProp};`;
      fields.push(fieldStr);

      if (!useLombok) {
        gettersSetters.push(`    public ${javaType} get${capitalizedProp}() {\n        return this.${fieldProp};\n    }`);
        gettersSetters.push(`    public void set${capitalizedProp}(${javaType} ${fieldProp}) {\n        this.${fieldProp} = ${fieldProp};\n    }`);
      }
    }

    let classCode = '';
    if (useLombok) {
      classCode += `@Data\n`;
    }
    classCode += `public class ${name} {\n`;
    classCode += fields.join('\n\n') + '\n';
    if (gettersSetters.length > 0) {
      classCode += '\n' + gettersSetters.join('\n\n') + '\n';
    }
    classCode += `}`;

    classDefs.set(name, classCode);
  }

  const rootData = Array.isArray(parsed) ? (parsed.length > 0 ? parsed[0] : {}) : parsed;
  generateClass(className, rootData);

  const headerImports = [
    useLombok ? 'import lombok.Data;' : null,
    useJackson ? 'import com.fasterxml.jackson.annotation.JsonProperty;' : null,
    'import java.util.List;',
    'import java.io.Serializable;',
  ]
    .filter(Boolean)
    .join('\n');

  const classesText = Array.from(classDefs.values()).join('\n\n');
  return `${headerImports}\n\n${classesText}`;
}

/** 从 Java Bean 字段声明生成 JSON 示例。源码不含运行时字段值。 */
export function javaBeanToJson(source: string): string {
  const classes = new Map<string, { type: string; name: string; jsonName: string }[]>();
  const classPattern = /\bclass\s+([A-Za-z_$][\w$]*)\b[^{}]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = classPattern.exec(source))) {
    const start = classPattern.lastIndex;
    let depth = 1;
    let end = start;
    for (; end < source.length && depth; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
    }
    if (depth) throw new Error('Java Bean 类的大括号不完整');
    const body = source.slice(start, end - 1).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const fields: { type: string; name: string; jsonName: string }[] = [];
    const fieldPattern = /(?:@JsonProperty\s*\(\s*"([^"\n]+)"\s*\)\s*)?(?:private|protected|public)\s+(?!static\b)(?:(?:final|transient)\s+)*([\w$.?<> ,]+?)\s+([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/g;
    let field: RegExpExecArray | null;
    while ((field = fieldPattern.exec(body))) {
      fields.push({ type: field[2].trim(), name: field[3], jsonName: field[1] || field[3] });
    }
    classes.set(match[1], fields);
    classPattern.lastIndex = end;
  }
  const root = classes.keys().next().value;
  if (!root) throw new Error('未找到 Java Bean 类声明');
  function example(type: string, visited: Set<string>): unknown {
    const clean = type.replace(/^java\.lang\./, '').trim();
    const list = clean.match(/^(?:List|Set|Collection|ArrayList|LinkedList)<(.+)>$/);
    if (list) return [example(list[1].trim(), visited)];
    if (clean.endsWith('[]')) return [example(clean.slice(0, -2), visited)];
    if (/^(?:String|CharSequence|char|Character|UUID|LocalDate|LocalDateTime|Date)$/.test(clean)) return '';
    if (/^(?:boolean|Boolean)$/.test(clean)) return false;
    if (/^(?:byte|short|int|long|float|double|Byte|Short|Integer|Long|Float|Double|BigDecimal|BigInteger)$/.test(clean)) return 0;
    if (classes.has(clean)) {
      if (visited.has(clean)) return null;
      const next = new Set(visited).add(clean);
      return Object.fromEntries(classes.get(clean)!.map(field => [field.jsonName, example(field.type, next)]));
    }
    return null;
  }
  return JSON.stringify(example(root, new Set()), null, 2);
}

/**
 * 简易高效的 JSON 转 YAML 递归转换器（无需重量级依赖）
 */
export function jsonToYaml(jsonStr: string): string {
  const parsed = JSON.parse(jsonStr);

  function stringifyYaml(value: any, depth: number = 0): string {
    const indent = '  '.repeat(depth);
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'string') {
      if (value.includes('\n') || /[:#\-\?\{\}\[\],&*!|>'"%@`]/.test(value) || value.trim() === '') {
        return JSON.stringify(value);
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return value
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            const nested = stringifyYaml(item, depth + 1).trim();
            // 首行配合 -
            const lines = nested.split('\n');
            return `${indent}- ${lines[0]}\n` + lines.slice(1).map(l => `${indent}  ${l.trimStart()}`).join('\n');
          }
          return `${indent}- ${stringifyYaml(item, depth + 1)}`;
        })
        .join('\n');
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';
      return keys
        .map((k) => {
          const v = value[k];
          if (typeof v === 'object' && v !== null && Object.keys(v).length > 0) {
            return `${indent}${k}:\n${stringifyYaml(v, depth + 1)}`;
          }
          return `${indent}${k}: ${stringifyYaml(v, depth + 1)}`;
        })
        .join('\n');
    }
    return String(value);
  }

  return stringifyYaml(parsed);
}

/**
 * 简易 YAML 解析为 JSON
 */
export function yamlToJson(yamlStr: string): string {
  // 简易 YAML 行解析器处理常见场景
  const lines = yamlStr.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  // 若是简单纯 json
  try {
    return JSON.stringify(JSON.parse(yamlStr), null, 2);
  } catch {
    // 逐行简单缩进解析
  }

  // 基础兜底解析
  const root: any = {};
  const stack: { indent: number; obj: any; key?: string }[] = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    const indent = rawLine.search(/\S/);
    if (indent === -1) continue;
    const line = rawLine.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1].obj;

    if (line.startsWith('- ')) {
      // 数组项
      const valStr = line.slice(2).trim();
      const parentKey = stack[stack.length - 1].key;
      if (parentKey && !Array.isArray(current[parentKey])) {
        current[parentKey] = [];
      }
      const arr = parentKey ? current[parentKey] : current;
      if (valStr.includes(':')) {
        const [k, ...rest] = valStr.split(':');
        const itemObj = { [k.trim()]: parseYamlVal(rest.join(':').trim()) };
        arr.push(itemObj);
        stack.push({ indent, obj: itemObj });
      } else {
        arr.push(parseYamlVal(valStr));
      }
    } else if (line.includes(':')) {
      const colonIdx = line.indexOf(':');
      const key = line.slice(0, colonIdx).trim();
      const valStr = line.slice(colonIdx + 1).trim();

      if (valStr === '') {
        const newObj: any = {};
        current[key] = newObj;
        stack.push({ indent, obj: current, key });
      } else {
        current[key] = parseYamlVal(valStr);
      }
    }
  }

  function parseYamlVal(v: string): any {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (!isNaN(Number(v)) && v !== '') return Number(v);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  return JSON.stringify(root, null, 2);
}

/**
 * JSON 转 XML
 */
export function jsonToXml(jsonStr: string, rootTag: string = 'root'): string {
  const parsed = JSON.parse(jsonStr);

  function toXml(obj: any, tag: string, indent: number): string {
    const prefix = '  '.repeat(indent);
    if (obj === null || obj === undefined) {
      return `${prefix}<${tag}/>`;
    }
    if (typeof obj !== 'object') {
      const escaped = String(obj)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
      return `${prefix}<${tag}>${escaped}</${tag}>`;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => toXml(item, tag.endsWith('s') ? tag.slice(0, -1) : 'item', indent)).join('\n');
    }

    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return `${prefix}<${tag}/>`;
    }
    const children = keys.map((k) => toXml(obj[k], k, indent + 1)).join('\n');
    return `${prefix}<${tag}>\n${children}\n${prefix}</${tag}>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n` + toXml(parsed, rootTag, 0);
}

/**
 * 简易 XML 转 JSON
 */
export function xmlToJson(xmlStr: string): string {
  // 使用 DOMParser 解析 XML 字符串
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML 解析错误: ' + parseError.textContent);
  }

  function nodeToJson(node: Element): any {
    const obj: any = {};
    const children = Array.from(node.children);

    if (children.length === 0) {
      const text = node.textContent?.trim() ?? '';
      if (text === 'true') return true;
      if (text === 'false') return false;
      if (text === 'null') return null;
      if (!isNaN(Number(text)) && text !== '') return Number(text);
      return text;
    }

    for (const child of children) {
      const tagName = child.tagName;
      const childVal = nodeToJson(child);
      if (tagName in obj) {
        if (!Array.isArray(obj[tagName])) {
          obj[tagName] = [obj[tagName]];
        }
        obj[tagName].push(childVal);
      } else {
        obj[tagName] = childVal;
      }
    }
    return obj;
  }

  const rootElement = xmlDoc.documentElement;
  const result = { [rootElement.tagName]: nodeToJson(rootElement) };
  return JSON.stringify(result, null, 2);
}

/**
 * JSON 转 CSV（支持对象数组或一维/多维嵌套平铺）
 */
export function jsonToCsv(jsonStr: string): string {
  const parsed = JSON.parse(jsonStr);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) return '';

  // 收集所有列头
  const headersSet = new Set<string>();
  for (const item of items) {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach((k) => headersSet.add(k));
    }
  }
  const headers = Array.from(headersSet);
  if (headers.length === 0) return '';

  function escapeCsvCell(val: any): string {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = [headers.map(escapeCsvCell).join(',')];
  for (const item of items) {
    const row = headers.map((h) => escapeCsvCell(item ? item[h] : ''));
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

/**
 * CSV 转 JSON
 */
export function csvToJson(csvStr: string): string {
  const lines = csvStr.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return '[]';

  function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const result: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const obj: any = {};
    for (let j = 0; j < headers.length; j++) {
      const raw = cols[j]?.trim() ?? '';
      if (raw === 'true') obj[headers[j]] = true;
      else if (raw === 'false') obj[headers[j]] = false;
      else if (raw === 'null') obj[headers[j]] = null;
      else if (!isNaN(Number(raw)) && raw !== '') obj[headers[j]] = Number(raw);
      else {
        try {
          if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
            obj[headers[j]] = JSON.parse(raw);
          } else {
            obj[headers[j]] = raw;
          }
        } catch {
          obj[headers[j]] = raw;
        }
      }
    }
    result.push(obj);
  }

  return JSON.stringify(result, null, 2);
}
