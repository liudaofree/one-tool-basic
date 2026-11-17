import { getPlugin, installPlugin, loadPlugin } from '../utils/plugin';

export function initPlugins(container: HTMLElement, showToast: (message: string) => void) {
  container.innerHTML = `
    <div class="plugin-page">
      <div class="plugin-page-header"><h2>本地插件</h2><p>导入签名插件包，在本机使用插件功能。</p></div>
      <div class="plugin-card">
        <div class="plugin-card-main"><div class="plugin-card-title">插件</div><div id="plugin-status" class="plugin-status">正在检查插件...</div></div>
        <button id="plugin-import-button" class="btn btn-primary" type="button">导入插件</button>
        <input id="plugin-import-file" type="file" accept=".json,application/json" hidden />
      </div>
      <p class="plugin-page-note">仅接受签名及接口版本校验通过的插件包；导入失败时保留已安装的版本。</p>
    </div>
    <div id="plugin-workspace" style="height:calc(100% - 172px);min-height:340px;"></div>`;
  const status = container.querySelector<HTMLElement>('#plugin-status')!;
  const workspace = container.querySelector<HTMLElement>('#plugin-workspace')!;
  const input = container.querySelector<HTMLInputElement>('#plugin-import-file')!;
  const button = container.querySelector<HTMLButtonElement>('#plugin-import-button')!;
  const render = () => {
    const plugin = getPlugin();
    status.textContent = plugin ? `已安装 · ${plugin.name}` : '未安装';
    button.textContent = plugin ? '更换插件' : '导入插件';
    workspace.replaceChildren();
    if (plugin) plugin.mount(workspace, showToast);
  };
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await installPlugin(await file.text());
      render();
      showToast('插件已安装并通过签名校验');
    } catch (error) { showToast(`插件导入失败：${error instanceof Error ? error.message : String(error)}`); }
  });
  void loadPlugin().then(render).catch(error => {
    status.textContent = '已保存的插件加载失败';
    showToast(`插件加载失败：${error instanceof Error ? error.message : String(error)}`);
  });
}
