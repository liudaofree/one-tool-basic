import { createGroupCombobox } from '../utils/group-combobox';
import { createSuggestionPicker } from '../utils/suggestion-picker';
import { parseJsonTree, renderJsonTree } from '../utils/json-response';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  HttpRequestPayload,
  HttpResponsePayload,
  HttpKeyValueItem,
} from '../types/http';
import { parseCurlCommand, generateCurlCommand } from '../utils/curl';
import { Storage } from '../utils/storage';
import { prepareHttpRequest, requestPreview, enabledFormItems } from '../utils/http-request';
import { normalizeDomain } from '../utils/http-cookies';
import { queryFromUrl, updateUrlQuery, urlOnlyPayload } from '../utils/http-query';
import { confirmAction } from '../utils/confirm-dialog';
import { closeContextMenu, showContextMenu } from '../utils/context-menu';
import type { SavedRequest } from '../types/http';

const COMMON_HEADER_SUGGESTIONS = [
  'Accept',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'User-Agent',
  'X-Requested-With',
  'X-Token',
];

export function initHttpClient(container: HTMLElement, showToast: (msg: string) => void) {
  // State
  let currentMethod = 'GET';
  let activeBodyType: 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' = 'json';
  let ignoreSsl = false;
  let isLoading = false;
  let drawerCollapsed = false;
  let currentDrawerTab: 'history' | 'saved' | 'env' = 'history';

  let queryParams: HttpKeyValueItem[] = [{ key: '', value: '', enabled: true }];
  let headers: HttpKeyValueItem[] = [
    { key: 'Accept', value: 'application/json', enabled: true },
    { key: '', value: '', enabled: true },
  ];
  let cookies: HttpKeyValueItem[] = [{ key: '', value: '', enabled: true }];
  let formItems: HttpKeyValueItem[] = [{ key: '', value: '', enabled: true }];
  let bodyContent = '{\n  "message": "hello world"\n}';
  let importedTimeout: number | undefined;
  let lastSentRequest: HttpRequestPayload | undefined;
  let lastResponse: HttpResponsePayload | null = null;
  let activeSavedRequestId: string | null = null;


  // Render Shell
  container.innerHTML = `
    <div class="tool-content-inner http-client-container">
      <div class="http-client-main">
        <!-- Collapsible Left Drawer -->
        <aside id="http-drawer" class="http-drawer">
          <div class="drawer-header">
            <div class="drawer-tabs">
              <button class="drawer-tab active" data-drawertab="history">🕒 历史</button>
              <button class="drawer-tab" data-drawertab="saved">⭐ 收藏</button>
              <button class="drawer-tab" data-drawertab="env">🌐 变量</button>
            </div>
            <button id="btn-drawer-action" class="btn btn-ghost btn-sm" title="清空历史" style="font-size: 11px; padding: 2px 5px;">
              清空
            </button>
          </div>

          <div class="drawer-search-wrap">
            <input type="text" id="drawer-search" class="drawer-search-input" placeholder="搜索 URL / 名称..." />
          </div>

          <div id="drawer-content" class="drawer-content"></div>
        </aside>

        <!-- Main Request & Response Section -->
        <div class="http-main-workspace">
          <!-- Request Bar -->
          <div class="http-request-bar">
            <div class="http-request-primary">
            <button id="btn-toggle-drawer" class="drawer-toggle-btn" title="切换左侧栏">
              <span id="drawer-toggle-icon">◀</span>
            </button>
            <!-- Custom Method Dropdown -->
            <div class="custom-method-dropdown" id="method-dropdown">
              <button type="button" class="method-trigger-btn method-get" id="btn-method-trigger">
                <span class="method-trigger-name" id="method-trigger-name">GET</span>
                <span class="method-trigger-chevron">▾</span>
              </button>
              <div class="method-dropdown-menu" id="method-dropdown-menu">
                <div class="method-option-item method-get active" data-method="GET">
                  <span class="method-badge-pill">GET</span>
                  <span class="method-desc-text">获取数据</span>
                  <span class="method-option-check">✓</span>
                </div>
                <div class="method-option-item method-post" data-method="POST">
                  <span class="method-badge-pill">POST</span>
                  <span class="method-desc-text">新增 / 提交</span>
                  <span class="method-option-check">✓</span>
                </div>
                <div class="method-option-item method-put" data-method="PUT">
                  <span class="method-badge-pill">PUT</span>
                  <span class="method-desc-text">全量更新</span>
                  <span class="method-option-check">✓</span>
                </div>
                <div class="method-option-item method-patch" data-method="PATCH">
                  <span class="method-badge-pill">PATCH</span>
                  <span class="method-desc-text">局部修改</span>
                  <span class="method-option-check">✓</span>
                </div>
                <div class="method-option-item method-delete" data-method="DELETE">
                  <span class="method-badge-pill">DELETE</span>
                  <span class="method-desc-text">删除资源</span>
                  <span class="method-option-check">✓</span>
                </div>
                <div class="method-option-item method-head" data-method="HEAD">
                  <span class="method-badge-pill">HEAD</span>
                  <span class="method-desc-text">仅响应头</span>
                  <span class="method-option-check">✓</span>
                </div>
                <div class="method-option-item method-options" data-method="OPTIONS">
                  <span class="method-badge-pill">OPTIONS</span>
                  <span class="method-desc-text">跨域探测</span>
                  <span class="method-option-check">✓</span>
                </div>
              </div>
            </div>
            <div class="url-input-wrap">
              <input
                type="text"
                id="http-url-input"
                class="http-url-input"
                spellcheck="false"
                placeholder="输入请求 URL 或 {{baseUrl}}/api..."
                value=""
              />
            </div>

            <!-- Custom Environment Dropdown Component -->
            <div class="env-selector-wrapper">
              <div class="custom-env-dropdown" id="env-dropdown">
                <button type="button" class="env-trigger-btn" id="btn-env-trigger" title="选择当前使用的环境变量">
                  <span id="env-trigger-name">🌐 无环境变量</span>
                  <span class="env-trigger-chevron">▾</span>
                </button>
                <div class="env-dropdown-menu" id="env-dropdown-menu">
                  <!-- Dynamically populated options -->
                </div>
              </div>
              <button id="btn-open-env-modal" class="pill-toggle" title="管理环境变量">管理环境</button>
            </div>

            <!-- Send Button -->
            <button id="btn-http-send" class="btn btn-primary btn-send">
              <span>发送请求</span>
            </button>
            </div>

            <div class="http-request-secondary">
            <button id="btn-http-new" class="btn btn-secondary btn-sm http-new-request" type="button" title="开始一个新的空白请求">＋ 新建请求</button>
            <button id="btn-http-save" class="btn btn-secondary btn-sm" title="收藏当前请求">
              <span>收藏</span>
            </button>
            <details class="http-more-actions"><summary>更多操作</summary><div class="http-more-menu">
            <button id="btn-toggle-ssl" class="pill-toggle" title="是否跳过 SSL 证书校验（自签证书/本地测试）">校验 SSL</button>
            <button id="btn-request-preview" class="btn btn-secondary btn-sm">请求预览</button>
            <button id="btn-http-cookies-manage" class="btn btn-secondary btn-sm" title="管理域名 Cookies (类似 Postman Manage Cookies)"><span>Cookie 管理</span></button>
            <button id="btn-http-curl-import" class="btn btn-secondary btn-sm" title="导入 cURL 命令">
              <span>导入 cURL</span>
            </button>
            <button id="btn-http-curl-export" class="btn btn-secondary btn-sm" title="复制为 cURL 命令">
              <span>复制 cURL</span>
            </button>
            <button id="btn-http-clear" class="btn btn-ghost btn-sm" title="清空请求">
              <span>清空请求</span>
            </button>
            </div></details>
            </div>
          </div>


          <!-- Split Workspace -->
          <div class="http-split-workspace">
            <!-- Request Config Section -->
            <section class="http-req-panel">
              <div class="http-tabs-header">
                <button class="tab-btn active" data-tab="params">
                  查询参数 <span id="badge-params-count" class="tab-badge">0</span>
                </button>
                <button class="tab-btn" data-tab="headers">
                  请求头 <span id="badge-headers-count" class="tab-badge">1</span>
                </button>
                <button class="tab-btn" data-tab="cookies">
                  Cookies <span id="badge-cookies-count" class="tab-badge">0</span>
                </button>
                <button class="tab-btn" data-tab="body">
                  请求体 <span id="badge-body-type" class="tab-badge">JSON</span>
                </button>
              </div>

              <div class="http-tabs-body">
                <!-- Params Tab -->
                <div id="tab-content-params" class="tab-pane active">
                  <div class="kv-table-header">
                    <span style="width: 24px"></span>
                    <span style="flex: 1">键</span>
                    <span style="flex: 1">值</span>
                    <span style="width: 26px"></span>
                  </div>
                  <div id="kv-list-params" class="kv-list"></div>
                  <div class="kv-actions">
                    <button id="btn-add-param" class="btn btn-ghost btn-sm">+ 添加参数</button>
                  </div>
                </div>

                <!-- Headers Tab -->
                <div id="tab-content-headers" class="tab-pane">
                  <div class="kv-table-header">
                    <span style="width: 24px"></span>
                    <span style="flex: 1">请求头名称</span>
                    <span style="flex: 1">值</span>
                    <span style="width: 26px"></span>
                  </div>
                  <div id="kv-list-headers" class="kv-list"></div>
                  <div class="kv-actions">
                    <button id="btn-add-header" class="btn btn-ghost btn-sm">+ 添加请求头</button>
                    <div class="preset-group">
                      <span class="preset-label">快捷:</span>
                      <button class="preset-chip" data-header="Content-Type" data-val="application/json">JSON</button>
                      <button class="preset-chip" data-header="Authorization" data-val="Bearer {{token}}">Bearer Token</button>
                    </div>
                  </div>
                </div>

                <!-- Cookies Tab -->
                <div id="tab-content-cookies" class="tab-pane">
                  <div class="kv-table-header">
                    <span style="width: 24px"></span>
                    <span style="flex: 1">Cookie 名称</span>
                    <span style="flex: 1">Cookie 值</span>
                    <span style="width: 26px"></span>
                  </div>
                  <div id="kv-list-cookies" class="kv-list"></div>
                  <div class="kv-actions">
                    <button id="btn-add-cookie" class="btn btn-ghost btn-sm">+ 添加 Cookie</button>
                  </div>
                </div>

                <!-- Body Tab -->
                <div id="tab-content-body" class="tab-pane">
                  <div class="body-type-bar">
                    <label class="radio-label">
                      <input type="radio" name="body-type" value="none" />
                      <span>none</span>
                    </label>
                    <label class="radio-label">
                      <input type="radio" name="body-type" value="json" checked />
                      <span>json</span>
                    </label>
                    <label class="radio-label">
                      <input type="radio" name="body-type" value="form-data" />
                      <span>form-data</span>
                    </label>
                    <label class="radio-label">
                      <input type="radio" name="body-type" value="x-www-form-urlencoded" />
                      <span>x-www-form-urlencoded</span>
                    </label>
                    <label class="radio-label">
                      <input type="radio" name="body-type" value="raw" />
                      <span>raw</span>
                    </label>
                    <div style="flex: 1"></div>
                    <button id="btn-format-json" class="btn btn-secondary btn-sm" style="display: inline-flex;">
                      <span>⚡ 格式化 JSON</span>
                    </button>
                  </div>

                  <div id="body-editor-wrap" class="body-editor-wrap">
                    <textarea
                      id="body-textarea"
                      class="body-textarea"
                      spellcheck="false"
                      placeholder="在此输入 JSON 文本，支持 {{var}} 环境变量替换..."
                    ></textarea>
                    <div id="body-kv-container" class="body-kv-container" style="display: none;">
                      <div class="kv-table-header">
                        <span style="width: 24px"></span>
                        <span style="flex: 1">字段名</span>
                        <span style="flex: 1">值</span>
                        <span style="width: 26px"></span>
                      </div>
                      <div id="kv-list-form" class="kv-list"></div>
                      <div class="kv-actions">
                        <button id="btn-add-form" class="btn btn-ghost btn-sm">+ 添加字段</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Response Panel -->
            <section class="http-resp-panel">
              <div class="http-resp-header">
                <div class="resp-tabs">
                  <button class="resp-tab-btn active" data-resptab="body">响应体</button>
                  <button class="resp-tab-btn" data-resptab="headers">
                    响应头 <span id="badge-resp-headers-count" class="tab-badge" style="display: none;">0</span>
                  </button>
                </div>
                <div id="resp-meta-info" class="resp-meta-info" style="display: none;">
                  <span id="meta-status" class="meta-tag status-200">200 OK</span>
                  <span id="meta-time" class="meta-tag">⚡ 0 ms</span>
                  <span id="meta-size" class="meta-tag">📦 0 B</span>
                  <button id="btn-copy-resp" class="btn btn-secondary btn-sm">📋 复制</button>
                </div>
              </div>

              <div class="http-resp-body">
                <div id="resp-view-body" class="resp-view-content active">
                  <div id="resp-empty" class="resp-empty-state">
                    <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="7" y="10" width="34" height="28" rx="5"/><path d="m17 19 5 5-5 5m9 0h7"/></svg></div>
                    <strong>响应将在这里显示</strong>
                    <p>输入 URL 并发送请求，查看状态、响应体和响应头。</p>
                    <button id="btn-test-sample" class="btn btn-secondary btn-sm">
                      试试 GitHub API 示例
                    </button>
                  </div>
                  <div id="resp-loading" class="resp-loading-state" style="display: none;">
                    <div class="spinner"></div>
                    <p>请求发送中...</p>
                  </div>
                  <div id="resp-error" class="resp-error-state" style="display: none;">
                    <div class="error-icon">❌</div>
                    <p id="resp-error-text" class="error-msg"></p>
                  </div>
                  <div id="resp-json-toolbar" class="resp-json-toolbar" style="display:none;">
                    <button id="btn-resp-expand" class="btn btn-ghost btn-sm">全部展开</button>
                    <button id="btn-resp-collapse" class="btn btn-ghost btn-sm">全部折叠</button>
                    <button id="btn-resp-raw" class="btn btn-secondary btn-sm">查看原文</button>
                    <span>点击对象或数组左侧箭头可折叠；复制保留完整响应</span>
                  </div>
                  <div id="resp-json-tree" class="resp-json-tree" style="display:none;"></div>
                  <pre id="resp-content" class="resp-content" style="display: none;"><code></code></pre>
                </div>

                <div id="resp-view-headers" class="resp-view-content" style="display: none;">
                  <div id="resp-headers-table" class="resp-headers-table"></div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <!-- cURL Import Modal -->
      <div id="curl-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <h3>📥 导入 cURL 命令行</h3>
            <button class="btn-close modal-close-btn">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-tip">可直接粘贴来自 Chrome 开发者工具或服务端的 cURL 命令：</p>
            <textarea
              id="curl-textarea"
              class="curl-textarea"
              spellcheck="false"
              placeholder="curl -X POST 'https://api.example.com/v1/users' -H 'Content-Type: application/json' -d '{&quot;name&quot;: &quot;alice&quot;}'"
            ></textarea>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost modal-close-btn">取消</button>
            <button id="btn-confirm-curl" class="btn btn-primary">解析并填充</button>
          </div>
        </div>
      </div>

      <!-- Save Request Modal -->
      <div id="save-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <h3>保存/命名接口请求</h3>
            <button class="btn-close modal-close-btn">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-tip">接口名称：</p>
            <input type="text" id="save-name-input" class="modal-input" placeholder="如：获取用户信息 / 登录接口" />
            <p class="modal-tip" style="margin-top: 12px;">所属分组：</p>
            <div class="group-combobox"><input type="text" id="save-group-input" class="modal-input" role="combobox" aria-autocomplete="list" aria-controls="save-group-options" aria-expanded="false" aria-label="所属分组" placeholder="选择或输入分组" value="默认分组" /><button id="save-group-trigger" class="group-combobox-trigger" type="button" aria-label="选择已有分组">⌄</button><div id="save-group-options" class="group-combobox-options" role="listbox" hidden></div></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost modal-close-btn">取消</button>
            <button id="btn-confirm-save" class="btn btn-primary">确认保存</button>
          </div>
        </div>
      </div>

      <!-- Env Manager Modal (Multi-Environment Groups Support) -->
      <div id="env-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card" style="max-width: 760px; width: 94%;">
          <div class="modal-header">
            <h3>🌐 管理环境变量分组</h3>
            <button class="btn-close modal-close-btn">✕</button>
          </div>
          <div class="modal-body" style="padding: 0; display: flex; min-height: 380px;">
            <!-- Left Pane: Environment Group List -->
            <div style="width: 210px; background-color: var(--bg-surface-hover); border-right: 1px solid var(--border); display: flex; flex-direction: column;">
              <div style="padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 11.5px; font-weight: 600; color: var(--text-dim); text-transform: uppercase;">环境分组</span>
                <button id="btn-create-new-env" class="btn btn-ghost btn-sm" title="新增环境分组" style="padding: 2px 6px; font-size: 11px;">
                  + 新增
                </button>
              </div>
              <div id="env-group-nav-list" style="flex: 1; overflow-y: auto; padding: 6px;">
                <!-- Dynamically populated environment list -->
              </div>
            </div>

            <!-- Right Pane: Variables Editor -->
            <div style="flex: 1; display: flex; flex-direction: column; padding: 16px 20px; overflow-y: auto;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 15px;">🌐</span>
                  <input type="text" id="input-edit-env-name" class="modal-input" style="font-weight: 600; font-size: 14px; width: 220px; padding: 4px 8px;" placeholder="环境名称" />
                </div>
                <button id="btn-delete-current-env" class="btn btn-ghost btn-sm" style="color: var(--danger); font-size: 11.5px;">
                  删除环境
                </button>
              </div>

              <p class="modal-tip" style="margin-bottom: 10px;">
                在接口 URL、请求头、Cookie 或请求体中输入 <code>{{变量名}}</code>，发送请求时自动替换：
              </p>
              <div id="env-kv-list" class="kv-list" style="max-height: 240px; margin-bottom: 10px;"></div>
              <div>
                <button id="btn-add-env-var" class="btn btn-ghost btn-sm">+ 添加变量</button>
              </div>
            </div>
          </div>
          <div class="modal-footer" style="padding: 12px 20px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn btn-secondary modal-close-btn">关闭</button>
            <button id="btn-save-env" class="btn btn-primary">保存变量</button>
          </div>
        </div>
      </div>



      <!-- Manage Cookies Modal (Postman Style) -->
      <div id="cookies-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card" style="max-width: 680px; width: 92%;">
          <div class="modal-header">
            <h3>🍪 MANAGE COOKIES</h3>
            <button class="btn-close modal-close-btn">✕</button>
          </div>
          <div class="modal-body cookie-manage-layout" style="padding: 18px 20px;">
            <!-- Add Domain Input Bar -->
            <div class="cookie-add-domain-bar">
              <span style="font-size: 14px; opacity: 0.6;">🌐</span>
              <input type="text" id="input-cookie-domain" class="cookie-domain-input" placeholder="Type a domain name (如: localhost 或 api.example.com)" />
              <button id="btn-add-domain" class="btn-postman-orange">Add</button>
            </div>

            <!-- Domain Cookie List -->
            <div id="domain-cookies-container" class="domain-cookies-container" style="max-height: 380px; overflow-y: auto;">
              <!-- Dynamically populated -->
            </div>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px;">
            <button id="btn-clear-all-cookies" class="btn btn-ghost btn-sm" style="color: var(--danger);">🗑️ 清空所有 Cookies</button>
            <button class="btn btn-secondary modal-close-btn">关闭</button>
          </div>
        </div>
      </div>

    </div>
  `;


  // Selectors
  const drawer = container.querySelector('#http-drawer') as HTMLElement;
  const btnToggleDrawer = container.querySelector('#btn-toggle-drawer') as HTMLButtonElement;
  const drawerToggleIcon = container.querySelector('#drawer-toggle-icon') as HTMLSpanElement;
  const drawerTabs = container.querySelectorAll('.drawer-tab');
  const drawerSearch = container.querySelector('#drawer-search') as HTMLInputElement;
  const drawerContent = container.querySelector('#drawer-content') as HTMLDivElement;
  const btnDrawerAction = container.querySelector('#btn-drawer-action') as HTMLButtonElement;
  const methodDropdown = container.querySelector('#method-dropdown') as HTMLDivElement;
  const btnMethodTrigger = container.querySelector('#btn-method-trigger') as HTMLButtonElement;
  const methodTriggerName = container.querySelector('#method-trigger-name') as HTMLSpanElement;
  const methodOptionItems = container.querySelectorAll<HTMLDivElement>('.method-option-item');
  const urlInput = container.querySelector('#http-url-input') as HTMLInputElement;
  const envDropdown = container.querySelector('#env-dropdown') as HTMLDivElement;
  const btnEnvTrigger = container.querySelector('#btn-env-trigger') as HTMLButtonElement;
  const envTriggerName = container.querySelector('#env-trigger-name') as HTMLSpanElement;
  const envDropdownMenu = container.querySelector('#env-dropdown-menu') as HTMLDivElement;
  const btnOpenEnvModal = container.querySelector('#btn-open-env-modal') as HTMLButtonElement;
  const btnToggleSsl = container.querySelector('#btn-toggle-ssl') as HTMLButtonElement;
  const btnSend = container.querySelector('#btn-http-send') as HTMLButtonElement;
  const btnSave = container.querySelector('#btn-http-save') as HTMLButtonElement;
  const btnCurlImport = container.querySelector('#btn-http-curl-import') as HTMLButtonElement;
  const btnCurlExport = container.querySelector('#btn-http-curl-export') as HTMLButtonElement;
  const btnClear = container.querySelector('#btn-http-clear') as HTMLButtonElement;
  const btnNew = container.querySelector('#btn-http-new') as HTMLButtonElement;

  const reqTabButtons = container.querySelectorAll('.http-tabs-header .tab-btn');
  const tabContentParams = container.querySelector('#tab-content-params') as HTMLDivElement;
  const tabContentHeaders = container.querySelector('#tab-content-headers') as HTMLDivElement;
  const tabContentCookies = container.querySelector('#tab-content-cookies') as HTMLDivElement;
  const tabContentBody = container.querySelector('#tab-content-body') as HTMLDivElement;

  const kvListParams = container.querySelector('#kv-list-params') as HTMLDivElement;
  const kvListHeaders = container.querySelector('#kv-list-headers') as HTMLDivElement;
  const kvListCookies = container.querySelector('#kv-list-cookies') as HTMLDivElement;
  const kvListForm = container.querySelector('#kv-list-form') as HTMLDivElement;

  const btnAddParam = container.querySelector('#btn-add-param') as HTMLButtonElement;
  const btnAddHeader = container.querySelector('#btn-add-header') as HTMLButtonElement;
  const btnAddCookie = container.querySelector('#btn-add-cookie') as HTMLButtonElement;
  const btnAddForm = container.querySelector('#btn-add-form') as HTMLButtonElement;

  const badgeParamsCount = container.querySelector('#badge-params-count') as HTMLSpanElement;
  const badgeHeadersCount = container.querySelector('#badge-headers-count') as HTMLSpanElement;
  const badgeCookiesCount = container.querySelector('#badge-cookies-count') as HTMLSpanElement;
  const badgeBodyType = container.querySelector('#badge-body-type') as HTMLSpanElement;

  const bodyRadios = container.querySelectorAll<HTMLInputElement>('input[name="body-type"]');
  const bodyTextarea = container.querySelector('#body-textarea') as HTMLTextAreaElement;
  const bodyKvContainer = container.querySelector('#body-kv-container') as HTMLDivElement;
  const btnFormatJson = container.querySelector('#btn-format-json') as HTMLButtonElement;

  const respTabButtons = container.querySelectorAll('.resp-tab-btn');
  const respViewBody = container.querySelector('#resp-view-body') as HTMLDivElement;
  const respViewHeaders = container.querySelector('#resp-view-headers') as HTMLDivElement;
  const respMetaInfo = container.querySelector('#resp-meta-info') as HTMLDivElement;
  const metaStatus = container.querySelector('#meta-status') as HTMLSpanElement;
  const metaTime = container.querySelector('#meta-time') as HTMLSpanElement;
  const metaSize = container.querySelector('#meta-size') as HTMLSpanElement;
  const badgeRespHeadersCount = container.querySelector('#badge-resp-headers-count') as HTMLSpanElement;
  const btnCopyResp = container.querySelector('#btn-copy-resp') as HTMLButtonElement;

  const respEmpty = container.querySelector('#resp-empty') as HTMLDivElement;
  const respLoading = container.querySelector('#resp-loading') as HTMLDivElement;
  const respError = container.querySelector('#resp-error') as HTMLDivElement;
  const respErrorText = container.querySelector('#resp-error-text') as HTMLParagraphElement;
  const respContent = container.querySelector('#resp-content') as HTMLPreElement;
  const respJsonToolbar = container.querySelector<HTMLElement>('#resp-json-toolbar')!;
  const respJsonTree = container.querySelector<HTMLElement>('#resp-json-tree')!;
  const btnRespRaw = container.querySelector<HTMLButtonElement>('#btn-resp-raw')!;
  const btnRespExpand = container.querySelector<HTMLButtonElement>('#btn-resp-expand')!;
  const btnRespCollapse = container.querySelector<HTMLButtonElement>('#btn-resp-collapse')!;
  let responseTree: ReturnType<typeof renderJsonTree> | undefined;
  let showingRaw = false;
  btnRespExpand.addEventListener('click', () => responseTree?.expandAll());
  btnRespCollapse.addEventListener('click', () => responseTree?.collapseAll());
  btnRespRaw.addEventListener('click', () => {
    showingRaw = !showingRaw;
    respJsonTree.style.display = showingRaw ? 'none' : 'block';
    respContent.style.display = showingRaw ? 'block' : 'none';
    btnRespRaw.textContent = showingRaw ? '返回折叠视图' : '查看原文';
    btnRespExpand.disabled = showingRaw; btnRespCollapse.disabled = showingRaw;
  });
  const respHeadersTable = container.querySelector('#resp-headers-table') as HTMLDivElement;
  const btnTestSample = container.querySelector('#btn-test-sample') as HTMLButtonElement;

  const curlModal = container.querySelector('#curl-modal') as HTMLDivElement;
  const curlTextarea = container.querySelector('#curl-textarea') as HTMLTextAreaElement;
  const btnConfirmCurl = container.querySelector('#btn-confirm-curl') as HTMLButtonElement;

  const saveModal = container.querySelector('#save-modal') as HTMLDivElement;
  const saveNameInput = container.querySelector('#save-name-input') as HTMLInputElement;
  const saveGroupInput = container.querySelector('#save-group-input') as HTMLInputElement;
  const saveGroupMenu = container.querySelector('#save-group-options') as HTMLDivElement;
  const saveGroupTrigger = container.querySelector('#save-group-trigger') as HTMLButtonElement;
  const btnConfirmSave = container.querySelector('#btn-confirm-save') as HTMLButtonElement;

  const envModal = container.querySelector('#env-modal') as HTMLDivElement;
  const btnCreateNewEnv = container.querySelector('#btn-create-new-env') as HTMLButtonElement;
  const envGroupNavList = container.querySelector('#env-group-nav-list') as HTMLDivElement;
  const inputEditEnvName = container.querySelector('#input-edit-env-name') as HTMLInputElement;
  const btnDeleteCurrentEnv = container.querySelector('#btn-delete-current-env') as HTMLButtonElement;
  const envKvList = container.querySelector('#env-kv-list') as HTMLDivElement;
  const btnAddEnvVar = container.querySelector('#btn-add-env-var') as HTMLButtonElement;
  const btnSaveEnv = container.querySelector('#btn-save-env') as HTMLButtonElement;


  const btnManageCookies = container.querySelector('#btn-http-cookies-manage') as HTMLButtonElement;
  const cookiesModal = container.querySelector('#cookies-modal') as HTMLDivElement;
  const inputCookieDomain = container.querySelector('#input-cookie-domain') as HTMLInputElement;
  const btnAddDomain = container.querySelector('#btn-add-domain') as HTMLButtonElement;
  const domainCookiesContainer = container.querySelector('#domain-cookies-container') as HTMLDivElement;
  const btnClearAllCookies = container.querySelector('#btn-clear-all-cookies') as HTMLButtonElement;

  function showConfirmDialog(options: {
    title?: string;
    message: string;
    okText?: string;
    onConfirm: () => void;
  }) {
    void confirmAction({ title: options.title || '操作确认', message: options.message, confirmText: options.okText || '确定删除', destructive: true })
      .then(confirmed => { if (confirmed) options.onConfirm(); });
  }



  // Drawer Toggle
  btnToggleDrawer.addEventListener('click', () => {
    drawerCollapsed = !drawerCollapsed;
    drawer.classList.toggle('collapsed', drawerCollapsed);
    drawerToggleIcon.textContent = drawerCollapsed ? '▶' : '◀';
  });

  // Drawer Tabs
  drawerTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      drawerTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentDrawerTab = tab.getAttribute('data-drawertab') as any;

      if (currentDrawerTab === 'history') {
        btnDrawerAction.textContent = '清空';
        btnDrawerAction.style.display = 'block';
      } else if (currentDrawerTab === 'saved') {
        btnDrawerAction.textContent = '新建';
        btnDrawerAction.style.display = 'block';
      } else {
        btnDrawerAction.textContent = '编辑';
        btnDrawerAction.style.display = 'block';
      }

      renderDrawerContent();
    });
  });

  btnDrawerAction.addEventListener('click', () => {
    if (currentDrawerTab === 'history') {
      Storage.clearHistory();
      renderDrawerContent();
      showToast('历史记录已清空');
    } else if (currentDrawerTab === 'saved') {
      openSaveModal(true);
    } else if (currentDrawerTab === 'env') {
      openEnvModal();
    }
  });

  drawerSearch.addEventListener('input', () => {
    renderDrawerContent();
  });

  const editSavedRequest = (item: SavedRequest) => {
    closeContextMenu();
    loadPayloadIntoUi(item.payload, item.id);
    showToast(`正在编辑「${item.name}」，修改后点击“保存修改”`);
    urlInput.focus();
  };
  const deleteSavedRequest = async (item: SavedRequest) => {
    closeContextMenu();
    if (!await confirmAction({ title: '删除收藏的请求', message: `确定删除「${item.name}」吗？`, confirmText: '删除请求', destructive: true })) return;
    Storage.deleteSavedRequest(item.id);
    if (activeSavedRequestId === item.id) setActiveSavedRequest(null);
    renderDrawerContent();
    showToast(`已删除接口: ${item.name}`);
  };
  const openSavedContextMenu = (event: MouseEvent, item: SavedRequest) => {
    showContextMenu(event, [
      { label: '编辑请求', action: () => editSavedRequest(item) },
      { label: '删除收藏', action: () => deleteSavedRequest(item), danger: true },
    ]);
  };

  function renderDrawerContent() {
    const query = drawerSearch.value.trim().toLowerCase();

    if (currentDrawerTab === 'history') {
      const history = Storage.getHistory();
      const filtered = query
        ? history.filter((h) => h.url.toLowerCase().includes(query) || h.method.toLowerCase().includes(query))
        : history;

      if (filtered.length === 0) {
        drawerContent.innerHTML = `<div class="drawer-empty">${query ? '无匹配的历史记录' : '暂无请求历史'}</div>`;
        return;
      }

      drawerContent.innerHTML = '';
      filtered.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'drawer-item';
        const methodClass = item.method.toLowerCase();
        const statusClass = item.status >= 200 && item.status < 300 ? 'status-200' : 'status-400';
        const timeAgo = formatTimeAgo(item.timestamp);

        div.innerHTML = `
          <div class="drawer-item-top">
            <div class="drawer-item-badges">
              <span class="drawer-method method-${methodClass}">${item.method}</span>
              <span class="drawer-status ${statusClass}">${item.status || 'ERR'}</span>
            </div>
            <span class="drawer-time">${timeAgo}</span>
          </div>
          <div class="drawer-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
          <button class="drawer-del-btn" title="删除此条">✕</button>
        `;

        div.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).classList.contains('drawer-del-btn')) return;
          loadPayloadIntoUi(item.payload);
          showToast(`已载入历史: ${item.method} ${item.url}`);
        });

        div.querySelector('.drawer-del-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          Storage.deleteHistoryItem(item.id);
          renderDrawerContent();
        });

        div.addEventListener('contextmenu', event => showContextMenu(event, [
          { label: '载入请求', action: () => { loadPayloadIntoUi(item.payload); showToast(`已载入历史: ${item.method} ${item.url}`); } },
          { label: '删除记录', action: () => { Storage.deleteHistoryItem(item.id); renderDrawerContent(); }, danger: true },
        ]));

        drawerContent.appendChild(div);
      });
    } else if (currentDrawerTab === 'saved') {
      const saved = Storage.getSavedRequests();
      const filtered = query
        ? saved.filter((s) => s.name.toLowerCase().includes(query) || (s.group && s.group.toLowerCase().includes(query)) || s.payload.url.toLowerCase().includes(query))
        : saved;

      if (filtered.length === 0) {
        drawerContent.innerHTML = `
          <div class="drawer-empty">
            <p>${query ? '无匹配的接口请求' : '暂无保存的接口请求'}</p>
            <button id="btn-drawer-add-save" class="btn btn-secondary btn-sm" style="margin-top: 8px;">
              ⭐ 保存当前接口
            </button>
          </div>
        `;
        drawerContent.querySelector('#btn-drawer-add-save')?.addEventListener('click', () => openSaveModal(true));
        return;
      }

      // Group saved requests by group name
      const groupedMap = new Map<string, typeof filtered>();
      filtered.forEach((item) => {
        const groupName = item.group?.trim() || '默认分组';
        if (!groupedMap.has(groupName)) {
          groupedMap.set(groupName, []);
        }
        groupedMap.get(groupName)!.push(item);
      });

      drawerContent.innerHTML = '';
      groupedMap.forEach((items, groupName) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'drawer-group';

        const headerEl = document.createElement('div');
        headerEl.className = 'drawer-group-header';
        headerEl.innerHTML = `
          <div class="drawer-group-left">
            <span class="drawer-group-chevron">▼</span>
            <span class="drawer-group-title" title="${escapeHtml(groupName)}">📁 ${escapeHtml(groupName)}</span>
          </div>
          <span class="drawer-group-count">${items.length}</span>
        `;

        headerEl.addEventListener('click', () => {
          groupEl.classList.toggle('collapsed');
        });

        const bodyEl = document.createElement('div');
        bodyEl.className = 'drawer-group-body';

        items.forEach((item) => {
          const div = document.createElement('div');
          div.className = `drawer-item${activeSavedRequestId === item.id ? ' selected' : ''}`;
          div.dataset.savedId = item.id;
          const methodClass = item.payload.method.toLowerCase();

          div.innerHTML = `
            <div class="drawer-item-top">
              <div class="drawer-item-badges">
                <span class="drawer-method method-${methodClass}">${item.payload.method}</span>
                <span style="font-size: 11.5px; font-weight: 600; color: var(--text-main);">${escapeHtml(item.name)}</span>
              </div>
            </div>
            <div class="drawer-url" title="${escapeHtml(item.payload.url)}">${escapeHtml(item.payload.url)}</div>
            <div class="drawer-item-actions">
              <button class="drawer-action-icon-btn btn-edit-item" type="button" title="编辑请求" aria-label="编辑请求">编辑</button>
              <button class="drawer-action-icon-btn danger btn-del-item" type="button" title="删除收藏" aria-label="删除收藏">✕</button>
            </div>
          `;

          div.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.drawer-item-actions')) return;
            loadPayloadIntoUi(item.payload, item.id);
            showToast(`已载入接口: ${item.name}`);
          });

          div.addEventListener('contextmenu', event => openSavedContextMenu(event, item));

          div.querySelector('.btn-edit-item')?.addEventListener('click', (e) => {
            e.stopPropagation();
            editSavedRequest(item);
          });

          div.querySelector('.btn-del-item')?.addEventListener('click', (e) => {
            e.stopPropagation();
            void deleteSavedRequest(item);
          });

          bodyEl.appendChild(div);
        });

        groupEl.appendChild(headerEl);
        groupEl.appendChild(bodyEl);
        drawerContent.appendChild(groupEl);
      });

    } else if (currentDrawerTab === 'env') {
      const envs = Storage.getEnvironments();
      const activeId = Storage.getActiveEnvId();
      const activeEnv = envs.find((e) => e.id === activeId);

      drawerContent.innerHTML = `
        <div style="padding: 6px;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">
            当前环境: ${activeEnv ? activeEnv.name : '无环境变量'}
          </div>
          <div class="drawer-item" style="cursor: default;">
            ${
              activeEnv && Object.keys(activeEnv.variables).length > 0
                ? Object.entries(activeEnv.variables)
                    .map(
                      ([k, v]) => `
                      <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                        <span style="color: var(--primary); font-family: var(--font-mono); font-weight: 600;">{{${escapeHtml(k)}}}</span>
                        <span style="color: var(--text-dim); max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(v)}</span>
                      </div>
                    `
                    )
                    .join('')
                : '<p style="font-size: 11.5px; color: var(--text-dim);">当前环境未定义变量</p>'
            }
          </div>
          <button id="btn-drawer-manage-env" class="btn btn-secondary btn-sm" style="width: 100%; margin-top: 10px;">
            ⚙️ 配置环境变量
          </button>
        </div>
      `;

      drawerContent.querySelector('#btn-drawer-manage-env')?.addEventListener('click', openEnvModal);
    }
  }

  function formatTimeAgo(timestamp: number): string {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return `${diff}s前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h前`;
    return `${Math.floor(diff / 86400)}d前`;
  }

  function setActiveSavedRequest(id: string | null) {
    activeSavedRequestId = id;
    const label = btnSave.querySelector('span');
    if (label) label.textContent = id ? '保存修改' : '收藏';
    btnSave.title = id ? '保存对当前收藏请求的修改' : '收藏当前请求';
    drawerContent.querySelectorAll<HTMLElement>('.drawer-item').forEach(row => row.classList.toggle('selected', row.dataset.savedId === id && id !== null));
  }

  function loadPayloadIntoUi(payload: HttpRequestPayload, savedId: string | null = null) {
    setActiveSavedRequest(savedId);
    importedTimeout = payload.timeout_seconds;
    ignoreSsl = payload.ignore_ssl ?? false;
    btnToggleSsl.innerHTML = ignoreSsl ? '<span>🔓 忽略 SSL</span>' : '<span>🔒 校验 SSL</span>';

    if (payload.method) {
      setMethod(payload.method);
    }
    if (payload.url !== undefined) {
      urlInput.value = payload.url;
    }
    if (payload.headers) {
      headers = payload.headers;
      renderKvList(kvListHeaders, headers, updateHeaderCountBadge, COMMON_HEADER_SUGGESTIONS);
    }
    cookies = payload.cookies ?? [{ key: '', value: '', enabled: true }];
    renderKvList(kvListCookies, cookies, updateCookieCountBadge);
    if (payload.params) {
      queryParams = payload.params;
      renderKvList(kvListParams, queryParams, onParamsChange);
      onParamsChange();
    } else {
      syncUrlToParams();
    }
    if (payload.body_type) {
      activeBodyType = payload.body_type as any;
      bodyRadios.forEach((r) => {
        r.checked = r.value === activeBodyType;
      });
      badgeBodyType.textContent = activeBodyType.toUpperCase();
      updateBodyVisibility();
    }
    bodyTextarea.value = payload.body_content ?? '';
    formItems = payload.form_data ?? [{ key: '', value: '', enabled: true }];
    renderKvList(kvListForm, formItems, () => {});
  }

  // Populate Environments Selector (Custom Dropdown)
  function updateEnvSelector() {
    const envs = Storage.getEnvironments();
    const activeId = Storage.getActiveEnvId();
    const activeEnv = envs.find((e) => e.id === activeId);

    // 更新触发按钮文字与状态
    if (activeEnv) {
      envTriggerName.textContent = `🌐 ${activeEnv.name}`;
      btnEnvTrigger.classList.add('active');
    } else {
      envTriggerName.textContent = '🌐 无环境变量';
      btnEnvTrigger.classList.remove('active');
    }

    // 渲染下拉菜单项
    envDropdownMenu.innerHTML = '';

    // 选项 1: 无环境变量
    const noneItem = document.createElement('div');
    noneItem.className = `env-option-item ${!activeId ? 'active' : ''}`;
    noneItem.innerHTML = `
      <span>🌐 无环境变量</span>
      <span class="env-option-check">✓</span>
    `;
    noneItem.addEventListener('click', (e) => {
      e.stopPropagation();
      Storage.setActiveEnvId('');
      updateEnvSelector();
      envDropdown.classList.remove('open');
      showToast('已切换至: 无环境变量');
      if (currentDrawerTab === 'env') renderDrawerContent();
    });
    envDropdownMenu.appendChild(noneItem);

    // 各环境选项
    envs.forEach((env) => {
      const isCurrent = env.id === activeId;
      const optItem = document.createElement('div');
      optItem.className = `env-option-item ${isCurrent ? 'active' : ''}`;
      optItem.innerHTML = `
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">🌐 ${escapeHtml(env.name)}</span>
        <span class="env-option-check">✓</span>
      `;
      optItem.addEventListener('click', (e) => {
        e.stopPropagation();
        Storage.setActiveEnvId(env.id);
        updateEnvSelector();
        envDropdown.classList.remove('open');
        showToast(`已切换环境: ${env.name}`);
        if (currentDrawerTab === 'env') renderDrawerContent();
      });
      envDropdownMenu.appendChild(optItem);
    });
  }

  // 展开 / 收起环境下拉菜单
  btnEnvTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    // 互斥关闭 method dropdown
    methodDropdown.classList.remove('open');
    envDropdown.classList.toggle('open');
  });

  // 点击环境选择框旁边的 ⚙️ 图标直接打开弹窗
  btnOpenEnvModal?.addEventListener('click', openEnvModal);

  // SSL Verification Toggle
  btnToggleSsl.addEventListener('click', () => {
    ignoreSsl = !ignoreSsl;
    btnToggleSsl.classList.toggle('active', ignoreSsl);
    btnToggleSsl.innerHTML = ignoreSsl
      ? '<span>🔓 忽略 SSL</span>'
      : '<span>🔒 校验 SSL</span>';
    showToast(ignoreSsl ? '已开启：跳过 SSL 证书校验' : '已关闭：正常校验 SSL 证书');
  });

  // Custom Method Dropdown Handling
  function setMethod(method: string) {
    currentMethod = method.toUpperCase();
    methodTriggerName.textContent = currentMethod;
    btnMethodTrigger.className = `method-trigger-btn method-${currentMethod.toLowerCase()}`;

    methodOptionItems.forEach((item) => {
      const m = item.getAttribute('data-method');
      if (m === currentMethod) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  btnMethodTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    envDropdown.classList.remove('open');
    methodDropdown.classList.toggle('open');
  });

  methodOptionItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = item.getAttribute('data-method');
      if (m) {
        setMethod(m);
        methodDropdown.classList.remove('open');
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!methodDropdown.contains(e.target as Node)) {
      methodDropdown.classList.remove('open');
    }
    if (!envDropdown.contains(e.target as Node)) {
      envDropdown.classList.remove('open');
    }
  });

  setMethod(currentMethod);

  // Key-Value Table rendering
  const headerSuggestionPicker = createSuggestionPicker();
  function renderKvList(
    containerEl: HTMLElement,
    items: HttpKeyValueItem[],
    onUpdate: () => void,
    suggestions: string[] = []
  ) {
    containerEl.innerHTML = '';
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'kv-row';

      row.innerHTML = `
        <label class="kv-checkbox">
          <input type="checkbox" ${item.enabled ? 'checked' : ''} />
        </label>
        <div class="kv-input-cell">
          <input
            type="text"
            class="kv-input key-input"
            placeholder="键"
            value="${escapeHtml(item.key)}"
            ${suggestions.length > 0 ? 'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-label="请求头名称"' : ''}
          />
        </div>
        <div class="kv-input-cell">
          <input
            type="text"
            class="kv-input val-input"
            placeholder="值"
            value="${escapeHtml(item.value)}"
          />
        </div>
        <button class="btn-kv-del" title="删除">✕</button>
      `;

      const chk = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      const keyInput = row.querySelector<HTMLInputElement>('.key-input')!;
      const valInput = row.querySelector<HTMLInputElement>('.val-input')!;
      const delBtn = row.querySelector<HTMLButtonElement>('.btn-kv-del')!;
      if (suggestions.length > 0) headerSuggestionPicker.attach(keyInput, suggestions);

      chk.addEventListener('change', () => {
        item.enabled = chk.checked;
        onUpdate();
      });

      keyInput.addEventListener('input', () => {
        item.key = keyInput.value;
        onUpdate();
      });

      valInput.addEventListener('input', () => {
        item.value = valInput.value;
        onUpdate();
      });

      delBtn.addEventListener('click', () => {
        items.splice(index, 1);
        if (items.length === 0) {
          items.push({ key: '', value: '', enabled: true });
        }
        renderAllKv();
        onUpdate();
      });

      containerEl.appendChild(row);
    });
  }

  function renderAllKv() {
    renderKvList(kvListParams, queryParams, onParamsChange);
    renderKvList(kvListHeaders, headers, updateHeaderCountBadge, COMMON_HEADER_SUGGESTIONS);
    renderKvList(kvListCookies, cookies, updateCookieCountBadge);
    renderKvList(kvListForm, formItems, () => {});
    updateParamCountBadge();
    updateHeaderCountBadge();
    updateCookieCountBadge();
  }

  function updateParamCountBadge() {
    const count = queryParams.filter((p) => p.enabled && p.key.trim()).length;
    badgeParamsCount.textContent = count.toString();
  }

  function updateHeaderCountBadge() {
    const count = headers.filter((h) => h.enabled && h.key.trim()).length;
    badgeHeadersCount.textContent = count.toString();
  }

  function onParamsChange() {
    updateParamCountBadge();
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) return;

    try {
      urlInput.value = updateUrlQuery(rawUrl, queryParams);
    } catch {}
  }

  function syncUrlToParams() {
    const rawUrl = urlInput.value.trim();
    const newParams = queryFromUrl(rawUrl);

    if (newParams.length === 0) {
      newParams.push({ key: '', value: '', enabled: true });
    }

    queryParams = newParams;
    renderKvList(kvListParams, queryParams, onParamsChange);
    updateParamCountBadge();
  }

  urlInput.addEventListener('change', syncUrlToParams);

  btnAddParam.addEventListener('click', () => {
    queryParams.push({ key: '', value: '', enabled: true });
    renderKvList(kvListParams, queryParams, onParamsChange);
  });

  btnAddHeader.addEventListener('click', () => {
    headers.push({ key: '', value: '', enabled: true });
    renderKvList(kvListHeaders, headers, updateHeaderCountBadge, COMMON_HEADER_SUGGESTIONS);
  });

  btnAddForm.addEventListener('click', () => {
    formItems.push({ key: '', value: '', enabled: true });
    renderKvList(kvListForm, formItems, () => {});
  });

  container.querySelectorAll('.preset-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hKey = btn.getAttribute('data-header') || '';
      const hVal = btn.getAttribute('data-val') || '';
      const existing = headers.find((h) => h.key.toLowerCase() === hKey.toLowerCase());
      if (existing) {
        existing.value = hVal;
        existing.enabled = true;
      } else {
        headers.unshift({ key: hKey, value: hVal, enabled: true });
      }
      renderKvList(kvListHeaders, headers, updateHeaderCountBadge, COMMON_HEADER_SUGGESTIONS);
      showToast(`已添加 Header: ${hKey}`);
    });
  });

  function updateCookieCountBadge() {
    const count = cookies.filter((c) => c.enabled && c.key.trim()).length;
    badgeCookiesCount.textContent = count.toString();
  }

  btnAddCookie.addEventListener('click', () => {
    cookies.push({ key: '', value: '', enabled: true });
    renderKvList(kvListCookies, cookies, updateCookieCountBadge);
  });

  // Tab switching
  reqTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      reqTabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.getAttribute('data-tab');
      tabContentParams.classList.remove('active');
      tabContentHeaders.classList.remove('active');
      tabContentCookies.classList.remove('active');
      tabContentBody.classList.remove('active');

      if (targetTab === 'params') tabContentParams.classList.add('active');
      if (targetTab === 'headers') tabContentHeaders.classList.add('active');
      if (targetTab === 'cookies') tabContentCookies.classList.add('active');
      if (targetTab === 'body') tabContentBody.classList.add('active');
    });
  });

  function updateBodyVisibility() {
    if (activeBodyType === 'none') {
      bodyTextarea.style.display = 'none';
      bodyKvContainer.style.display = 'none';
      btnFormatJson.style.display = 'none';
    } else if (activeBodyType === 'form-data' || activeBodyType === 'x-www-form-urlencoded') {
      bodyTextarea.style.display = 'none';
      bodyKvContainer.style.display = 'block';
      btnFormatJson.style.display = 'none';
    } else {
      bodyTextarea.style.display = 'block';
      bodyKvContainer.style.display = 'none';
      btnFormatJson.style.display = activeBodyType === 'json' ? 'inline-flex' : 'none';
    }
  }

  bodyRadios.forEach((r) => {
    r.addEventListener('change', () => {
      activeBodyType = r.value as any;
      badgeBodyType.textContent = activeBodyType.toUpperCase();
      updateBodyVisibility();
    });
  });

  btnFormatJson.addEventListener('click', () => {
    try {
      const val = JSON.parse(bodyTextarea.value);
      bodyTextarea.value = JSON.stringify(val, null, 2);
      showToast('JSON 格式化成功');
    } catch (err: any) {
      showToast(`无效的 JSON 格式: ${err.message}`);
    }
  });

  respTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      respTabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-resptab');
      if (target === 'body') {
        respViewBody.style.display = 'block';
        respViewHeaders.style.display = 'none';
      } else {
        respViewBody.style.display = 'none';
        respViewHeaders.style.display = 'block';
      }
    });
  });

  // Current Payload Builder (Un-interpolated)
  function getCurrentPayload(): HttpRequestPayload {
    return urlOnlyPayload({
      method: currentMethod,
      url: urlInput.value.trim(),
      headers: headers.filter((h) => h.enabled && h.key.trim()),
      cookies: cookies.filter((c) => c.enabled && c.key.trim()),
      params: queryParams.filter((p) => p.enabled && p.key.trim()),
      body_type: activeBodyType,
      body_content: activeBodyType !== 'none' ? bodyTextarea.value : undefined,

      form_data:
        activeBodyType === 'form-data' || activeBodyType === 'x-www-form-urlencoded'
          ? formItems.filter((f) => f.enabled && f.key.trim())
          : undefined,
      ignore_ssl: ignoreSsl,
      timeout_seconds: importedTimeout,
    });
  }

  // Send HTTP Request
  async function sendRequest() {
    if (isLoading) return;
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showToast('请输入请求 URL');
      return;
    }

    isLoading = true;
    btnSend.disabled = true;
    btnNew.disabled = true;
    btnSend.innerHTML = '<span class="spinner-sm"></span><span>发送中</span>';

    respTabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-resptab') === 'body'));
    respViewBody.style.display = 'block';
    respViewHeaders.style.display = 'none';
    respEmpty.style.display = 'none';
    respError.style.display = 'none';
    respContent.style.display = 'none';
    respJsonToolbar.style.display = 'none';
    respJsonTree.style.display = 'none';
    respJsonTree.replaceChildren(); responseTree = undefined;
    respLoading.style.display = 'flex';
    respMetaInfo.style.display = 'none';

    lastResponse = null;
    const rawPayload = getCurrentPayload();
    let payload = rawPayload;
    try {
      payload = prepareCurrentRequest(rawPayload);
      lastSentRequest = structuredClone(payload);
      let res: HttpResponsePayload;
      if (isTauri()) {
        res = await invoke<HttpResponsePayload>('send_http_request', { req: payload });
      } else {
        res = await fetchInBrowser(payload);
      }

      // 如果响应中返回了 Set-Cookie，自动同步持久化到对应 Domain 的 Cookie Jar 中
      lastResponse = res;
      renderResponse(res);
      if (res.set_cookies && res.set_cookies.length > 0) {
        saveLocally(() => Storage.saveSetCookies(res.final_url || payload.url, res.set_cookies!), 'Cookie');
      }


      // Record to history
      saveLocally(() => Storage.addHistory({
        method: payload.method,
        url: payload.url,
        status: res.status,
        elapsed_ms: Number(res.elapsed_ms),
        payload: rawPayload,
      }), '历史记录');

      if (currentDrawerTab === 'history') saveLocally(renderDrawerContent, '历史列表');
    } catch (err: any) {
      respLoading.style.display = 'none';
      respError.style.display = 'flex';
      respErrorText.textContent = err?.message || String(err);
      showToast(`请求失败: ${err?.message || err}`);

      saveLocally(() => Storage.addHistory({
        method: payload.method,
        url: payload.url,
        status: 0,
        elapsed_ms: 0,
        payload: rawPayload,
      }), '历史记录');

      if (currentDrawerTab === 'history') saveLocally(renderDrawerContent, '历史列表');
    } finally {
      isLoading = false;
      btnSend.disabled = false;
      btnNew.disabled = false;
      btnSend.innerHTML = '<span>发送请求</span>';
    }
  }

  async function fetchInBrowser(req: HttpRequestPayload): Promise<HttpResponsePayload> {
    const start = performance.now();
    if (req.headers?.some(h => h.enabled && h.key.toLowerCase() === 'cookie')) throw new Error('浏览器模式不能设置 Cookie 请求头，请使用桌面版发送此请求');
    if (req.ignore_ssl) throw new Error('浏览器模式不支持忽略 SSL，请使用桌面版');
    const reqHeaders = new Headers();
    if (req.headers) {
      req.headers.forEach((h) => {
        if (h.enabled && h.key.trim()) reqHeaders.append(h.key.trim(), h.value);
      });
    }

    let fetchBody: BodyInit | undefined;
    if (req.body_type === 'json' && req.body_content) {
      fetchBody = req.body_content;
      if (!reqHeaders.has('Content-Type')) {
        reqHeaders.set('Content-Type', 'application/json');
      }
    } else if (req.body_type === 'raw' && req.body_content) {
      fetchBody = req.body_content;
    }

    if (req.body_type === 'x-www-form-urlencoded') {
      fetchBody = req.form_data ? new URLSearchParams(enabledFormItems(req.form_data).map(f => [f.key.trim(), f.value])) : req.body_content;
    } else if (req.body_type === 'form-data') {
      const form = new FormData();
      enabledFormItems(req.form_data).forEach(f => form.append(f.key.trim(), f.value));
      reqHeaders.delete('Content-Type'); fetchBody = form;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (req.timeout_seconds || 30) * 1000);
    let response: Response, bodyText: string;
    try {
      response = await fetch(req.url, { method: req.method, headers: reqHeaders, body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : fetchBody, signal: controller.signal });
      bodyText = await response.text();
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`请求超时（超过 ${req.timeout_seconds || 30} 秒）`);
      throw error;
    } finally { clearTimeout(timer); }
    const elapsed_ms = Math.round(performance.now() - start);
    const size_bytes = new Blob([bodyText]).size;

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    let is_json = false;
    try {
      JSON.parse(bodyText);
      is_json = true;
    } catch {}

    return {
      status: response.status,
      status_text: response.statusText,
      final_url: response.url,
      headers: respHeaders,
      body: bodyText,
      elapsed_ms,
      size_bytes,
      is_json,
    };
  }

  function renderResponse(res: HttpResponsePayload) {
    respLoading.style.display = 'none';
    respMetaInfo.style.display = 'flex';

    metaStatus.textContent = `${res.status} ${res.status_text || ''}`.trim();
    metaStatus.className = 'meta-tag';
    if (res.status >= 200 && res.status < 300) {
      metaStatus.classList.add('status-200');
    } else if (res.status >= 300 && res.status < 400) {
      metaStatus.classList.add('status-300');
    } else if (res.status >= 400 && res.status < 500) {
      metaStatus.classList.add('status-400');
    } else {
      metaStatus.classList.add('status-500');
    }

    metaTime.textContent = `⚡ ${res.elapsed_ms} ms`;
    metaSize.textContent = `📦 ${formatBytes(res.size_bytes)}`;

    const headerKeys = Object.keys(res.headers);
    badgeRespHeadersCount.textContent = headerKeys.length.toString();
    badgeRespHeadersCount.style.display = 'inline-block';

    responseTree = undefined; showingRaw = false;
    respJsonToolbar.style.display = 'none'; respJsonTree.style.display = 'none';
    respJsonTree.replaceChildren();
    respContent.style.display = 'block';
    respContent.querySelector('code')!.textContent = res.body || '(空响应体)';
    btnRespRaw.textContent = '查看原文'; btnRespExpand.disabled = false; btnRespCollapse.disabled = false;
    try {
      const tree = parseJsonTree(res.body);
      if (tree.kind !== 'value' && tree.children.length) {
        responseTree = renderJsonTree(respJsonTree, tree);
        respContent.style.display = 'none'; respJsonToolbar.style.display = 'flex'; respJsonTree.style.display = 'block';
      }
    } catch { /* Non-JSON or deeply nested responses remain available as raw text. */ }

    respHeadersTable.innerHTML = '';
    if (headerKeys.length === 0) {
      respHeadersTable.innerHTML = '<p class="text-muted" style="padding: 12px">无响应头信息</p>';
    } else {
      headerKeys.forEach((key) => {
        const row = document.createElement('div');
        row.className = 'resp-header-row';
        row.innerHTML = `
          <span class="header-name">${escapeHtml(key)}</span>
          <span class="header-value">${escapeHtml(res.headers[key])}</span>
        `;
        respHeadersTable.appendChild(row);
      });
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return (text || '').replace(/[&<>"']/g, (m) => map[m]);
  }

  btnCopyResp.addEventListener('click', async () => {
    if (lastResponse && lastResponse.body) {
      await navigator.clipboard.writeText(lastResponse.body);
      showToast('响应内容已复制到剪贴板');
    }
  });

  function saveLocally(action: () => unknown, label: string) {
    try { action(); } catch { showToast(`${label}保存失败，请求结果不受影响`); }
  }

  function prepareCurrentRequest(raw = getCurrentPayload()) {
    return prepareHttpRequest(raw, Storage.getActiveVariables(), url => Storage.getCookiesForUrl(url));
  }

  const previewModal = document.createElement('div');
  previewModal.className = 'modal-overlay';
  previewModal.style.display = 'none';
  previewModal.innerHTML = `<div class="modal-card request-preview-modal">
    <div class="modal-header"><h3>请求预览</h3><button class="btn-close preview-close">✕</button></div>
    <div class="modal-body"><p class="modal-tip">已替换环境变量并合并 Cookie。展示应用交给发送引擎的请求，Host、Content-Length、multipart boundary 等由引擎补充。cURL 适用于 Bash / Git Bash / WSL。</p>
    <div class="preview-actions"><button class="btn btn-secondary btn-sm preview-current">当前配置</button><button class="btn btn-secondary btn-sm preview-last">上次发送</button><button class="btn btn-primary btn-sm preview-copy">复制此请求 cURL</button></div>
    <textarea class="log-textarea preview-text" readonly spellcheck="false"></textarea></div></div>`;
  container.append(previewModal);
  let previewPayload: HttpRequestPayload | undefined;
  const previewText = previewModal.querySelector<HTMLTextAreaElement>('.preview-text')!;
  function showPreview(last = false) {
    try {
      if (last && !lastSentRequest) { showToast('尚未发送请求'); return; }
      previewPayload = last ? structuredClone(lastSentRequest!) : prepareCurrentRequest();
      previewText.value = requestPreview(previewPayload);
      previewModal.style.display = 'flex';
    } catch (error) { showToast(`预览失败：${error instanceof Error ? error.message : error}`); }
  }
  container.querySelector('#btn-request-preview')!.addEventListener('click', () => showPreview());
  previewModal.querySelector('.preview-close')!.addEventListener('click', () => { previewModal.style.display = 'none'; });
  previewModal.querySelector('.preview-current')!.addEventListener('click', () => showPreview());
  previewModal.querySelector('.preview-last')!.addEventListener('click', () => showPreview(true));
  previewModal.querySelector('.preview-copy')!.addEventListener('click', async () => {
    if (!previewPayload) return;
    try { await navigator.clipboard.writeText(generateCurlCommand(previewPayload)); showToast('已复制预览请求 cURL（Bash）'); }
    catch (error) { showToast(`复制失败：${error instanceof Error ? error.message : error}`); }
  });
  btnCurlExport.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(generateCurlCommand(prepareCurrentRequest())); showToast('已复制当前请求 cURL（Bash）'); }
    catch (error) { showToast(`导出失败：${error instanceof Error ? error.message : error}`); }
  });

  // Modal Closers
  container.querySelectorAll('.modal-close-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      curlModal.style.display = 'none';
      saveModal.style.display = 'none';
      envModal.style.display = 'none';
      cookiesModal.style.display = 'none';
    });
  });

  // ===================== Manage Cookies Modal Logic =====================
  function openCookiesModal() {
    cookiesModal.style.display = 'flex';
    // 默认预填当前请求的域名
    const currentUrl = urlInput.value.trim();
    if (currentUrl) {
      inputCookieDomain.value = Storage.extractDomainFromUrl(currentUrl);
    } else {
      inputCookieDomain.value = 'localhost';
    }
    renderDomainCookiesList();
  }

  btnManageCookies.addEventListener('click', openCookiesModal);

  btnAddDomain.addEventListener('click', () => {
    let rawDomain: string;
    try { rawDomain = normalizeDomain(inputCookieDomain.value); } catch (error) { showToast(String(error)); return; }
    if (!rawDomain) {
      showToast('请输入域名');
      return;
    }
    const map = Storage.getDomainCookies();
    if (!map[rawDomain]) {
      map[rawDomain] = [];
      Storage.saveDomainCookies(map);
      showToast(`已添加域名: ${rawDomain}`);
    }
    renderDomainCookiesList();
  });

  btnClearAllCookies.addEventListener('click', () => {
    showConfirmDialog({
      title: '清空所有 Cookies',
      message: '确定要清空所有域名的 Cookies 吗？此操作不可撤销。',
      okText: '确认清空',
      onConfirm: () => {
        Storage.clearAllCookies();
        renderDomainCookiesList();
        showToast('所有域名的 Cookies 已清空');
      },
    });
  });

  function renderDomainCookiesList() {
    const map = Storage.getDomainCookies();
    const domains = Object.keys(map);

    if (domains.length === 0) {
      domainCookiesContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-dim); font-size: 12.5px;">
          <p>暂无任何域名的 Cookie，输入域名并点击「Add」添加</p>
        </div>
      `;
      return;
    }

    domainCookiesContainer.innerHTML = '';
    domains.forEach((dom) => {
      const cookiesList = map[dom] || [];
      const card = document.createElement('div');
      card.className = 'cookie-domain-card';

      card.innerHTML = `
        <div class="cookie-domain-header">
          <div class="cookie-domain-title">
            <span class="cookie-domain-name">${escapeHtml(dom)}</span>
            <span class="cookie-domain-badge">${cookiesList.length} cookies</span>
          </div>
          <button class="btn btn-ghost btn-sm btn-del-domain" style="color: var(--danger); font-size: 11.5px; padding: 2px 8px;">
            删除域名
          </button>
        </div>
        <div class="cookie-chips-container">
          ${cookiesList
            .map(
              (c) => `
              <div class="cookie-pill">
                <span class="cookie-pill-name">${escapeHtml(c.name)}</span>
                <span class="cookie-pill-val" title="${escapeHtml(c.value)}">= ${escapeHtml(c.value)}</span>
                <span class="cookie-pill-path">${escapeHtml(c.path || '/')}</span>
                <button class="cookie-pill-edit btn-edit-cookie" data-id="${escapeHtml(c.id)}" title="编辑此 Cookie">编辑</button>
                <button class="cookie-pill-del btn-del-cookie" data-domain="${escapeHtml(dom)}" data-id="${escapeHtml(c.id)}" title="删除此 Cookie">✕</button>
              </div>
            `
            )
            .join('')}
          <button class="btn-add-cookie-pill btn-add-cookie-to-domain" data-domain="${escapeHtml(dom)}">
            <span>+</span> Add Cookie
          </button>
        </div>
        <!-- Inline Add Cookie Form -->
        <div class="cookie-editor-box inline-add-cookie-box" style="display: none;">
          <div class="cookie-editor-grid">
            <input type="text" class="modal-input input-new-cookie-name" placeholder="Cookie Name (如: token / sessionId)" />
            <input type="text" class="modal-input input-new-cookie-value" placeholder="Cookie Value (如: abc123456)" />
            <input type="text" class="modal-input input-cookie-path" placeholder="Path（默认 /）" value="/" aria-label="Cookie Path" />
            <input type="text" class="modal-input input-cookie-expires" placeholder="有效期，如 2027-01-01T00:00:00Z；留空为会话" aria-label="Cookie 有效期" />
          </div>
          <div class="cookie-editor-flags"><label><input type="checkbox" class="input-cookie-secure"> 仅 HTTPS（Secure）</label><label><input type="checkbox" class="input-cookie-host" checked> 仅当前域名</label><label><input type="checkbox" class="input-cookie-http"> HttpOnly</label></div>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn btn-ghost btn-sm btn-cancel-new-cookie">取消</button>
            <button class="btn-postman-orange btn-save-new-cookie" style="padding: 4px 14px !important; font-size: 11.5px !important;">保存</button>
          </div>
        </div>
      `;

      // Event Listeners for domain card
      card.querySelector('.btn-del-domain')?.addEventListener('click', () => {
        showConfirmDialog({
          title: '删除域名',
          message: `确定删除域名 ${dom} 及其所有 Cookies 吗？`,
          okText: '确认删除',
          onConfirm: () => {
            Storage.deleteDomain(dom);
            renderDomainCookiesList();
            showToast(`已删除域名 ${dom}`);
          },
        });
      });

      card.querySelectorAll('.btn-del-cookie').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id') || '';
          Storage.deleteCookie(dom, id);
          renderDomainCookiesList();
          showToast('Cookie 已删除');
        });
      });

      const inlineBox = card.querySelector('.inline-add-cookie-box') as HTMLElement;
      const btnAddCookieToDomain = card.querySelector('.btn-add-cookie-to-domain') as HTMLButtonElement;
      const inputName = card.querySelector('.input-new-cookie-name') as HTMLInputElement;
      const inputValue = card.querySelector('.input-new-cookie-value') as HTMLInputElement;
      const btnSaveNew = card.querySelector('.btn-save-new-cookie') as HTMLButtonElement;
      const btnCancelNew = card.querySelector('.btn-cancel-new-cookie') as HTMLButtonElement;

      const inputPath = card.querySelector<HTMLInputElement>('.input-cookie-path')!;
      const inputExpires = card.querySelector<HTMLInputElement>('.input-cookie-expires')!;
      const inputSecure = card.querySelector<HTMLInputElement>('.input-cookie-secure')!;
      const inputHost = card.querySelector<HTMLInputElement>('.input-cookie-host')!;
      const inputHttpOnly = card.querySelector<HTMLInputElement>('.input-cookie-http')!;
      let editingId: string | undefined;
      function openEditor(id?: string) {
        const cookie = cookiesList.find(c => c.id === id);
        editingId = id;
        inputName.value = cookie?.name || ''; inputValue.value = cookie?.value || '';
        inputPath.value = cookie?.path || '/'; inputExpires.value = cookie?.expires || '';
        inputSecure.checked = cookie?.secure || false; inputHttpOnly.checked = cookie?.httpOnly || false;
        inputHost.checked = cookie?.hostOnly ?? !dom.startsWith('.');
        inlineBox.style.display = 'block'; btnSaveNew.textContent = id ? '保存修改' : '保存'; inputName.focus();
      }
      card.querySelectorAll('.btn-edit-cookie').forEach(btn => btn.addEventListener('click', () => openEditor(btn.getAttribute('data-id')!)));
      btnAddCookieToDomain.addEventListener('click', () => openEditor());
      btnCancelNew.addEventListener('click', () => { inlineBox.style.display = 'none'; editingId = undefined; });
      btnSaveNew.addEventListener('click', () => {
        try {
          Storage.addOrUpdateCookie(dom, { name: inputName.value.trim(), value: inputValue.value.trim(), path: inputPath.value.trim() || '/', expires: inputExpires.value.trim() || undefined, secure: inputSecure.checked, httpOnly: inputHttpOnly.checked, hostOnly: inputHost.checked }, editingId);
          renderDomainCookiesList(); showToast('Cookie 已保存');
        } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
      });

      domainCookiesContainer.appendChild(card);
    });
  }



  // cURL Import Modal
  btnCurlImport.addEventListener('click', () => {
    curlModal.style.display = 'flex';
    curlTextarea.value = '';
    curlTextarea.focus();
  });

  btnConfirmCurl.addEventListener('click', () => {
    const raw = curlTextarea.value.trim();
    if (!raw) return;

    try {
      const parsed = parseCurlCommand(raw);
      loadPayloadIntoUi(parsed as HttpRequestPayload);
      curlModal.style.display = 'none';
      showToast('cURL 解析并导入成功！');
    } catch (err: any) {
      showToast(`解析失败: ${err.message}`);
    }
  });

  const saveGroupCombobox = createGroupCombobox(saveGroupInput, saveGroupMenu, saveGroupTrigger);

  function updateGroupOptions() {
    const groups = Storage.getSavedGroups();
    saveGroupCombobox.setGroups(groups);
  }

  // Save Modal
  function openSaveModal(createNew = false) {
    updateGroupOptions();
    const current = createNew ? undefined : Storage.getSavedRequests().find(item => item.id === activeSavedRequestId);
    if (!createNew && !current && activeSavedRequestId) setActiveSavedRequest(null);
    saveModal.style.display = 'flex';
    const rawUrl = urlInput.value.trim();
    saveNameInput.value = current?.name || (rawUrl ? `${currentMethod} ${rawUrl.substring(rawUrl.lastIndexOf('/') + 1) || '接口'}` : '');
    saveGroupInput.value = current?.group || '默认分组';
    saveModal.querySelector('h3')!.textContent = current ? '编辑收藏请求' : '保存接口请求';
    btnConfirmSave.textContent = current ? '保存修改' : '确认保存';
    saveModal.dataset.editingId = current?.id || '';
    saveNameInput.focus();
  }
  btnSave.addEventListener('click', () => openSaveModal());

  btnConfirmSave.addEventListener('click', () => {
    const name = saveNameInput.value.trim();
    if (!name) {
      showToast('请输入接口名称');
      return;
    }
    const group = saveGroupInput.value.trim() || '默认分组';
    const payload = getCurrentPayload();
    const id = saveModal.dataset.editingId;
    if (id) {
      if (!Storage.getSavedRequests().some(item => item.id === id)) { showToast('原收藏已删除，请重新保存'); return; }
      Storage.updateSavedRequest(id, { name, group, payload });
      setActiveSavedRequest(id);
    } else {
      const item = Storage.saveRequest(name, payload, group);
      setActiveSavedRequest(item.id);
    }
    saveModal.style.display = 'none';
    showToast(`${id ? '已更新' : '已保存'}接口: ${name} [${group}]`);
    if (currentDrawerTab === 'saved') renderDrawerContent();
  });

  // Env Modal (Multi-Environment Groups Support)
  let currentEditingEnvId: string = 'env_dev';

  function openEnvModal() {
    envModal.style.display = 'flex';
    const envs = Storage.getEnvironments();
    const active = Storage.getActiveEnvId();
    // 优先选中当前生效的环境，若不存在则选第一个
    if (active && envs.some((e) => e.id === active)) {
      currentEditingEnvId = active;
    } else if (envs.length > 0) {
      currentEditingEnvId = envs[0].id;
    }
    renderEnvModal();
  }

  function renderEnvModal() {
    const envs = Storage.getEnvironments();

    // 确保当前编辑的 ID 有效
    if (!envs.some((e) => e.id === currentEditingEnvId)) {
      currentEditingEnvId = envs.length > 0 ? envs[0].id : '';
    }

    // 1. 渲染左侧导航分组
    envGroupNavList.innerHTML = '';
    envs.forEach((env) => {
      const item = document.createElement('div');
      const isSelected = env.id === currentEditingEnvId;
      item.style.cssText = `
        padding: 8px 10px;
        margin-bottom: 4px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12.5px;
        font-weight: 500;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: ${isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent'};
        color: ${isSelected ? 'var(--primary)' : 'var(--text-muted)'};
        border-left: 3px solid ${isSelected ? 'var(--primary)' : 'transparent'};
        transition: all 0.15s ease;
      `;
      item.innerHTML = `
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🌐 ${escapeHtml(env.name)}</span>
        <span style="font-size: 11px; opacity: 0.6;">${Object.keys(env.variables || {}).length}</span>
      `;
      item.addEventListener('click', () => {
        currentEditingEnvId = env.id;
        renderEnvModal();
      });
      envGroupNavList.appendChild(item);
    });

    const currentEnv = envs.find((e) => e.id === currentEditingEnvId);

    // 2. 渲染右侧内容
    if (!currentEnv) {
      inputEditEnvName.value = '';
      inputEditEnvName.disabled = true;
      btnDeleteCurrentEnv.disabled = true;
      envKvList.innerHTML = '<p class="text-muted" style="padding: 12px">暂无环境分组，请点击左上角「+ 新增」创建</p>';
      return;
    }

    inputEditEnvName.disabled = false;
    btnDeleteCurrentEnv.disabled = false;
    inputEditEnvName.value = currentEnv.name;

    const varsMap = currentEnv.variables || {};
    const varItems: HttpKeyValueItem[] = Object.entries(varsMap).map(([key, value]) => ({
      key,
      value,
      enabled: true,
    }));
    if (varItems.length === 0) {
      varItems.push({ key: '', value: '', enabled: true });
    }

    renderKvList(envKvList, varItems, () => {});

    btnAddEnvVar.onclick = () => {
      varItems.push({ key: '', value: '', enabled: true });
      renderKvList(envKvList, varItems, () => {});
    };

    btnSaveEnv.onclick = () => {
      const updatedName = inputEditEnvName.value.trim();
      if (!updatedName) {
        showToast('环境名称不能为空');
        return;
      }
      Storage.renameEnvironment(currentEditingEnvId, updatedName);

      const newVars: Record<string, string> = {};
      varItems.forEach((item) => {
        if (item.key.trim()) {
          newVars[item.key.trim()] = item.value;
        }
      });

      Storage.updateEnvVariables(currentEditingEnvId, newVars);
      envModal.style.display = 'none';
      showToast(`已保存环境: ${updatedName}`);
      updateEnvSelector();
      if (currentDrawerTab === 'env') renderDrawerContent();
    };
  }

  // 新增环境
  btnCreateNewEnv.addEventListener('click', () => {
    const existing = Storage.getEnvironments();
    const newName = `测试环境 ${existing.length + 1}`;
    const newEnv = Storage.addEnvironment(newName);
    currentEditingEnvId = newEnv.id;
    renderEnvModal();
    updateEnvSelector();
    showToast(`已新建环境分组: ${newName}`);
  });

  // 删除当前环境
  btnDeleteCurrentEnv.addEventListener('click', () => {
    const envs = Storage.getEnvironments();
    const currentEnv = envs.find((e) => e.id === currentEditingEnvId);
    if (!currentEnv) return;

    showConfirmDialog({
      title: '删除环境分组',
      message: `确定要删除环境分组「${currentEnv.name}」吗？相关变量也将被移除。`,
      okText: '确认删除',
      onConfirm: () => {
        Storage.deleteEnvironment(currentEditingEnvId);
        const remaining = Storage.getEnvironments();
        currentEditingEnvId = remaining.length > 0 ? remaining[0].id : '';
        renderEnvModal();
        updateEnvSelector();
        if (currentDrawerTab === 'env') renderDrawerContent();
        showToast(`已删除环境分组`);
      },
    });
  });


  // Start a new request without changing the selected environment or saved history.
  btnNew.addEventListener('click', () => {
    if (isLoading) return;
    setActiveSavedRequest(null);
    importedTimeout = undefined;
    lastSentRequest = undefined;
    lastResponse = null;
    setMethod('GET');
    urlInput.value = '';
    queryParams = [{ key: '', value: '', enabled: true }];
    headers = [{ key: 'Accept', value: 'application/json', enabled: true }];
    cookies = [{ key: '', value: '', enabled: true }];
    formItems = [{ key: '', value: '', enabled: true }];
    activeBodyType = 'none';
    bodyRadios.forEach((radio) => { radio.checked = radio.value === 'none'; });
    badgeBodyType.textContent = 'NONE';
    bodyTextarea.value = '';
    updateBodyVisibility();
    renderAllKv();
    reqTabButtons[0].dispatchEvent(new MouseEvent('click'));
    respTabButtons.forEach((button) => button.classList.toggle('active', button.getAttribute('data-resptab') === 'body'));
    respViewBody.style.display = 'block';
    respViewHeaders.style.display = 'none';
    respEmpty.style.display = 'flex';
    respLoading.style.display = 'none';
    respError.style.display = 'none';
    respContent.style.display = 'none';
    respJsonToolbar.style.display = 'none';
    respJsonTree.style.display = 'none';
    respJsonTree.replaceChildren();
    responseTree = undefined;
    respMetaInfo.style.display = 'none';
    respHeadersTable.replaceChildren();
    badgeRespHeadersCount.textContent = '0';
    showToast('已新建空白请求');
    urlInput.focus();
  });

  // Clear Request
  btnClear.addEventListener('click', () => {
    importedTimeout = undefined;
    urlInput.value = '';
    queryParams = [{ key: '', value: '', enabled: true }];
    headers = [{ key: 'Accept', value: 'application/json', enabled: true }];
    cookies = [{ key: '', value: '', enabled: true }];
    formItems = [{ key: '', value: '', enabled: true }];
    bodyTextarea.value = '';
    renderAllKv();
    showToast('已清空请求内容');
  });


  btnSend.addEventListener('click', sendRequest);
  btnTestSample?.addEventListener('click', sendRequest);

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      sendRequest();
    }
  });

  // Init
  bodyTextarea.value = bodyContent;
  renderAllKv();
  updateEnvSelector();
  renderDrawerContent();
}
