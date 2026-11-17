import { invoke, isTauri } from '@tauri-apps/api/core';
import { AI_LOCAL_TOOLS, runAiLocalTool } from '../utils/ai-local-tools';
import { getPlugin } from '../utils/plugin';
import { renderAiMarkdown } from '../utils/ai-markdown';

type Provider = 'deepseek' | 'minimax-cn' | 'minimax-intl';
type AiProfile = { id: string; name: string; provider: Provider; model: string };
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: unknown[]; reasoning_content?: string };
type ToolCall = { id: string; function: { name: string; arguments: string } };
type ChatResponse = { message: { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[]; reasoning_content?: string }; usage?: { total_tokens?: number } };

const STORAGE_KEY = 'onetool_ai_profiles';
const ACTIVE_KEY = 'onetool_ai_active_profile';
const DEFAULT_MODELS: Record<Provider, string> = { deepseek: 'deepseek-flash', 'minimax-cn': 'MiniMax-M3.1-Flash', 'minimax-intl': 'MiniMax-M3.1-Flash' };
const SYSTEM_PROMPT = `你是 One Tool 桌面工具箱的使用专家。用中文回答，优先利用已接入的本地功能得出可核对的结果。One Tool 包含接口请求、MyBatis SQL 还原、JSON 转换和业务字段分析、MySQL 代码生成、HTTP 下载，以及用户安装的私有业务插件。用户问这些功能怎么用时解释操作步骤。用户给出 JSON、MyBatis 日志或建表语句并要求分析时，先调用对应本地工具，再根据工具结果回答；不要编造执行结果。业务插件的分析只根据工具返回结果说明，不要编造企业、单证或申报数据。你只能调用列出的本地只读工具，不能执行任意代码、修改文件或发送请求到业务系统。`;

function loadProfiles(): AiProfile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(value)) return value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.model === 'string' && ['deepseek', 'minimax-cn', 'minimax-intl'].includes(item.provider));
  } catch { /* Start without saved profiles. */ }
  return [];
}

