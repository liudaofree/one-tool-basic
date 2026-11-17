import { invoke, isTauri } from '@tauri-apps/api/core';

type Task = {
  id: number; url: string; path: string; status: string;
  completed: number; total: number | null; speed: number; connections: number; error: string | null;
};

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const labels: Record<string, string> = {
  active: '下载中', pausing: '正在暂停', paused: '已暂停', completed: '已完成', error: '失败',
};
const groups = [
  { title: '下载中', states: ['active', 'pausing'] },
  { title: '已暂停', states: ['paused'] },
  { title: '已完成', states: ['completed'] },
  { title: '失败', states: ['error'] },
];

export function initDownload(container: HTMLElement, showToast: (message: string) => void) {
  container.innerHTML = `
    <div class="download-page">
      <div class="download-panel">
        <h2>新建下载</h2>
        <p>粘贴 HTTP/HTTPS 文件直链，选择文件夹后添加任务。</p>
        <form id="download-form" class="download-form">
          <label class="download-wide">下载链接<input id="download-url" type="url" required placeholder="https://example.com/file.zip" /></label>
          <label class="download-wide">保存目录<div class="download-folder-field"><input id="download-dir" required readonly placeholder="请选择保存文件夹" title="保存目录" /><button id="download-pick" class="btn btn-secondary" type="button">选择文件夹</button></div></label>
          <div class="download-submit"><button class="btn btn-primary" type="submit">添加任务</button></div>
        </form>
      </div>
      <div class="download-panel download-tasks">
        <div class="download-heading"><h2>下载任务</h2><button id="download-refresh" class="btn btn-secondary" type="button">刷新</button></div>
        <div id="download-status" class="download-status" role="status"></div>
        <div id="download-tabs" class="download-tabs" role="tablist" aria-label="下载任务状态"></div>
        <div id="download-list"></div>
      </div>
    </div>`;
  const get = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const status = get<HTMLDivElement>('download-status');
  const tabs = get<HTMLDivElement>('download-tabs');
  const list = get<HTMLDivElement>('download-list');
  const directory = get<HTMLInputElement>('download-dir');
  directory.value = localStorage.getItem('one-tool:download-directory') || '';
  directory.title = directory.value || '请选择保存文件夹';
  get<HTMLButtonElement>('download-pick').onclick = async () => {
    if (!isTauri()) { showToast('文件夹选择需要桌面版'); return; }
    try {
      const selected = await invoke<string | null>('pick_download_folder');
      if (selected) {
        directory.value = selected;
        directory.title = selected;
        localStorage.setItem('one-tool:download-directory', selected);
      }
    } catch (error) { showToast(String(error)); }
  };
  let busy = false;
  let activeGroup = 'all';
  let currentTasks: Task[] = [];
  function render() {
    const tasks = currentTasks;
    tabs.replaceChildren();
    const choices = [{ title: '全部', states: [], key: 'all' }, ...groups.map(group => ({ ...group, key: group.states[0] }))];
    for (const choice of choices) {
      const count = choice.key === 'all' ? tasks.length : tasks.filter(task => choice.states.includes(task.status)).length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `download-tab${activeGroup === choice.key ? ' active' : ''}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(activeGroup === choice.key));
      button.textContent = `${choice.title} ${count}`;
      button.onclick = () => { activeGroup = choice.key; render(); };
      tabs.append(button);
    }
    list.replaceChildren();
    const selected = activeGroup === 'all' ? tasks : tasks.filter(task => choices.find(choice => choice.key === activeGroup)?.states.includes(task.status));
    if (!selected.length) {
      const empty = document.createElement('div');
      empty.className = 'download-empty';
      empty.textContent = activeGroup === 'all' ? '暂无下载任务' : '此状态下暂无任务';
      list.append(empty);
      return;
    }
    for (const task of selected) {
        const row = document.createElement('div'); row.className = `download-task download-task-${task.status}`;
        const name = task.path.split(/[\\/]/).pop() || task.path;
        const title = document.createElement('strong'); title.textContent = name; title.title = task.path;
        const path = document.createElement('div'); path.className = 'download-task-path';
        path.textContent = task.path; path.title = task.path;
        const meta = document.createElement('div'); meta.className = 'download-task-meta';
        const pct = task.total ? Math.min(100, task.completed / task.total * 100) : 0;
        if (activeGroup === 'all') {
          const badge = document.createElement('span'); badge.className = `download-state download-state-${task.status}`;
          badge.textContent = labels[task.status] || task.status;
          meta.append(badge);
        }
        const details = document.createElement('span');
        details.textContent = `${size(task.completed)}${task.total === null ? '' : ` / ${size(task.total)} · ${pct.toFixed(1)}%`}${task.status === 'active' ? ` · ${task.connections} 连接 · ${size(task.speed)}/s` : ''}${task.error ? ` · ${task.error}` : ''}`;
        meta.append(details);
        row.append(title, path, meta);
        if (task.status !== 'completed') {
          const progress = document.createElement('progress'); progress.max = 100; progress.value = pct;
          row.append(progress);
        }
        if (['active', 'paused', 'error'].includes(task.status)) {
          const button = document.createElement('button'); button.className = 'btn btn-secondary';
          const action = task.status === 'active' ? 'pause' : 'resume';
          button.textContent = action === 'pause' ? '暂停' : '继续';
          button.onclick = async () => {
            button.disabled = true;
            try { await invoke('download_control', { id: task.id, action }); await refresh(); }
            catch (error) { showToast(String(error)); button.disabled = false; }
          };
          row.append(button);
        } else if (task.status === 'completed') {
          const copy = document.createElement('button'); copy.className = 'btn btn-secondary';
          copy.textContent = '复制目录';
          copy.onclick = async () => {
            const folder = task.path.replace(/[\\/][^\\/]+$/, '');
            try { await navigator.clipboard.writeText(folder); showToast('目录已复制'); }
            catch { showToast('复制失败，请从任务路径手动复制'); }
          };
          const button = document.createElement('button'); button.className = 'btn btn-secondary';
          button.textContent = '打开所在文件夹';
          button.onclick = async () => {
            button.disabled = true;
            try { await invoke('download_open_folder', { id: task.id }); showToast('已请求打开保存目录'); }
            catch (error) { showToast(String(error)); }
            finally { button.disabled = false; }
          };
          const actions = document.createElement('div');
          actions.className = 'download-task-actions';
          actions.append(copy, button);
          row.append(actions);
        }
        list.append(row);
    }
  }
  async function refresh() {
    if (busy || !isTauri()) return;
    busy = true;
    try {
      const tasks = await invoke<Task[]>('download_list');
      currentTasks = tasks;
      status.textContent = '';
      render();
    } catch (error) { status.textContent = String(error); }
    finally { busy = false; }
  }
  get<HTMLButtonElement>('download-refresh').onclick = () => void refresh();
  get<HTMLFormElement>('download-form').onsubmit = async (event) => {
    event.preventDefault();
    if (!isTauri()) { showToast('下载功能需要桌面版'); return; }
    try {
      await invoke('download_add', {
        url: get<HTMLInputElement>('download-url').value.trim(),
        directory: directory.value.trim(),
      });
      showToast('下载任务已添加');
      await refresh();
    } catch (error) { showToast(String(error)); }
  };
  render();
  if (isTauri()) {
    void refresh();
    window.setInterval(() => { if (container.style.display !== 'none') void refresh(); }, 2000);
  } else status.textContent = '下载功能需要 Tauri 桌面版';
}
