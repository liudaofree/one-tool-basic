import { FILE_TYPES, defaultClassName, generateCode, parseMysqlDdl } from '../utils/code-generator';
import type { GeneratedFile, GeneratorOptions, Table, FileType } from '../utils/code-generator';
import { createZip } from '../utils/zip';

const SAMPLE = `CREATE TABLE \`sys_user\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  \`user_name\` varchar(64) NOT NULL COMMENT '用户名',
  \`balance\` decimal(12,2) DEFAULT NULL COMMENT '余额',
  \`create_time\` datetime DEFAULT NULL COMMENT '创建时间',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB COMMENT='用户';`;
const LABELS: Record<FileType, string> = { entity: 'Entity', controller: 'Controller', service: 'Service', impl: 'ServiceImpl', mapper: 'Mapper', xml: 'XML' };

export function initCodeGenerator(container: HTMLElement, showToast: (message: string) => void) {
  container.innerHTML = `
    <div class="code-generator">
      <div class="cg-settings">
        <label>基础包名<input data-config="basePackage" value="com.example" spellcheck="false"></label>
        <label>Entity 完整包名（独立）<input data-config="entityPackage" value="com.example.entity" spellcheck="false"></label>
        <label>作者<input data-config="author" value=""></label>
        <label>去除表名前缀<input data-config="prefix" placeholder="例如 sys_" spellcheck="false"></label>
        <label>当前表类名<input data-config="className" placeholder="解析后可修改" spellcheck="false"></label>
      </div>
      <div class="cg-toolbar">
        <div class="cg-file-types">${FILE_TYPES.map(type => `<label><input type="checkbox" value="${type}" checked> ${LABELS[type]}</label>`).join('')}</div>
        <button class="btn btn-secondary btn-sm" data-action="sample">载入示例</button>
        <button class="btn btn-primary btn-sm" data-action="generate">解析并生成</button>
        <button class="btn btn-secondary btn-sm" data-action="zip" disabled>导出 ZIP</button>
      </div>
      <p class="cg-help">MySQL · MyBatis Plus 基础骨架 · Controller 不生成接口 · Entity 包名独立保存 · 多表分别设置类名</p>
      <div class="cg-status" role="status">粘贴 CREATE TABLE 语句后点击「解析并生成」。</div>
      <div class="cg-workspace">
        <section class="cg-input"><div class="pane-header">MySQL DDL</div><textarea class="log-textarea" data-role="ddl" spellcheck="false" placeholder="支持一条或多条 CREATE TABLE 语句"></textarea></section>
        <section class="cg-output">
          <div class="cg-output-tools"><select data-role="tables" aria-label="选择表"><option>尚未解析</option></select><button class="btn btn-ghost btn-sm" data-action="copy" disabled>复制文件</button><button class="btn btn-ghost btn-sm" data-action="download" disabled>下载文件</button></div>
          <div class="cg-preview"><nav class="cg-tree" aria-label="生成文件"></nav><div class="cg-code"><div class="cg-path"></div><textarea class="log-textarea" data-role="code" readonly spellcheck="false" placeholder="生成后可选择文件预览"></textarea></div></div>
        </section>
      </div>
    </div>`;
  const query = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const config = (key: string) => query<HTMLInputElement>(`[data-config="${key}"]`);
  const ddl = query<HTMLTextAreaElement>('[data-role="ddl"]');
  const code = query<HTMLTextAreaElement>('[data-role="code"]');
  const select = query<HTMLSelectElement>('[data-role="tables"]');
  const status = query<HTMLElement>('.cg-status');
  let tables: Table[] = [], allFiles: GeneratedFile[] = [], activeFile: GeneratedFile | undefined;
  let parsedDdl = '', dirty = true;
  const classNames = new Map<string, string>();
  const storageKey = 'onetool_code_generator_config';
  const keys = ['basePackage', 'entityPackage', 'author', 'prefix'];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const key of keys) if (typeof saved[key] === 'string') config(key).value = saved[key];
  } catch { /* Defaults remain usable if browser storage is unavailable. */ }
  const button = (action: string) => query<HTMLButtonElement>(`[data-action="${action}"]`);
  function setExportEnabled(enabled: boolean) { for (const action of ['zip', 'copy', 'download']) button(action).disabled = !enabled; }
  function invalidate() {
    dirty = true; setExportEnabled(false);
    status.textContent = '配置或 DDL 已修改，请重新生成后复制或导出。';
    status.classList.remove('error');
    code.value = ''; activeFile = undefined; query('.cg-tree').replaceChildren(); query('.cg-path').textContent = '';
  }
  function options(table: Table): GeneratorOptions {
    return {
      basePackage: config('basePackage').value, entityPackage: config('entityPackage').value,
      author: config('author').value, prefix: config('prefix').value,
      className: classNames.get(table.name) || defaultClassName(table.name, config('prefix').value),
      files: [...container.querySelectorAll<HTMLInputElement>('.cg-file-types input:checked')].map(el => el.value as FileType),
    };
  }
  function renderFiles() {
    const tree = query('.cg-tree'); tree.replaceChildren();
    const table = tables[Number(select.value)];
    if (!table) return;
    const files = generateCode(table, options(table));
    for (const file of files) {
      const item = document.createElement('button'); item.type = 'button';
      item.textContent = file.path.split('/').at(-1)!; item.title = file.path;
      item.addEventListener('click', () => {
        tree.querySelectorAll('button').forEach(el => el.classList.remove('active')); item.classList.add('active');
        activeFile = file; code.value = file.content; query('.cg-path').textContent = file.path;
      });
      tree.append(item);
    }
    tree.querySelector<HTMLButtonElement>('button')?.click();
  }
  button('generate').addEventListener('click', () => {
    try {
      const parsed = parseMysqlDdl(ddl.value);
      const initialClassName = tables.length === 0 ? config('className').value.trim() : '';
      if (parsedDdl !== ddl.value) classNames.clear();
      if (initialClassName && parsed.length === 1) classNames.set(parsed[0].name, initialClassName);
      tables = parsed; parsedDdl = ddl.value;
      const files = tables.flatMap(table => generateCode(table, options(table)));
      if (new Set(files.map(f => f.path)).size !== files.length) throw new Error('生成文件路径重复，请调整各表类名或去除前缀设置。');
      const previousTable = select.selectedIndex;
      select.replaceChildren(...tables.map((t, i) => new Option(t.name, String(i))));
      select.selectedIndex = Math.max(0, Math.min(previousTable, tables.length - 1));
      const table = tables[Number(select.value)];
      config('className').value = options(table).className;
      allFiles = files; renderFiles(); dirty = false; setExportEnabled(true);
      status.classList.remove('error'); status.textContent = `已生成 ${tables.length} 张表、${files.length} 个文件。`;
      try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(keys.map(key => [key, config(key).value])))); } catch { showToast('代码已生成，配置保存失败'); }
    } catch (error) {
      invalidate(); status.classList.add('error'); status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  select.addEventListener('change', () => {
    const table = tables[Number(select.value)];
    if (!table) return;
    config('className').value = options(table).className;
    if (!dirty) renderFiles();
  });
  ddl.addEventListener('input', invalidate);
  for (const key of [...keys, 'className']) config(key).addEventListener('input', () => {
    if (key === 'className' && tables[Number(select.value)]) classNames.set(tables[Number(select.value)].name, config(key).value.trim());
    if (key === 'prefix' && tables[Number(select.value)]) config('className').value = options(tables[Number(select.value)]).className;
    invalidate();
  });
  container.querySelectorAll('.cg-file-types input').forEach(el => el.addEventListener('change', invalidate));
  button('sample').addEventListener('click', () => { ddl.value = SAMPLE; invalidate(); });
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  button('copy').addEventListener('click', async () => {
    if (dirty || !activeFile) return;
    try { await navigator.clipboard.writeText(activeFile.content); showToast('文件已复制'); } catch { showToast('复制失败，请手动选择代码复制'); }
  });
  button('download').addEventListener('click', () => {
    if (!dirty && activeFile) download(new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' }), activeFile.path.split('/').at(-1)!);
  });
  button('zip').addEventListener('click', () => {
    if (dirty || !allFiles.length) return;
    download(new Blob([createZip(allFiles) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), 'generated-code.zip');
    showToast('ZIP 已导出');
  });
}