export function initAiAssistant(container: HTMLElement, showToast: (message: string) => void): void {
  container.innerHTML = `<div class="ai-page">
    <div class="ai-toolbar"><div><h2>AI 助手</h2><p>询问如何使用 One Tool，或让助手调用本地工具分析内容。</p></div><div class="ai-toolbar-actions"><select id="ai-profile-select" aria-label="AI 配置"></select><button id="ai-settings-button" class="btn btn-secondary" type="button">模型配置</button><button id="ai-clear" class="btn btn-ghost" type="button">清空对话</button></div></div>
    <div id="ai-messages" class="ai-messages" role="log"><div class="ai-empty">可以直接提问，例如：这段 SQL 日志可以还原吗？</div></div>
    <div class="ai-composer"><textarea id="ai-prompt" rows="3" placeholder="描述你的问题，或粘贴 JSON、MyBatis 日志、建表语句。Ctrl+Enter 发送"></textarea><div class="ai-composer-bottom"><span>发送的文本和本地工具结果会传给所选 AI 服务商，请先检查敏感数据。</span><button id="ai-send" class="btn btn-primary" type="button">发送</button></div></div>
    <div id="ai-settings" class="modal-overlay" style="display:none"><div class="modal-card ai-settings-card"><div class="modal-header"><h3>模型配置</h3><button id="ai-settings-close" class="btn-close" type="button">✕</button></div><div class="modal-body ai-settings-body"><label>配置名称<input id="ai-config-name" type="text" placeholder="如 DeepSeek 日常助手" /></label><label>服务商<select id="ai-config-provider"><option value="deepseek">DeepSeek</option><option value="minimax-cn">MiniMax 国内</option><option value="minimax-intl">MiniMax 国际</option></select></label><label>模型名称<input id="ai-config-model" type="text" /></label><label>API Key<input id="ai-config-key" type="password" placeholder="已保存的 Key 不会回显；留空则保留原 Key" autocomplete="off" /></label><p>API Key 在 Windows 上由当前用户加密保存在本机，在 macOS 上保存在系统钥匙串。测试连接会发送一条简短请求，可能产生少量费用。</p><div id="ai-settings-status" role="status"></div></div><div class="modal-footer"><button id="ai-config-new" class="btn btn-secondary" type="button">新建</button><button id="ai-config-delete" class="btn btn-ghost" type="button">删除</button><button id="ai-config-test" class="btn btn-secondary" type="button">测试连接</button><button id="ai-config-save" class="btn btn-primary" type="button">保存</button></div></div></div>
  </div>`;
  const get = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const select = get<HTMLSelectElement>('ai-profile-select');
  const messagesEl = get<HTMLDivElement>('ai-messages');
  const prompt = get<HTMLTextAreaElement>('ai-prompt');
  const sendButton = get<HTMLButtonElement>('ai-send');
  const clearButton = get<HTMLButtonElement>('ai-clear');
  const settings = get<HTMLDivElement>('ai-settings');
  const settingsStatus = get<HTMLDivElement>('ai-settings-status');
  const name = get<HTMLInputElement>('ai-config-name');
  const provider = get<HTMLSelectElement>('ai-config-provider');
  const model = get<HTMLInputElement>('ai-config-model');
  const key = get<HTMLInputElement>('ai-config-key');
  const saveButton = get<HTMLButtonElement>('ai-config-save');
  const testButton = get<HTMLButtonElement>('ai-config-test');
  const deleteButton = get<HTMLButtonElement>('ai-config-delete');
  const chat: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  let activeId = localStorage.getItem(ACTIVE_KEY) || '';
  let busy = false;
  const currentProfile = () => loadProfiles().find(item => item.id === activeId);
  const renderSelect = () => {
    const profiles = loadProfiles();
    select.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '选择 AI 配置'; select.append(placeholder);
    for (const item of profiles) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; select.append(option); }
    if (!profiles.some(item => item.id === activeId)) activeId = '';
    select.value = activeId;
    deleteButton.disabled = !activeId;
  };
  const addMessage = (kind: 'user' | 'assistant' | 'tool' | 'error', text: string): HTMLDivElement => {
    messagesEl.querySelector('.ai-empty')?.remove();
    const row = document.createElement('div'); row.className = `ai-message ai-message-${kind}`;
    const label = document.createElement('strong'); label.textContent = { user: '你', assistant: 'AI 助手', tool: '本地工具', error: '错误' }[kind];
    const body = document.createElement('div'); body.className = 'ai-message-body';
    if (kind === 'assistant') renderAiMarkdown(body, text);
    else body.textContent = text;
    row.append(label, body); messagesEl.append(row); messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  };
  const showSettings = () => {
    const profile = currentProfile();
    name.value = profile?.name || '';
    provider.value = profile?.provider || 'deepseek';
    provider.dispatchEvent(new Event('input'));
    model.value = profile?.model || DEFAULT_MODELS[provider.value as Provider];
    key.value = '';
    settingsStatus.textContent = '';
    settings.style.display = 'flex';
  };
  get<HTMLButtonElement>('ai-settings-button').onclick = showSettings;
  get<HTMLButtonElement>('ai-settings-close').onclick = () => { settings.style.display = 'none'; key.value = ''; };
  provider.onchange = () => { model.value = DEFAULT_MODELS[provider.value as Provider]; };
  get<HTMLButtonElement>('ai-config-new').onclick = () => { activeId = ''; renderSelect(); name.value = ''; provider.value = 'deepseek'; provider.dispatchEvent(new Event('input')); model.value = DEFAULT_MODELS.deepseek; key.value = ''; settingsStatus.textContent = '填写新配置后点击保存'; };
  testButton.onclick = async () => {
    if (!isTauri()) { settingsStatus.textContent = '测试连接需要桌面版'; return; }
    if (!model.value.trim()) { settingsStatus.textContent = '请填写模型名称'; return; }
    const saved = currentProfile();
    if (saved && saved.provider !== provider.value && !key.value.trim()) { settingsStatus.textContent = '切换服务商时请填写对应的 API Key'; return; }
    testButton.disabled = true; testButton.textContent = '测试中…'; settingsStatus.textContent = '正在连接模型服务…';
    try {
      settingsStatus.textContent = await invoke<string>('test_ai_connection', { request: { profileId: saved?.id || '', provider: provider.value, model: model.value.trim(), apiKey: key.value.trim() || null } });
    } catch (error) {
      settingsStatus.textContent = typeof error === 'string' ? error : error instanceof Error ? error.message : '测试连接失败';
    } finally { testButton.disabled = false; testButton.textContent = '测试连接'; }
  };
  saveButton.onclick = async () => {
    if (!isTauri()) { settingsStatus.textContent = 'AI API Key 保存与调用需要桌面版'; return; }
    const configName = name.value.trim(); const modelName = model.value.trim();
    if (!configName || !modelName) { settingsStatus.textContent = '请填写配置名称和模型'; return; }
    const profiles = loadProfiles();
    if (profiles.some(item => item.name === configName && item.id !== activeId)) { settingsStatus.textContent = '已有同名配置'; return; }
    if (profiles.some(item => item.id === activeId && item.provider !== provider.value) && !key.value.trim()) { settingsStatus.textContent = '切换服务商时请填写对应的 API Key'; return; }
    const profile: AiProfile = { id: activeId || `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: configName, provider: provider.value as Provider, model: modelName };
    saveButton.disabled = true;
    try {
      if (key.value.trim()) await invoke('save_ai_api_key', { profileId: profile.id, apiKey: key.value.trim() });
      else if (!await invoke<boolean>('has_ai_api_key', { profileId: profile.id })) throw new Error('请填写 API Key');
      const index = profiles.findIndex(item => item.id === activeId);
      if (index < 0) profiles.push(profile); else profiles[index] = profile;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
      activeId = profile.id; localStorage.setItem(ACTIVE_KEY, activeId); renderSelect();
      key.value = ''; settings.style.display = 'none'; showToast(`已保存 AI 配置：${profile.name}`);
    } catch (error) { settingsStatus.textContent = error instanceof Error ? error.message : '保存失败'; }
    finally { saveButton.disabled = false; }
  };
  deleteButton.onclick = async () => {
    const profile = currentProfile(); if (!profile || !window.confirm(`删除 AI 配置「${profile.name}」？`)) return;
    try {
      await invoke('delete_ai_api_key', { profileId: profile.id });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loadProfiles().filter(item => item.id !== profile.id)));
      activeId = ''; localStorage.removeItem(ACTIVE_KEY); renderSelect(); settings.style.display = 'none'; showToast('AI 配置已删除');
    } catch { settingsStatus.textContent = '删除配置失败'; }
  };
  select.onchange = () => { activeId = select.value; if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); else localStorage.removeItem(ACTIVE_KEY); chat.splice(1); messagesEl.innerHTML = '<div class="ai-empty">已切换配置，可以开始提问。</div>'; };
  clearButton.onclick = () => { chat.splice(1); messagesEl.innerHTML = '<div class="ai-empty">对话已清空，可以开始新问题。</div>'; };
  async function submit() {
    if (busy) return;
    const profile = currentProfile();
    if (!profile) { showSettings(); settingsStatus.textContent = '请先保存 DeepSeek 或 MiniMax 配置'; return; }
    if (!isTauri()) { addMessage('error', 'AI 请求需要桌面版'); return; }
    const text = prompt.value.trim(); if (!text) return;
    prompt.value = ''; chat.push({ role: 'user', content: text }); addMessage('user', text);
    busy = true; sendButton.disabled = true; select.disabled = true; clearButton.disabled = true; sendButton.textContent = '思考中…';
    try {
      for (let round = 0; round < 4; round++) {
        const response = await invoke<ChatResponse>('ai_chat_completion', { request: { profileId: profile.id, provider: profile.provider, model: profile.model, messages: chat, tools: [...AI_LOCAL_TOOLS, ...(getPlugin()?.aiTools || [])] } });
        const message = response.message;
        const calls = message.tool_calls || [];
        chat.push({ role: 'assistant', content: message.content || null, ...(calls.length ? { tool_calls: calls } : {}), ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) });
        if (!calls.length) { addMessage('assistant', message.content?.trim() || '模型没有返回可显示的内容。'); break; }
        for (const call of calls) {
          let result: unknown;
          try {
            const args = JSON.parse(call.function.arguments || '{}');
            const plugin = getPlugin();
            result = plugin?.aiTools?.some(tool => tool.function.name === call.function.name)
              ? await plugin.runAiTool!(call.function.name, args)
              : await runAiLocalTool(call.function.name, args);
          }
          catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
          const serialized = JSON.stringify(result);
          const toolContent = serialized.length > 40_000
            ? JSON.stringify({ truncated: true, preview: serialized.slice(0, 40_000), note: '结果过长，仅提供前 40000 个字符' })
            : serialized;
          chat.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
          const row = addMessage('tool', `${call.function.name} 已执行${result && typeof result === 'object' && 'error' in result ? `：${(result as { error: string }).error}` : '，结果已交给助手解释'}`);
          const target = call.function.name === 'restore_mybatis_sql' ? 'sql-restorer' : call.function.name === 'convert_json' ? 'json-converter' : getPlugin()?.aiTools?.some(tool => tool.function.name === call.function.name) ? 'plugins' : call.function.name.includes('mysql') ? 'code-generator' : '';
          if (target) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost btn-sm'; button.textContent = '打开对应工具';
            button.onclick = () => document.querySelector<HTMLElement>(`.sidebar-nav .nav-item[data-tool="${target}"]`)?.click();
            row.append(button);
          }
        }
        if (round === 3) addMessage('error', '本次本地工具调用过多，请缩小问题范围后重试。');
      }
    } catch (error) { addMessage('error', typeof error === 'string' ? error : error instanceof Error ? error.message : 'AI 请求失败'); }
    finally { busy = false; sendButton.disabled = false; select.disabled = false; clearButton.disabled = false; sendButton.textContent = '发送'; }
  }
  sendButton.onclick = () => { void submit(); };
  prompt.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(); } };
  renderSelect();
}
