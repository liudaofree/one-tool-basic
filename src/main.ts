import './style.css';
import './theme.css';
import { initSqlRestorer } from './views/sql-restorer';
import { initHttpClient } from './views/http-client';
import { initJsonConverter } from './views/json-converter';
import { initCodeGenerator } from './views/code-generator';
import { initDownload } from './views/download';
import { initFileCompare } from './views/file-compare';
import { initAiAssistant } from './views/ai-assistant';
import { initPlugins } from './views/plugins';
import { installButtonIcons } from './utils/button-icons';
import { installThemedSelects } from './utils/themed-select';
import { initAutoUpdate } from './utils/auto-update';

type ToolId = 'http-client' | 'sql-restorer' | 'json-converter' | 'download' | 'ai-assistant' | 'plugins';

const TOOL_CONFIG: Record<ToolId, { title: string; badge: string }> = {
  'download': { title: '下载', badge: '内置 HTTP 下载' },
  'http-client': {
    title: '接口请求',
    badge: '轻量 Postman',
  },
  'sql-restorer': {
    title: '代码工具',
    badge: 'SQL 还原 / 文件比对 / 代码生成',
  },
  'json-converter': {
    title: 'JSON 转换工具',
    badge: '格式化 / Bean / 互转',
  },
  'ai-assistant': { title: 'AI 助手', badge: '本地工具辅助分析' },
  'plugins': { title: '插件', badge: '本地插件管理' },
};

// Render Outer Layout
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <aside class="app-sidebar">
    <div class="sidebar-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8z" /></svg></div>
    <nav class="sidebar-nav">
      <div class="nav-item active" data-tool="http-client" title="接口请求">
        <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M9 5h10v10" /></svg></span>
        <span class="nav-label">接口请求</span>
      </div>
      <div class="nav-item" data-tool="sql-restorer" title="SQL 还原、文件比对与代码生成">
        <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-5-5H8zM16 4v5h5M7 13l2 2-2 2m5 0h5" /></svg></span>
        <span class="nav-label">代码工具</span>
      </div>
      <div class="nav-item" data-tool="json-converter" title="JSON 转换工具">
        <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-5-5H8zM16 4v5h5M9 12l-2 2 2 2m6-4 2 2-2 2" /></svg></span>
        <span class="nav-label">JSON 转换</span>
      </div>
      <div class="nav-item" data-tool="download" title="下载">
        <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></svg></span><span class="nav-label">下载</span>
      </div>
      <div class="nav-item" data-tool="ai-assistant" title="AI 助手">
        <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17z" /></svg></span><span class="nav-label">AI 助手</span>
      </div>
      <div class="nav-item" data-tool="plugins" title="插件">
        <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v4m8-4v4M7 8h10v5h3v4h-3v4H7v-4H4v-4h3V8zm4 5v4m-4-2h4" /></svg></span><span class="nav-label">插件</span>
      </div>
    </nav>
  </aside>

  <section class="main-container">
    <header class="app-header">
      <div class="header-left">
        <span id="app-header-title" class="header-title">接口请求</span>
        <span id="app-header-badge" class="header-badge">轻量 Postman</span>
      </div>
      <button id="update-button" class="theme-switch" type="button" hidden>检查更新</button>
      <button id="theme-switch" class="theme-switch" type="button" aria-label="切换主题"></button>
    </header>

    <div class="tool-viewport">
      <div id="view-http-client" class="tool-view active" style="height: 100%;"></div>
      <div id="view-sql-restorer" class="tool-view" style="height: 100%; display: none;">
        <div class="code-tools-page">
          <div class="code-tools-tabs" role="tablist" aria-label="代码工具">
            <button id="code-tab-sql" class="code-tools-tab active" role="tab" aria-selected="true" aria-controls="code-panel-sql" type="button">SQL 还原</button>
            <button id="code-tab-compare" class="code-tools-tab" role="tab" aria-selected="false" aria-controls="code-panel-compare" type="button">文件比对</button>
            <button id="code-tab-generator" class="code-tools-tab" role="tab" aria-selected="false" aria-controls="code-panel-generator" type="button">代码生成</button>
          </div>
          <div id="code-panel-sql" class="code-tools-panel" role="tabpanel" aria-labelledby="code-tab-sql"></div>
          <div id="code-panel-compare" class="code-tools-panel" role="tabpanel" aria-labelledby="code-tab-compare" hidden></div>
          <div id="code-panel-generator" class="code-tools-panel" role="tabpanel" aria-labelledby="code-tab-generator" hidden></div>
        </div>
      </div>
      <div id="view-json-converter" class="tool-view" style="height: 100%; display: none;"></div>
      <div id="view-download" class="tool-view" style="height: 100%; display: none;"></div>
      <div id="view-ai-assistant" class="tool-view" style="height: 100%; display: none;"></div>
      <div id="view-plugins" class="tool-view" style="height: 100%; display: none;"></div>
    </div>
  </section>

  <div id="toast-container" class="toast-container"></div>
