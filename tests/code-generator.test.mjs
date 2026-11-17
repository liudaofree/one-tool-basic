import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const load = async path => {
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
};
const { parseMysqlDdl, generateCode } = await load('../src/utils/code-generator.ts');
const { createZip } = await load('../src/utils/zip.ts');
const ddl = `-- comment
CREATE TABLE IF NOT EXISTS \`db\`.\`sys_user\` (
 id bigint NOT NULL AUTO_INCREMENT,
 user_name varchar(80) COMMENT '姓名,括号());分号;与引号''测试',
 amount decimal(12,2), created_at datetime, metadata json,
 PRIMARY KEY (id), KEY idx_name (user_name)
) ENGINE=InnoDB COMMENT='用户';
CREATE TABLE audit (event_id bigint unsigned PRIMARY KEY, enabled bit(1), payload blob);`;
const options = { basePackage: 'com.example.', entityPackage: 'com.shared.entity', author: 'Example', prefix: 'sys_', className: '', files: ['entity', 'controller', 'service', 'impl', 'mapper', 'xml'] };
test('parse multiple tables, quoted delimiters, comments, primary keys and types', () => {
  const tables = parseMysqlDdl(ddl);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].name, 'sys_user');
  assert.equal(tables[0].comment, '用户');
  assert.equal(tables[0].columns.length, 5);
  assert.equal(tables[0].columns[1].comment, "姓名,括号());分号;与引号'测试");
  assert.equal(tables[0].columns[0].primary, true);
  assert.equal(tables[1].columns[0].type, 'bigint unsigned');
});
test('generate consistent six-file skeleton with independent entity package', () => {
  const files = generateCode(parseMysqlDdl(ddl)[0], options);
  assert.equal(files.length, 6);
  assert.match(files[0].path, /com\/shared\/entity\/User.java$/);
  assert.match(files[0].content, /IdType.AUTO/);
  assert.match(files[0].content, /BigDecimal amount/);
  assert.match(files[0].content, /LocalDateTime createdAt/);
  assert.match(files[0].content, /@TableField\("user_name"\)/);
  assert.match(files[3].content, /implements UserService/);
  assert.doesNotMatch(files[3].content, /IUserService/);
  assert.match(files[3].content, /import com.shared.entity.User;/);
  assert.match(files[4].content, /import org.apache.ibatis.annotations.Mapper;/);
  assert.match(files[5].content, /namespace="com.example.mapper.UserMapper"/);
  const audit = generateCode(parseMysqlDdl(ddl)[1], options)[0].content;
  assert.match(audit, /BigInteger eventId/);
  assert.match(audit, /Boolean enabled/);
  assert.match(audit, /byte\[\] payload/);
});
test('custom class, selected files and invalid input', () => {
  const table = parseMysqlDdl(ddl)[0];
  assert.equal(generateCode(table, { ...options, className: 'Account', files: ['service'] }).length, 1);
  assert.match(generateCode(table, { ...options, className: 'Account' })[0].content, /class Account/);
  assert.throws(() => parseMysqlDdl(''), /请先输入/);
  assert.throws(() => parseMysqlDdl('CREATE TABLE a (x int, y int, PRIMARY KEY(x,y));'), /联合主键/);
  assert.throws(() => parseMysqlDdl('CREATE TABLE a (x int'), /不完整/);
  assert.throws(() => generateCode(table, { ...options, entityPackage: 'bad/package' }), /包名/);
  assert.throws(() => generateCode(table, { ...options, className: 'class' }), /类名/);
  assert.throws(() => generateCode(table, { ...options, files: [] }), /至少选择/);
  assert.throws(() => generateCode(parseMysqlDdl('CREATE TABLE a (x geometry)')[0], options), /暂不支持/);
});
test('export ZIP with central directory and UTF-8 content', () => {
  const files = parseMysqlDdl(ddl).flatMap(table => generateCode(table, options));
  const zip = createZip(files);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 12);
  assert.equal(view.getUint32(view.getUint32(end + 16, true), true), 0x02014b50);
  assert.ok(new TextDecoder().decode(zip).includes('用户'));
});
