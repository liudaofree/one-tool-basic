import { getPlugins, installPlugin, loadPlugins, removePlugin } from '../utils/plugin';
import { confirmAction } from '../utils/confirm-dialog';

export function initPlugins(container: HTMLElement, showToast: (message: string) => void) {
  container.innerHTML = `
    <div class="plugin-page">
      <div class="plugin-page-header"><h2>本地插件</h2><p>可导入多个签名插件；同一插件再次导入会更新该插件。</p></div>
      <div class="plugin-card">
        <div class="plugin-card-main"><div class="plugin-card-title">已安装插件</div><div id="plugin-status" class="plugin-status">正在检查插件...</div></div>
        <button id="plugin-import-button" class="btn btn-primary" type="button">导入插件</button>
        <input id="plugin-import-file" type="file" accept=".json,application/json" multiple hidden />
      </div>
      <div id="plugin-list" class="plugin-list" role="tablist" aria-label="已安装插件"></div>
      <p class="plugin-page-note">只接受签名和接口版本校验通过的插件包；导入失败不会替换已安装版本。</p>
    </div>
    <div id="plugin-workspace" class="plugin-workspace"></div>`;
  const status = container.querySelector<HTMLElement>('#plugin-status')!;
  const list = container.querySelector<HTMLElement>('#plugin-list')!;
  const workspace = container.querySelector<HTMLElement>('#plugin-workspace')!;
  const input = container.querySelector<HTMLInputElement>('#plugin-import-file')!;
  let selectedId = '';
  const render = () => {
    const plugins = getPlugins();
    if (!plugins.some(item => item.id === selectedId)) selectedId = plugins[0]?.id || '';
    status.textContent = plugins.length ? `共 ${plugins.length} 个` : '未安装';
    list.replaceChildren();
    for (const item of plugins) {
      const row = document.createElement('div'); row.className = 'plugin-list-item';
      const select = document.createElement('button'); select.type = 'button'; select.className = `btn btn-secondary btn-sm${item.id === selectedId ? ' active' : ''}`;
      select.textContent = `${item.plugin.name} · v${item.version}`;
      select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(item.id === selectedId));
      select.onclick = () => { selectedId = item.id; render(); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost btn-sm'; remove.textContent = '卸载';
      remove.onclick = async () => {
        if (!await confirmAction({ title: '卸载插件', message: `确定卸载「${item.plugin.name}」吗？`, confirmText: '卸载插件', destructive: true })) return;
        removePlugin(item.id); render(); showToast('插件已卸载');
      };
      row.append(select, remove); list.append(row);
    }
    window.dispatchEvent(new Event('one-tool-plugins-changed'));
    workspace.replaceChildren();
    const selected = plugins.find(item => item.id === selectedId);
    if (selected) {
      try { selected.plugin.mount(workspace, showToast); }
      catch (error) { showToast(`插件页面加载失败：${error instanceof Error ? error.message : String(error)}`); }
    }
  };
  container.querySelector<HTMLButtonElement>('#plugin-import-button')!.onclick = () => input.click();
  input.onchange = async () => {
    const files = [...(input.files || [])]; input.value = '';
    for (const file of files) {
      try {
        const item = await installPlugin(await file.text()); selectedId = item.id;
        showToast(`${item.plugin.name} 已安装`);
      } catch (error) { showToast(`${file.name} 导入失败：${error instanceof Error ? error.message : String(error)}`); }
    }
    render();
  };
  void loadPlugins().then(render).catch(error => {
    render(); showToast(`部分插件加载失败：${error instanceof Error ? error.message : String(error)}`);
  });
}