`;

const THEME_KEY = 'one-tool-theme';
const themeSwitch = document.getElementById('theme-switch') as HTMLButtonElement;
function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  themeSwitch.textContent = theme === 'light' ? '浅色' : '深色';
  themeSwitch.setAttribute('aria-label', `当前${theme === 'light' ? '浅色' : '深色'}主题，点击切换`);
  localStorage.setItem(THEME_KEY, theme);
}
const savedTheme = localStorage.getItem(THEME_KEY);
setTheme(savedTheme === 'dark' ? 'dark' : 'light');
themeSwitch.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

const toastContainer = document.getElementById('toast-container') as HTMLDivElement;
function showToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2400);
}

// Tool Views
const viewHttpClient = document.getElementById('view-http-client') as HTMLDivElement;
const viewSqlRestorer = document.getElementById('view-sql-restorer') as HTMLDivElement;
const viewJsonConverter = document.getElementById('view-json-converter') as HTMLDivElement;
const headerTitle = document.getElementById('app-header-title') as HTMLSpanElement;
const headerBadge = document.getElementById('app-header-badge') as HTMLSpanElement;

// Initialize all views once to preserve state
initHttpClient(viewHttpClient, showToast);
initSqlRestorer(document.getElementById('code-panel-sql') as HTMLDivElement, showToast);
initJsonConverter(viewJsonConverter, showToast);
initFileCompare(document.getElementById('code-panel-compare') as HTMLDivElement, showToast);
initCodeGenerator(document.getElementById('code-panel-generator') as HTMLDivElement, showToast);
const codeTabSql = document.getElementById('code-tab-sql') as HTMLButtonElement;
const codeTabCompare = document.getElementById('code-tab-compare') as HTMLButtonElement;
const codeTabGenerator = document.getElementById('code-tab-generator') as HTMLButtonElement;
const codePanelSql = document.getElementById('code-panel-sql') as HTMLDivElement;
const codePanelCompare = document.getElementById('code-panel-compare') as HTMLDivElement;
const codePanelGenerator = document.getElementById('code-panel-generator') as HTMLDivElement;
function switchCodeTab(tab: 'sql' | 'compare' | 'generator') {
  codePanelSql.hidden = tab !== 'sql';
  codePanelCompare.hidden = tab !== 'compare';
  codePanelGenerator.hidden = tab !== 'generator';
  codeTabSql.classList.toggle('active', tab === 'sql');
  codeTabCompare.classList.toggle('active', tab === 'compare');
  codeTabGenerator.classList.toggle('active', tab === 'generator');
  codeTabSql.setAttribute('aria-selected', String(tab === 'sql'));
  codeTabCompare.setAttribute('aria-selected', String(tab === 'compare'));
  codeTabGenerator.setAttribute('aria-selected', String(tab === 'generator'));
}
codeTabSql.onclick = () => switchCodeTab('sql');
codeTabCompare.onclick = () => switchCodeTab('compare');
codeTabGenerator.onclick = () => switchCodeTab('generator');
const viewDownload = document.getElementById('view-download') as HTMLDivElement;
initDownload(viewDownload, showToast);
const viewAiAssistant = document.getElementById('view-ai-assistant') as HTMLDivElement;
initAiAssistant(viewAiAssistant, showToast);
const viewPlugins = document.getElementById('view-plugins') as HTMLDivElement;
initPlugins(viewPlugins, showToast);

// Navigation Switching
const navItems = document.querySelectorAll<HTMLDivElement>('.sidebar-nav .nav-item');

function switchTool(toolId: ToolId) {
  navItems.forEach((item) => {
    if (item.getAttribute('data-tool') === toolId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  const conf = TOOL_CONFIG[toolId];
  headerTitle.textContent = conf.title;
  headerBadge.textContent = conf.badge;

  viewHttpClient.style.display = toolId === 'http-client' ? 'block' : 'none';
  viewSqlRestorer.style.display = toolId === 'sql-restorer' ? 'block' : 'none';
  viewJsonConverter.style.display = toolId === 'json-converter' ? 'block' : 'none';
  viewDownload.style.display = toolId === 'download' ? 'block' : 'none';
  viewAiAssistant.style.display = toolId === 'ai-assistant' ? 'block' : 'none';
  viewPlugins.style.display = toolId === 'plugins' ? 'block' : 'none';
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const tool = item.getAttribute('data-tool') as ToolId;
    if (tool) switchTool(tool);
  });
});


installButtonIcons();
installThemedSelects();
initAutoUpdate(document.getElementById('update-button') as HTMLButtonElement, showToast);
