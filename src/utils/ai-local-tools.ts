import { invoke } from '@tauri-apps/api/core';
import { formatJson, minifyJson, jsonToYaml, yamlToJson, jsonToXml, xmlToJson, jsonToCsv, csvToJson } from './json-converter';
import { parseMysqlDdl, generateCode, defaultClassName, FILE_TYPES, type FileType } from './code-generator';

export const AI_LOCAL_TOOLS = [
  { type: 'function', function: { name: 'restore_mybatis_sql', description: '调用 One Tool 本地 MyBatis SQL 日志还原功能。', parameters: { type: 'object', properties: { log: { type: 'string', description: '包含 Preparing 和 Parameters 的日志' } }, required: ['log'] } } },
  { type: 'function', function: { name: 'convert_json', description: '调用 One Tool 本地 JSON 格式化、压缩、JSON/YAML/XML/CSV 互转。', parameters: { type: 'object', properties: { text: { type: 'string' }, operation: { type: 'string', enum: ['format', 'minify', 'json_to_yaml', 'yaml_to_json', 'json_to_xml', 'xml_to_json', 'json_to_csv', 'csv_to_json'] } }, required: ['text', 'operation'] } } },
  { type: 'function', function: { name: 'inspect_mysql_ddl', description: '调用 One Tool 本地 MySQL 建表语句解析，返回表和字段概要。', parameters: { type: 'object', properties: { ddl: { type: 'string' } }, required: ['ddl'] } } },
  { type: 'function', function: { name: 'generate_mysql_code', description: '调用 One Tool 本地 MySQL/MyBatis Plus 代码生成器。只在用户要求生成代码时使用。', parameters: { type: 'object', properties: { ddl: { type: 'string' }, basePackage: { type: 'string' }, entityPackage: { type: 'string' }, author: { type: 'string' }, prefix: { type: 'string' }, files: { type: 'array', items: { type: 'string', enum: ['entity', 'controller', 'service', 'impl', 'mapper', 'xml'] } } }, required: ['ddl'] } } },
] as const;

type JsonArgs = Record<string, unknown>;
function arg(args: JsonArgs, key: string): string {
  if (typeof args[key] !== 'string') throw new Error(`缺少文本参数 ${key}`);
  return args[key];
}

export async function runAiLocalTool(name: string, args: JsonArgs): Promise<unknown> {
  switch (name) {
    case 'restore_mybatis_sql': return invoke('parse_mybatis_logs', { logText: arg(args, 'log'), options: { boolean_as_number: false } });
    case 'convert_json': {
      const text = arg(args, 'text');
      const convert: Record<string, (value: string) => string> = { format: formatJson, minify: minifyJson, json_to_yaml: jsonToYaml, yaml_to_json: yamlToJson, json_to_xml: jsonToXml, xml_to_json: xmlToJson, json_to_csv: jsonToCsv, csv_to_json: csvToJson };
      const operation = arg(args, 'operation');
      if (!convert[operation]) throw new Error('不支持的转换操作');
      return { result: convert[operation](text) };
    }
    case 'inspect_mysql_ddl': return { tables: parseMysqlDdl(arg(args, 'ddl')) };
    case 'generate_mysql_code': {
      const basePackage = typeof args.basePackage === 'string' ? args.basePackage : 'com.example';
      const entityPackage = typeof args.entityPackage === 'string' ? args.entityPackage : `${basePackage}.entity`;
      const prefix = typeof args.prefix === 'string' ? args.prefix : '';
      const requested = Array.isArray(args.files) ? args.files : [...FILE_TYPES];
      const files = requested.filter((value): value is FileType => typeof value === 'string' && FILE_TYPES.includes(value as FileType));
      if (!files.length) throw new Error('没有选中可生成的文件类型');
      const tables = parseMysqlDdl(arg(args, 'ddl'));
      return { files: tables.flatMap(table => generateCode(table, { basePackage, entityPackage, author: typeof args.author === 'string' ? args.author : '', prefix, className: defaultClassName(table.name, prefix), files })) };
    }
    default: throw new Error(`未提供本地功能 ${name}`);
  }
}
