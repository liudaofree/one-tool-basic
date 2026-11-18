import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { confirmAction } from '../utils/confirm-dialog';

const CONFIG_KEYS = [
  'one-tool-theme', 'onetool_http_saved', 'onetool_http_environments',
  'onetool_http_active_env_id', 'onetool_code_generator_config',
  'json-business-profiles', 'onetool_ai_profiles', 'onetool_ai_active_profile',
  'one-tool:download-directory',
];
const COOKIE_KEY = 'onetool_http_domain_cookies';
type Backup = { format: 'one-tool-settings'; version: 1; createdAt: string; data: Record<string, string> };

export function initSettings(container: HTMLElement, showToast: (message: string) => void) {
  container.innerHTML = `<div class="settings-page">
    <h2>偏好与数据</h2>
    <section class="download-panel"><h3>外观</h3><p>选择应用主题</p><select id="settings-theme"><option value="light">浅色</option><option value="dark">深色</option></select></section>
    <section class="download-panel"><h3>更新与版本</h3><p id="settings-version">版本信息加载中</p><button id="settings-update" class="btn btn-secondary" type="button">检查更新</button></section>
    <section class="download-panel"><h3>配置备份与迁移</h3><p>包含接口收藏、环境、代码生成设置、字段映射、主题、下载目录和 AI 模型名称。系统保存的 AI Key、插件和下载任务不包含在备份中。</p>
      <label><input id="settings-cookies" type="checkbox"> 包含 Cookie（备份文件会含明文凭据）</label>
      <div class="settings-actions"><button id="settings-export" class="btn btn-primary" type="button">导出备份</button><button id="settings-import" class="btn btn-secondary" type="button">导入备份</button></div>
      <input id="settings-file" type="file" accept=".json,application/json" hidden><p>导入会覆盖备份中同名配置，并重新加载界面；请先导出当前配置。</p></section>
    <section class="download-panel"><h3>关于</h3><p>One Tool 基础版 · 本地开发工具箱</p></section>
  </div>`;
  const get = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const theme = get<HTMLSelectElement>('settings-theme');
  const syncTheme = () => { theme.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; };
  syncTheme();
  window.addEventListener('one-tool-theme-changed', syncTheme);
  theme.onchange = () => window.dispatchEvent(new CustomEvent('one-tool-set-theme', { detail: theme.value }));
  get<HTMLElement>('settings-version').textContent = `当前版本：${isTauri() ? '读取中' : '浏览器开发模式'}`;
  if (isTauri()) void getVersion().then(version => { get<HTMLElement>('settings-version').textContent = `当前版本：v${version}`; });
  get<HTMLButtonElement>('settings-update').onclick = () => document.getElementById('update-button')?.click();
  if (!isTauri()) get<HTMLButtonElement>('settings-update').disabled = true;
  get<HTMLButtonElement>('settings-export').onclick = () => {
    const keys = get<HTMLInputElement>('settings-cookies').checked ? [...CONFIG_KEYS, COOKIE_KEY] : CONFIG_KEYS;
    const data: Record<string, string> = {};
    for (const key of keys) { const value = localStorage.getItem(key); if (value !== null) data[key] = value; }
    const backup: Backup = { format: 'one-tool-settings', version: 1, createdAt: new Date().toISOString(), data };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `one-tool-settings-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fileInput = get<HTMLInputElement>('settings-file');
  get<HTMLButtonElement>('settings-import').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('备份文件超过 5 MB');
      const backup: unknown = JSON.parse(await file.text());
      if (!backup || typeof backup !== 'object') throw new Error('备份格式无效');
      const value = backup as Partial<Backup>;
      if (value.format !== 'one-tool-settings' || value.version !== 1 || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('备份版本或格式不兼容');
      const allowed = new Set([...CONFIG_KEYS, COOKIE_KEY]);
      const entries = Object.entries(value.data);
      if (entries.some(([key, item]) => !allowed.has(key) || typeof item !== 'string')) throw new Error('备份包含未知配置');
      for (const [key, item] of entries) {
        if (key === 'one-tool-theme' && item !== 'light' && item !== 'dark') throw new Error('主题配置无效');
        if (key !== 'one-tool-theme' && key !== 'onetool_http_active_env_id' && key !== 'onetool_ai_active_profile' && key !== 'one-tool:download-directory') JSON.parse(item);
      }
      if (!await confirmAction({ title: '导入配置备份', message: `将导入 ${entries.length} 项配置并覆盖同名数据，随后重新加载界面。`, confirmText: '导入并覆盖' })) return;
      for (const [key, item] of entries) localStorage.setItem(key, item);
      window.location.reload();
    } catch (error) { showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
  };
}
