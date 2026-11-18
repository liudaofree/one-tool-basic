import { initFieldMapping } from './field-mapping';
import {
  formatJson, minifyJson, escapeJsonString, unescapeJsonString, toUnicode, fromUnicode,
  jsonToJavaBean, javaBeanToJson, jsonToYaml, yamlToJson, jsonToXml, xmlToJson,
  jsonToCsv, csvToJson,
  type JavaBeanOptions,
} from '../utils/json-converter';
import { findJsonFields, parseJsonTree, renderJsonTree, type JsonNode } from '../utils/json-response';

type Tab = 'mapping' | 'format' | 'java' | 'yaml' | 'xml' | 'csv' | 'escape' | 'unicode';
const tabs: { id: Tab; label: string }[] = [
  { id: 'format', label: '美化 / 压缩' }, { id: 'mapping', label: '字段映射' }, { id: 'java', label: 'JSON 转换成 Java Bean' },
  { id: 'yaml', label: 'YAML 互转' }, { id: 'xml', label: 'XML 互转' },
  { id: 'csv', label: 'CSV 互转' }, { id: 'escape', label: '转义 / 去转义' },
  { id: 'unicode', label: 'Unicode' },
];
const javaOptions: JavaBeanOptions = { className: 'ExampleDto', useLombok: true, useJackson: true, useCamelCase: true };
const operations: Record<Tab, { value: string; label: string; convert: (text: string) => string }[]> = {
  mapping: [],
  format: [
    { value: 'format', label: '美化 JSON', convert: formatJson },
    { value: 'minify', label: '压缩 JSON', convert: minifyJson },
  ],
  java: [
    { value: 'json-to-java', label: 'JSON → Java Bean', convert: text => jsonToJavaBean(text, javaOptions) },
    { value: 'java-to-json', label: 'Java Bean → JSON', convert: javaBeanToJson },
  ],
  yaml: [
    { value: 'json-to-yaml', label: 'JSON → YAML', convert: jsonToYaml },
    { value: 'yaml-to-json', label: 'YAML → JSON', convert: yamlToJson },
  ],
  xml: [
    { value: 'json-to-xml', label: 'JSON → XML', convert: jsonToXml },
    { value: 'xml-to-json', label: 'XML → JSON', convert: xmlToJson },
  ],
  csv: [
    { value: 'json-to-csv', label: 'JSON → CSV', convert: jsonToCsv },
    { value: 'csv-to-json', label: 'CSV → JSON', convert: csvToJson },
  ],
  escape: [
    { value: 'escape', label: '转义 JSON 字符串', convert: escapeJsonString },
    { value: 'unescape', label: '去转义 JSON 字符串', convert: unescapeJsonString },
  ],
  unicode: [
    { value: 'to-unicode', label: '转为 Unicode', convert: toUnicode },
    { value: 'from-unicode', label: 'Unicode 还原', convert: fromUnicode },
  ],
};

