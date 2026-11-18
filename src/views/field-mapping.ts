import { parseJsonTree, renderJsonTree, type JsonNode } from '../utils/json-response';
import { validateBusinessProfile, resolveBusinessFields, type BusinessProfile } from '../utils/field-mapping';
import { generateBusinessFieldsFromJava } from '../utils/java-field-mapping';
import { getPlugins } from '../utils/plugin';

const STORAGE_KEY = 'json-business-profiles';
type ListedProfile = { key: string; profile: BusinessProfile; source: string; editable: boolean };

function savedProfiles(): BusinessProfile[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.map(validateBusinessProfile) : [];
  } catch { return []; }
}

export function initFieldMapping(container: HTMLElement, showToast: (message: string) => void) {
  container.className = 'field-mapping-view';
  container.innerHTML = `
    <div class="json-subbar field-mapping-toolbar">
      <label class="subbar-label">映射配置 <select id="field-profile" class="subbar-input"></select></label>
      <button id="field-new" class="btn btn-primary btn-sm" type="button">新建映射</button>
      <button id="field-edit" class="btn btn-secondary btn-sm" type="button">编辑映射</button>
      <button id="field-import" class="btn btn-secondary btn-sm" type="button">导入配置</button>
      <button id="field-java" class="btn btn-secondary btn-sm" type="button">从 Java 实体生成</button>
      <button id="field-export" class="btn btn-ghost btn-sm" type="button">导出配置</button>
      <button id="field-delete" class="btn btn-ghost btn-sm" type="button">删除</button>
      <input id="field-import-file" type="file" accept=".json,application/json" hidden />
      <input id="field-java-file" type="file" accept=".java,.txt,text/plain" multiple hidden />
    </div>
    <div id="field-editor" class="field-mapping-editor" hidden>
      <label>配置名称 <input id="field-name" class="subbar-input" placeholder="例如：订单字段" /></label>
      <label>字段映射（每行：JSON 路径 = 显示名称）<textarea id="field-lines" class="log-textarea" spellcheck="false" placeholder="$.data.id = 编号\n$.items[].name = 名称"></textarea></label>
      <div><button id="field-save" class="btn btn-primary btn-sm" type="button">保存映射</button> <button id="field-cancel" class="btn btn-ghost btn-sm" type="button">取消</button></div>
    </div>
    <main class="workspace field-mapping-workspace">
      <section class="pane pane-left"><div class="pane-header"><div class="pane-title">输入 JSON <span id="field-input-stat" class="badge">0 字符</span></div><button id="field-paste" class="btn btn-ghost btn-sm" type="button">粘贴</button></div><div class="pane-body"><textarea id="field-input" class="log-textarea" spellcheck="false" placeholder="在此粘贴 JSON，选择映射配置后查看字段"></textarea></div></section>
      <section class="pane pane-right"><div class="pane-header"><div class="pane-title">字段映射结果 <span id="field-result-stat" class="badge">未输入</span></div><button id="field-copy" class="btn btn-primary btn-sm" type="button">复制结果</button></div><div class="pane-body field-mapping-output"><input id="field-query" class="json-field-query" type="search" placeholder="搜索中文名称、字段名或路径" /><div id="field-results" class="field-mapping-results"></div><div id="field-tree" class="resp-json-tree"></div></div></section>
    </main>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const select = find<HTMLSelectElement>('#field-profile');
  const input = find<HTMLTextAreaElement>('#field-input');
  const query = find<HTMLInputElement>('#field-query');
  const results = find<HTMLElement>('#field-results');
  const tree = find<HTMLElement>('#field-tree');
  const editor = find<HTMLElement>('#field-editor');
  const name = find<HTMLInputElement>('#field-name');
  const lines = find<HTMLTextAreaElement>('#field-lines');
  let profiles: ListedProfile[] = [];
  let editingId = '';
  let root: JsonNode | null = null;
  let focusPath: ((path: string) => boolean) | undefined;
  let lastMatches: ReturnType<typeof resolveBusinessFields> = [];
  const selected = () => profiles.find(item => item.key === select.value);
  const refreshProfiles = () => {
    const previous = select.value;
    profiles = [
      ...getPlugins().flatMap(item => (item.plugin.fieldProfiles || []).map(profile => ({ key: `${item.id}:${profile.id}`, profile: validateBusinessProfile(profile), source: item.plugin.name, editable: false }))),
      ...savedProfiles().map(profile => ({ key: `local:${profile.id}`, profile, source: '本地', editable: true })),
    ];
    select.replaceChildren(new Option('选择映射配置', ''), ...profiles.map(item => new Option(`${item.profile.name} · ${item.source}`, item.key)));
    select.value = profiles.some(item => item.key === previous) ? previous : '';
    render();
  };
  const render = () => {
    results.replaceChildren(); tree.replaceChildren(); focusPath = undefined; lastMatches = [];
    find<HTMLElement>('#field-input-stat').textContent = `${input.value.length} 字符`;
    if (!input.value.trim()) { find<HTMLElement>('#field-result-stat').textContent = '未输入'; return; }
    try { root = parseJsonTree(input.value); }
    catch (error) { root = null; find<HTMLElement>('#field-result-stat').textContent = error instanceof Error ? error.message : 'JSON 格式错误'; return; }
    if (root.kind !== 'value') focusPath = renderJsonTree(tree, root).focusPath;
    const active = selected();
    if (!active) { find<HTMLElement>('#field-result-stat').textContent = '请选择映射配置'; return; }
    lastMatches = resolveBusinessFields(root, active.profile, query.value).slice(0, 500);
    find<HTMLElement>('#field-result-stat').textContent = `${lastMatches.length} 个字段`;
    for (const match of lastMatches) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'json-field-locate';
      button.textContent = `${match.label} (${match.fieldName}) · ${match.path} = ${match.value}`;
      button.title = '点击定位字段'; button.onclick = () => focusPath?.(match.path);
      results.append(button);
    }
  };
  const openEditor = (profile?: BusinessProfile) => {
    editingId = profile?.id || '';
    name.value = profile?.name || '';
    lines.value = profile?.fields.map(field => `${field.path} = ${field.label}`).join('\n') || '';
    editor.hidden = false; name.focus();
  };
  find<HTMLButtonElement>('#field-new').onclick = () => openEditor();
  find<HTMLButtonElement>('#field-edit').onclick = () => {
    const item = selected(); if (!item) { showToast('请先选择映射配置'); return; }
    openEditor(item.editable ? item.profile : { ...item.profile, id: '' });
    if (!item.editable) showToast('插件配置将另存为本地副本');
  };
  find<HTMLButtonElement>('#field-cancel').onclick = () => { editor.hidden = true; };
  find<HTMLButtonElement>('#field-save').onclick = () => {
    try {
      const fields = lines.value.split(/\r?\n/).filter(line => line.trim()).map(line => {
        const index = line.indexOf(' = ');
        if (index < 0) throw new Error('每行请使用“路径 = 显示名称”格式');
        return { path: line.slice(0, index).trim(), label: line.slice(index + 3).trim() };
      });
      const id = editingId || `mapping-${Date.now()}`;
      const profile = validateBusinessProfile({ id, name: name.value, fields });
      const next = savedProfiles().filter(item => item.id !== id);
      next.push(profile); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      editor.hidden = true; refreshProfiles(); select.value = `local:${id}`; render(); showToast('映射配置已保存');
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  find<HTMLButtonElement>('#field-delete').onclick = () => {
    const item = selected(); if (!item) return;
    if (!item.editable) { showToast('插件提供的配置不能在基础版删除'); return; }
    if (!window.confirm(`删除映射配置“${item.profile.name}”？`)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProfiles().filter(profile => profile.id !== item.profile.id)));
    refreshProfiles(); showToast('映射配置已删除');
  };
  const importFile = find<HTMLInputElement>('#field-import-file');
  find<HTMLButtonElement>('#field-import').onclick = () => importFile.click();
  importFile.onchange = async () => {
    const file = importFile.files?.[0]; importFile.value = ''; if (!file) return;
    try {
      const profile = validateBusinessProfile(JSON.parse(await file.text()));
      const next = savedProfiles().filter(item => item.id !== profile.id); next.push(profile);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); refreshProfiles(); select.value = `local:${profile.id}`; render(); showToast('配置已导入');
    } catch (error) { showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
  };
  find<HTMLButtonElement>('#field-export').onclick = () => {
    const item = selected(); if (!item) { showToast('请先选择映射配置'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(item.profile, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${item.profile.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const javaFile = find<HTMLInputElement>('#field-java-file');
  find<HTMLButtonElement>('#field-java').onclick = () => javaFile.click();
  javaFile.onchange = async () => {
    const files = [...(javaFile.files || [])]; javaFile.value = ''; if (!files.length) return;
    try {
      if (!input.value.trim()) throw new Error('请先输入示例 JSON');
      const root = parseJsonTree(input.value);
      const result = generateBusinessFieldsFromJava(await Promise.all(files.map(file => file.text())), root);
      if (!result.fields.length) throw new Error('未匹配到带中文注释的 Java 字段');
      openEditor({ id: '', name: 'Java 实体映射', fields: result.fields });
      showToast(`生成 ${result.fields.length} 个字段，保存前可检查和修改`);
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  find<HTMLButtonElement>('#field-paste').onclick = async () => {
    try { input.value = await navigator.clipboard.readText(); render(); }
    catch { showToast('无法读取剪贴板'); }
  };
  find<HTMLButtonElement>('#field-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(lastMatches, null, 2)); showToast('结果已复制'); }
    catch { showToast('复制失败'); }
  };
  input.oninput = render; query.oninput = render; select.onchange = render;
  window.addEventListener('one-tool-plugins-changed', refreshProfiles);
  refreshProfiles();
}
