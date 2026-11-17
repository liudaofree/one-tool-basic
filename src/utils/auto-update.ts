import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export function initAutoUpdate(button: HTMLButtonElement, showToast: (message: string) => void) {
  if (!isTauri()) return;
  button.hidden = false;
  let pending: Update | null = null;
  let busy = false;

  async function checkForUpdate(silent: boolean) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = '检查更新中…';
    try {
      pending = await check();
      if (pending) {
        button.textContent = `更新到 v${pending.version}`;
        showToast(`发现新版本 v${pending.version}，点击右上角更新`);
      } else {
        button.textContent = '检查更新';
        if (!silent) showToast('当前已是最新版本');
      }
    } catch (error) {
      button.textContent = '检查更新';
      if (!silent) showToast(`检查更新失败：${String(error)}`);
    } finally {
      button.disabled = false;
      busy = false;
    }
  }

  button.addEventListener('click', async () => {
    if (busy) return;
    if (!pending) { await checkForUpdate(false); return; }
    busy = true;
    button.disabled = true;
    button.textContent = '下载更新中…';
    try {
      await pending.downloadAndInstall();
      button.textContent = '重新启动中…';
      await relaunch();
    } catch (error) {
      button.textContent = '重试更新';
      showToast(`安装更新失败：${String(error)}`);
    } finally {
      button.disabled = false;
      busy = false;
    }
  });

  window.setTimeout(() => void checkForUpdate(true), 3000);
}