export function initJsonConverter(container: HTMLElement, showToast: (message: string) => void) {
  let tab: Tab = 'format';
  container.innerHTML = `
    <div class="tool-content-inner json-converter-container">
      <div class="options-bar json-options-bar">
        <div class="json-tabs">${tabs.map(item => `<button class="json-tab-btn${item.id === tab ? ' active' : ''}" data-tab="${item.id}" type="button">${item.label}</button>`).join('')}</div>
        <button id="json-btn-sample" class="btn btn-secondary btn-sm" type="button">载入示例</button><button id="json-btn-clear" class="btn btn-ghost btn-sm" type="button">清空</button>
      </div>
      <div id="json-standard" class="json-standard"><div class="json-subbar"><label class="subbar-label">操作：<select id="json-operation" class="subbar-input"></select></label><button id="json-run" class="btn btn-primary btn-sm" type="button">转换</button><div id="java-options" class="subbar-group" hidden><label>类名 <input id="java-class-name" class="subbar-input" value="ExampleDto" /></label><label><input id="java-lombok" type="checkbox" checked /> Lombok</label><label><input id="java-jackson" type="checkbox" checked /> JsonProperty</label><label><input id="java-camel" type="checkbox" checked /> 小驼峰</label></div></div>
      <main class="workspace">
        <section class="pane pane-left"><div class="pane-header"><div class="pane-title">输入内容 <span id="json-input-stat" class="badge">0 字符</span></div><button id="json-paste" class="btn btn-ghost btn-sm" type="button">粘贴</button></div><div class="pane-body"><textarea id="json-input-text" class="log-textarea" spellcheck="false" placeholder="在此粘贴或输入内容..."></textarea></div></section>
        <section class="pane pane-right"><div class="pane-header"><div class="pane-title">转换结果 <span id="json-output-stat" class="badge">就绪</span></div><button id="json-copy" class="btn btn-primary btn-sm" type="button">复制结果</button></div><div class="pane-body json-converter-output"><div id="json-result-toolbar" class="resp-json-toolbar" hidden><input id="json-field-query" class="json-field-query" type="search" placeholder="查找字段名或路径" /><button id="json-expand" class="btn btn-ghost btn-sm" type="button">全部展开</button><button id="json-collapse" class="btn btn-ghost btn-sm" type="button">全部折叠</button><button id="json-toggle-raw" class="btn btn-secondary btn-sm" type="button">查看原文</button></div><div id="json-field-results" class="json-field-results" hidden></div><div id="json-result-tree" class="resp-json-tree" hidden></div><textarea id="json-output-text" class="log-textarea" spellcheck="false" readonly></textarea></div></section>
      </main></div>
      <div id="json-field-mapping-host" hidden></div>
    </div>`;
  const standard = container.querySelector<HTMLElement>('#json-standard')!;
  const mappingHost = container.querySelector<HTMLElement>('#json-field-mapping-host')!;
  initFieldMapping(mappingHost, showToast);
  const input = container.querySelector<HTMLTextAreaElement>('#json-input-text')!;
  const output = container.querySelector<HTMLTextAreaElement>('#json-output-text')!;
  const select = container.querySelector<HTMLSelectElement>('#json-operation')!;
  const inputStat = container.querySelector<HTMLElement>('#json-input-stat')!;
  const outputStat = container.querySelector<HTMLElement>('#json-output-stat')!;
  const javaControls = container.querySelector<HTMLElement>('#java-options')!;
  const toolbar = container.querySelector<HTMLElement>('#json-result-toolbar')!;
  const tree = container.querySelector<HTMLElement>('#json-result-tree')!;
  const fields = container.querySelector<HTMLElement>('#json-field-results')!;
  const query = container.querySelector<HTMLInputElement>('#json-field-query')!;
  const toggleRaw = container.querySelector<HTMLButtonElement>('#json-toggle-raw')!;
  let root: JsonNode | null = null;
  let treeActions: ReturnType<typeof renderJsonTree> | null = null;
  let showingRaw = false;
  const renderFields = () => {
    fields.replaceChildren();
    if (!root || !query.value.trim()) { fields.hidden = true; return; }
    for (const match of findJsonFields(root, query.value).slice(0, 100)) {
      const button = document.createElement('button');
      button.className = 'json-field-locate'; button.type = 'button';
      button.textContent = `${match.path} · ${match.value}`;
      button.onclick = () => { if (showingRaw) toggleRaw.click(); treeActions?.focusPath(match.path); };
      fields.append(button);
    }
    fields.hidden = false;
  };
  const renderResult = () => {
    root = null; treeActions = null; showingRaw = false;
    tree.hidden = true; toolbar.hidden = true; fields.hidden = true; output.hidden = false;
    toggleRaw.textContent = '查看原文';
    if (!output.value) return;
    try {
      const parsed = parseJsonTree(output.value);
      if (parsed.kind === 'value' || !parsed.children.length) return;
      root = parsed; treeActions = renderJsonTree(tree, parsed);
      tree.hidden = false; toolbar.hidden = false; output.hidden = true;
      renderFields();
    } catch { }
  };
  const renderOptions = () => { select.replaceChildren(...operations[tab].map(op => new Option(op.label, op.value))); javaControls.hidden = tab !== 'java'; output.value = ''; outputStat.textContent = '就绪'; renderResult(); };
  const run = () => {
    if (!input.value.trim()) { output.value = ''; outputStat.textContent = '未输入'; renderResult(); return; }
    try {
      output.value = operations[tab].find(op => op.value === select.value)!.convert(input.value);
      outputStat.textContent = `${output.value.length} 字符`; renderResult();
    } catch (error) { output.value = ''; outputStat.textContent = error instanceof Error ? error.message : String(error); renderResult(); }
  };
  container.querySelectorAll<HTMLButtonElement>('.json-tab-btn').forEach(button => button.addEventListener('click', () => {
    tab = button.dataset.tab as Tab;
    container.querySelectorAll('.json-tab-btn').forEach(item => item.classList.toggle('active', item === button));
    standard.hidden = tab === 'mapping'; mappingHost.hidden = tab !== 'mapping';
    container.querySelector<HTMLElement>('#json-btn-sample')!.hidden = tab === 'mapping';
    container.querySelector<HTMLElement>('#json-btn-clear')!.hidden = tab === 'mapping';
    if (tab !== 'mapping') { renderOptions(); run(); }
  }));
  input.addEventListener('input', () => { inputStat.textContent = `${input.value.length} 字符`; run(); });
  select.addEventListener('change', run);
  container.querySelector('#json-run')!.addEventListener('click', run);
  query.addEventListener('input', renderFields);
  container.querySelector('#json-expand')!.addEventListener('click', () => treeActions?.expandAll());
  container.querySelector('#json-collapse')!.addEventListener('click', () => treeActions?.collapseAll());
  toggleRaw.addEventListener('click', () => { showingRaw = !showingRaw; tree.hidden = showingRaw; output.hidden = !showingRaw; toggleRaw.textContent = showingRaw ? '返回折叠视图' : '查看原文'; });
  container.querySelector<HTMLInputElement>('#java-class-name')!.addEventListener('input', event => { javaOptions.className = (event.target as HTMLInputElement).value; if (tab === 'java' && select.value === 'json-to-java') run(); });
  for (const [id, key] of [['java-lombok', 'useLombok'], ['java-jackson', 'useJackson'], ['java-camel', 'useCamelCase']] as const) {
    container.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('change', event => { javaOptions[key] = (event.target as HTMLInputElement).checked; if (tab === 'java' && select.value === 'json-to-java') run(); });
  }
  container.querySelector('#json-btn-sample')!.addEventListener('click', () => { input.value = '{"id": 1, "name": "Example", "items": [{"code": "A1"}]}'; input.dispatchEvent(new Event('input')); });
  container.querySelector('#json-btn-clear')!.addEventListener('click', () => { input.value = ''; output.value = ''; inputStat.textContent = '0 字符'; outputStat.textContent = '就绪'; renderResult(); });
  container.querySelector('#json-paste')!.addEventListener('click', async () => { try { input.value = await navigator.clipboard.readText(); input.dispatchEvent(new Event('input')); } catch { showToast('无法读取剪贴板'); } });
  container.querySelector('#json-copy')!.addEventListener('click', async () => { try { await navigator.clipboard.writeText(output.value); showToast('已复制'); } catch { showToast('复制失败'); } });
  renderOptions();
}
