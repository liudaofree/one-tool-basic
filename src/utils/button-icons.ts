type IconName = 'plus' | 'copy' | 'trash' | 'save' | 'send' | 'upload' | 'download' | 'refresh' | 'settings' | 'folder' | 'file' | 'swap' | 'compare' | 'play' | 'pause' | 'search' | 'sparkles' | 'x' | 'sun' | 'moon';

const paths: Record<IconName, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  save: '<path d="M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-7h8v7"/>',
  send: '<path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 4-4"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  download: '<path d="M12 3v13m-4-4 4 4 4-4M4 17v3h16v-3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 8m0-5v5h5M4 13a8 8 0 0 0 14 5l2-2m0 5v-5h-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6m-6 4h6"/>',
  swap: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  compare: '<path d="M3 5h8v14H3zM13 5h8v14h-8zM6 9h2m8 5h2"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M7 5v14m10-14v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  sparkles: '<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z"/>',
  x: '<path d="M5 5l14 14M19 5 5 19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
};

function svg(name: IconName): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = `<svg class="button-icon" data-button-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}

const byId: Record<string, IconName> = {
  'plugin-import-button': 'upload', 'btn-http-send': 'send', 'btn-http-new': 'plus',
  'btn-http-save': 'save', 'btn-http-curl-import': 'upload', 'btn-http-curl-export': 'copy',
  'btn-copy-resp': 'copy', 'btn-confirm-curl': 'upload', 'btn-confirm-save': 'save',
  'btn-confirm-rename': 'save', 'btn-save-env': 'save', 'btn-add-domain': 'plus',
  'btn-add-param': 'plus', 'btn-add-header': 'plus', 'btn-add-cookie': 'plus',
  'btn-add-form': 'plus', 'btn-add-env-var': 'plus', 'btn-create-new-env': 'plus',
  'btn-sample': 'file', 'btn-copy-all': 'copy', 'btn-clear': 'trash',
  'json-btn-sample': 'file', 'json-btn-clear': 'trash', 'json-run': 'play',
  'json-copy': 'copy', 'json-paste': 'copy', 'download-pick': 'folder',
  'download-refresh': 'refresh', 'fc-edit': 'file', 'fc-swap': 'swap',
  'fc-compare': 'compare', 'fc-left-pick': 'folder', 'fc-right-pick': 'folder',
  'ai-settings-button': 'settings', 'ai-clear': 'trash', 'ai-send': 'send',
  'ai-config-new': 'plus', 'ai-config-delete': 'trash', 'ai-config-test': 'refresh',
  'ai-config-save': 'save', 'btn-drawer-add-save': 'save',
  'btn-drawer-manage-env': 'settings', 'btn-clear-all-cookies': 'trash',
  'btn-http-clear': 'trash', 'btn-request-preview': 'search',
};

const byAction: Record<string, IconName> = {
  sample: 'file', generate: 'play', zip: 'download', copy: 'copy', download: 'download',
};

const leadingSymbol = /^(?:[\s\uFE0F]*(?:[🕒⭐🌐💡📋🗑️⚡✏️⚙️]|[＋+])\s*)/u;

function stripLeadingSymbol(button: HTMLButtonElement): void {
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.textContent || '';
    if (!value.trim()) continue;
    const cleaned = value.replace(leadingSymbol, '');
    if (cleaned !== value) node.textContent = cleaned;
    break;
  }
}

function desiredIcon(button: HTMLButtonElement): IconName | null {
  if (button.id === 'theme-switch') return document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun';
  if (button.matches('[role="tab"], .drawer-tab, .tab-btn, .resp-tab-btn, .json-tab-btn, .code-tools-tab, .download-tab, .preset-chip')) return null;
  if (button.dataset.iconLock === 'x' || button.textContent?.trim() === '✕' || button.textContent?.trim() === '×') return 'x';
  if (byId[button.id]) return byId[button.id];
  if (button.dataset.action && byAction[button.dataset.action]) return byAction[button.dataset.action];
  if (button.matches('.btn-copy-card, .preview-copy')) return 'copy';
  if (button.matches('.btn-edit-item')) return 'file';
  if (button.matches('.btn-del-item, .btn-del-domain, .btn-del-cookie')) return 'trash';
  if (button.matches('.btn-save-new-cookie')) return 'save';
  if (button.matches('.btn-add-cookie-to-domain')) return 'plus';
  const label = button.textContent?.trim() || '';
  if (label === '复制 SQL' || label === '复制文件' || label === '复制结果') return 'copy';
  if (label === '载入示例' || label === '载入示例日志' || label === '试试示例日志') return 'file';
  if (label === '添加任务') return 'plus';
  if (label === '刷新') return 'refresh';
  if (label === '打开所在文件夹' || label === '选择文件夹') return 'folder';
  if (label === '暂停') return 'pause';
  if (label === '继续') return 'play';
  if (label === '更换插件' || label === '导入插件') return 'upload';
  if (label === '解析并生成' || label === '开始比对') return 'play';
  if (label === '导出 ZIP' || label === '下载文件') return 'download';
  return null;
}

function decorate(button: HTMLButtonElement): void {
  stripLeadingSymbol(button);
  const name = desiredIcon(button);
  const current = button.querySelector<SVGSVGElement>(':scope > svg[data-button-icon]');
  if (!name) { current?.remove(); return; }
  if (current?.dataset.buttonIcon === name) return;
  current?.remove();
  if (name === 'x' && (button.textContent?.trim() === '✕' || button.textContent?.trim() === '×')) {
    button.setAttribute('aria-label', button.title || '关闭');
    button.dataset.iconLock = 'x';
    button.textContent = '';
  }
  button.prepend(svg(name));
}

export function installButtonIcons(): void {
  const root = document.querySelector('#app');
  if (!root) return;
  let queued = false;
  const update = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      root.querySelectorAll<HTMLButtonElement>('button').forEach(decorate);
    });
  };
  new MutationObserver(update).observe(root, { childList: true, subtree: true });
  update();
}
