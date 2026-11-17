export interface Column { name: string; type: string; comment: string; primary: boolean; autoIncrement: boolean }
export interface Table { name: string; comment: string; columns: Column[] }
export const FILE_TYPES = ['entity', 'controller', 'service', 'impl', 'mapper', 'xml'] as const;
export type FileType = typeof FILE_TYPES[number];
export interface GeneratorOptions { basePackage: string; entityPackage: string; author: string; prefix: string; className: string; files: FileType[] }
export interface GeneratedFile { path: string; content: string }

// Split only outside quoted strings, comments and nested parentheses.
function splitSql(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { if (text[i + 1] === quote) i++; else quote = ''; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === delimiter && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

function stripComments(sql: string): string {
  return sql.replace(/('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|`(?:``|[^`])*`)|\/\*[\s\S]*?\*\/|--(?=\s|$)[^\r\n]*|#[^\r\n]*/g, (_match, quoted) => quoted ?? ' ');
}
function commentOf(sql: string): string {
  const value = /\bCOMMENT\s*(?:=\s*)?('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*")/i.exec(sql)?.[1];
  return value ? value.slice(1, -1).replace(/''/g, "'").replace(/""/g, '"').replace(/\\(.)/g, '$1') : '';
}
export function parseMysqlDdl(input: string): Table[] {
  const tables: Table[] = [];
  for (const statement of splitSql(stripComments(input), ';')) {
    if (!statement.trim()) continue;
    const head = /^\s*CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`[^`]+`|[\w$]+)(?:\s*\.\s*(?:`[^`]+`|[\w$]+))?)\s*\(/i.exec(statement);
    if (!head) throw new Error('仅支持 CREATE TABLE 建表语句，请移除其他 SQL。');
    const open = head[0].length - 1;
    let end = -1, depth = 1, quote = '';
    for (let i = open + 1; i < statement.length; i++) {
      const c = statement[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) { if (statement[i + 1] === quote) i++; else quote = ''; }
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) { end = i; break; }
    }
    if (end < 0) throw new Error('建表语句括号或引号不完整。');
    const definitions = splitSql(statement.slice(open + 1, end), ',');
    const columns: Column[] = [];
    const primaryNames: string[] = [];
    for (const raw of definitions) {
      const def = raw.trim();
      if (/^(?:CONSTRAINT\s+(?:`[^`]+`|\w+)\s+)?PRIMARY\s+KEY/i.test(def)) {
        const keys = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(def)?.[1] ?? '';
        primaryNames.push(...keys.split(',').map(k => k.trim().replace(/`/g, '')));
        continue;
      }
      if (/^(?:UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL)\b/i.test(def)) continue;
      const col = /^(`[^`]+`|[\w$]+)\s+([a-z]+(?:\s*\([^)]*\))?)([\s\S]*)$/i.exec(def);
      if (!col) throw new Error(`无法解析字段定义：${def}`);
      columns.push({ name: col[1].replace(/`/g, ''), type: col[2] + (/^\s*unsigned\b/i.test(col[3]) ? ' unsigned' : ''), comment: commentOf(col[3]), primary: /\bPRIMARY\s+KEY\b/i.test(col[3]), autoIncrement: /\bAUTO_INCREMENT\b/i.test(col[3]) });
    }
    columns.forEach(c => { c.primary ||= primaryNames.includes(c.name); });
    if (!columns.length) throw new Error('表中没有可生成的字段。');
    if (columns.filter(c => c.primary).length > 1) throw new Error('当前不支持联合主键，请使用单列主键的表。');
    const name = head[1].split('.').at(-1)!.trim().replace(/`/g, '');
    if (tables.some(t => t.name === name)) throw new Error(`表名重复：${name}`);
    tables.push({ name, comment: commentOf(statement.slice(end + 1)), columns });
  }
  if (!tables.length) throw new Error('请先输入 MySQL CREATE TABLE 语句。');
  return tables;
}

const keywords = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _ record sealed permits var yield'.split(' '));
function identifier(value: string): boolean { return /^[A-Za-z_$][\w$]*$/.test(value) && !keywords.has(value); }
export function camel(value: string): string { return value.replace(/[_-]+(.)/g, (_, c: string) => c.toUpperCase()); }
export function defaultClassName(table: string, prefix: string): string {
  const value = camel(prefix && table.startsWith(prefix) ? table.slice(prefix.length) : table);
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function javaType(type: string): string {
  const base = type.match(/^[a-z]+/i)?.[0].toLowerCase();
  const unsigned = /\bunsigned\b/i.test(type);
  if (base === 'bigint') return unsigned ? 'BigInteger' : 'Long';
  if (base === 'int' || base === 'integer') return unsigned ? 'Long' : 'Integer';
  if (['tinyint', 'smallint', 'mediumint', 'year'].includes(base ?? '')) return 'Integer';
  if (['decimal', 'numeric', 'dec', 'fixed'].includes(base ?? '')) return 'BigDecimal';
  if (base === 'float') return 'Float';
  if (base === 'double' || base === 'real') return 'Double';
  if (base === 'boolean' || base === 'bool' || /^bit\s*\(\s*1\s*\)/i.test(type)) return 'Boolean';
  if (base === 'date') return 'LocalDate';
  if (base === 'datetime' || base === 'timestamp') return 'LocalDateTime';
  if (base === 'time') return 'LocalTime';
  if (['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'bit'].includes(base ?? '')) return 'byte[]';
  if (['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set', 'json'].includes(base ?? '')) return 'String';
  throw new Error(`暂不支持 MySQL 类型：${type}`);
}
function safeComment(value: string): string { return value.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' '); }
function literal(value: string): string { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ''); }
export function generateCode(table: Table, options: GeneratorOptions): GeneratedFile[] {
  const pkg = options.basePackage.trim().replace(/\.+$/, '');
  const ep = options.entityPackage.trim().replace(/\.+$/, '');
  for (const p of [pkg, ep]) if (!p || !p.split('.').every(identifier)) throw new Error('请输入合法的 Java 包名。');
  const name = options.className.trim() || defaultClassName(table.name, options.prefix);
  if (!identifier(name)) throw new Error('请输入合法的 Java 类名。');
  const fields = table.columns.map(c => ({ ...c, field: camel(c.name), java: javaType(c.type) }));
  const seen = new Set<string>();
  for (const c of fields) {
    if (!identifier(c.field) || c.field === 'serialVersionUID') throw new Error(`字段 ${c.name} 无法转换为合法 Java 属性名。`);
    if (seen.has(c.field)) throw new Error(`转换后属性名重复：${c.field}`);
    seen.add(c.field);
  }
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const doc = (suffix: string) => `/**\n * <p>\n * ${safeComment(table.comment || table.name)}${suffix}\n * </p>\n *\n * @author ${safeComment(options.author)}\n * @since ${today}\n */`;
  const files: Record<FileType, GeneratedFile> = {} as Record<FileType, GeneratedFile>;
  const put = (kind: FileType, pack: string, className: string, imports: string[], body: string, suffix: string) => {
    files[kind] = { path: `src/main/java/${pack.replace(/\./g, '/')}/${className}.java`, content: `package ${pack};\n\n${[...new Set(imports)].sort().map(i => `import ${i};`).join('\n')}\n\n${doc(suffix)}\n${body}\n` };
  };
  const imports = ['java.io.Serializable', 'lombok.Getter', 'lombok.Setter', 'com.baomidou.mybatisplus.annotation.TableName'];
  const typeImports: Record<string, string> = { BigDecimal: 'java.math.BigDecimal', BigInteger: 'java.math.BigInteger', LocalDate: 'java.time.LocalDate', LocalTime: 'java.time.LocalTime', LocalDateTime: 'java.time.LocalDateTime' };
  const properties = fields.map(c => {
    if (typeImports[c.java]) imports.push(typeImports[c.java]);
    let annotation: string;
    if (c.primary) {
      imports.push('com.baomidou.mybatisplus.annotation.TableId');
      if (c.autoIncrement) imports.push('com.baomidou.mybatisplus.annotation.IdType');
      annotation = `    @TableId(value = "${literal(c.name)}"${c.autoIncrement ? ', type = IdType.AUTO' : ''})\n`;
    } else {
      imports.push('com.baomidou.mybatisplus.annotation.TableField');
      annotation = `    @TableField("${literal(c.name)}")\n`;
    }
    return `${c.comment ? `    /**\n     * ${safeComment(c.comment)}\n     */\n` : ''}${annotation}    private ${c.java} ${c.field};`;
  }).join('\n\n');
  put('entity', ep, name, imports, `@Getter\n@Setter\n@TableName("${literal(table.name)}")\npublic class ${name} implements Serializable {\n\n    private static final long serialVersionUID = 1L;\n\n${properties}\n\n}`, '');
  put('controller', `${pkg}.controller`, `${name}Controller`, ['org.springframework.stereotype.Controller', 'org.springframework.web.bind.annotation.RequestMapping'], `@Controller\n@RequestMapping("/${name.charAt(0).toLowerCase() + name.slice(1)}")\npublic class ${name}Controller {\n\n}`, ' 前端控制器');
  put('service', `${pkg}.service`, `${name}Service`, [`${ep}.${name}`, 'com.baomidou.mybatisplus.extension.service.IService'], `public interface ${name}Service extends IService<${name}> {\n\n}`, ' 服务类');
  put('impl', `${pkg}.service.impl`, `${name}ServiceImpl`, [`${ep}.${name}`, `${pkg}.mapper.${name}Mapper`, `${pkg}.service.${name}Service`, 'com.baomidou.mybatisplus.extension.service.impl.ServiceImpl', 'org.springframework.stereotype.Service'], `@Service\npublic class ${name}ServiceImpl extends ServiceImpl<${name}Mapper, ${name}> implements ${name}Service {\n\n}`, ' 服务实现类');
  put('mapper', `${pkg}.mapper`, `${name}Mapper`, [`${ep}.${name}`, 'com.baomidou.mybatisplus.core.mapper.BaseMapper', 'org.apache.ibatis.annotations.Mapper'], `@Mapper\npublic interface ${name}Mapper extends BaseMapper<${name}> {\n\n}`, ' Mapper 接口');
  files.xml = { path: `src/main/resources/mapper/${name}Mapper.xml`, content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n<mapper namespace="${pkg}.mapper.${name}Mapper">\n\n</mapper>\n` };
  if (!options.files.length) throw new Error('请至少选择一种生成文件。');
  return options.files.map(kind => files[kind]);
}
