import { invoke } from '@tauri-apps/api/core';
import { format, type FormatOptionsWithLanguage } from 'sql-formatter';

interface ParsedSqlResult {
  raw_sql: string;
  formatted_sql: string | null;
  statement_type: string;
  param_count: number;
  error: string | null;
}

interface ConvertOptions {
  boolean_as_number: boolean;
}

const SAMPLE_LOG = `2026-10-14 16:19:16.411 DEBUG 7 --- [  XNIO-1 task-5] demo.OrderMapper.selectOne               : ==>  Preparing: SELECT id,order_no,status FROM demo_order WHERE (tenant_id = ? AND order_no = ? AND deleted = ?)
2026-10-14 16:19:16.412 DEBUG 7 --- [  XNIO-1 task-5] demo.OrderMapper.selectOne               : ==> Parameters: 7(Integer), DEMO-001(String), false(Boolean)
2026-10-14 16:19:16.510 DEBUG 7 --- [  XNIO-1 task-5] demo.OrderMapper.updateById              : ==>  Preparing: UPDATE demo_order SET status = ?, update_time = ?, remark = ? WHERE id = ?
2026-10-14 16:19:16.511 DEBUG 7 --- [  XNIO-1 task-5] demo.OrderMapper.updateById              : ==> Parameters: 2(Integer), 2026-10-14 16:19:16(Timestamp), 示例完成(String), 108264(Long)`;

function isParameterComplete(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'true' ||
    trimmed.toLowerCase() === 'false' ||
    (!isNaN(Number(trimmed)) && trimmed !== '')
  ) {
    return true;
  }
  const open = trimmed.lastIndexOf('(');
  const close = trimmed.lastIndexOf(')');
  if (open !== -1 && close === trimmed.length - 1 && open < close) {
    const typePart = trimmed.substring(open + 1, close);
    if (typePart && /^[a-zA-Z][a-zA-Z0-9_\[\]]*$/.test(typePart)) {
      return true;
    }
  }
  return false;
}

function parseLogsInBrowser(logText: string, options: ConvertOptions): ParsedSqlResult[] {
  const results: ParsedSqlResult[] = [];
  const lines = logText.split(/\r?\n/);
  let currentPreparing: string | null = null;

  const generateResult = (preparing: string, paramsStr: string): ParsedSqlResult => {
    const tokens = parseParameterTokens(paramsStr);
    let replacedCount = 0;
    let error: string | null = null;
    let tokenIndex = 0;

    let finalSql = '';
    for (let i = 0; i < preparing.length; i++) {
      if (preparing[i] === '?') {
        if (tokenIndex < tokens.length) {
          finalSql += formatParamValue(tokens[tokenIndex++], options);
          replacedCount++;
        } else {
          finalSql += '?';
          error = '参数数量少于问号占位符(?)数量';
        }
      } else {
        finalSql += preparing[i];
      }
    }

    if (tokenIndex < tokens.length) {
      error = `参数数量(${tokens.length})多于SQL占位符数量(${replacedCount})`;
    }

    const firstWord = (finalSql.trim().split(/\s+/)[0] || '').toUpperCase();
    const statement_type = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(firstWord)
      ? firstWord
      : 'OTHER';

    return {
      raw_sql: finalSql,
      formatted_sql: null,
      statement_type,
      param_count: replacedCount,
      error,
    };
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const prepIdx = trimmed.indexOf('Preparing:');
    if (prepIdx !== -1) {
      const sqlPart = trimmed.substring(prepIdx + 'Preparing:'.length).trim();
      if (currentPreparing !== null) {
        results.push(generateResult(currentPreparing, ''));
      }
      currentPreparing = sqlPart;
      continue;
    }

    const paramIdx = trimmed.indexOf('Parameters:');
    if (paramIdx !== -1) {
      const paramPart = trimmed.substring(paramIdx + 'Parameters:'.length).trim();
      if (currentPreparing !== null) {
        results.push(generateResult(currentPreparing, paramPart));
        currentPreparing = null;
      }
    }
  }

  if (currentPreparing !== null) {
    results.push(generateResult(currentPreparing, ''));
  }

  return results;
}

function parseParameterTokens(paramsStr: string): string[] {
  const tokens: string[] = [];
  if (!paramsStr.trim()) return tokens;

  let current = '';
  let inParentheses = 0;

  for (let i = 0; i < paramsStr.length; i++) {
    const ch = paramsStr[i];
    if (ch === '(') {
      inParentheses++;
      current += ch;
    } else if (ch === ')') {
      if (inParentheses > 0) inParentheses--;
      current += ch;
    } else if (ch === ',' && inParentheses === 0 && isParameterComplete(current)) {
      const item = current.trim();
      if (item) tokens.push(item);
      current = '';
    } else {
      current += ch;
    }
  }

  const last = current.trim();
  if (last) tokens.push(last);
  return tokens;
}

function formatParamValue(token: string, options: ConvertOptions): string {
  const trimmed = token.trim();
  if (trimmed.toLowerCase() === 'null') return 'NULL';

  const openIdx = trimmed.lastIndexOf('(');
  const closeIdx = trimmed.lastIndexOf(')');

  if (openIdx !== -1 && closeIdx === trimmed.length - 1 && openIdx < closeIdx) {
    const val = trimmed.substring(0, openIdx).trim();
    const typeName = trimmed.substring(openIdx + 1, closeIdx).toLowerCase();

    if (val.toLowerCase() === 'null') return 'NULL';

    switch (typeName) {
      case 'string':
      case 'date':
      case 'time':
      case 'timestamp':
      case 'localdate':
      case 'localdatetime':
        return `'${val.replace(/'/g, "''")}'`;
      case 'boolean':
        return options.boolean_as_number
          ? val.toLowerCase() === 'true'
            ? '1'
            : '0'
          : val.toLowerCase();
      case 'byte[]':
      case 'blob':
        return `'${val}'`;
      default:
        return val;
    }
  }

  if (trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'false') {
    return options.boolean_as_number
      ? trimmed.toLowerCase() === 'true'
        ? '1'
        : '0'
      : trimmed.toLowerCase();
  }

  if (!isNaN(Number(trimmed)) && trimmed !== '') {
    return trimmed;
  }

  return `'${trimmed.replace(/'/g, "''")}'`;
}

export function initSqlRestorer(container: HTMLElement, showToast: (msg: string) => void) {
  let currentResults: ParsedSqlResult[] = [];
  let selectedResultIndex = 0;

  container.innerHTML = `
    <div class="tool-content-inner">
      <div class="options-bar">
        <div class="options-group">
          <label class="option-item">
            <input type="checkbox" id="opt-bool-number" />
            <span>布尔值转为数字 (1/0)</span>
          </label>
          <label class="option-item">
            <input type="checkbox" id="opt-auto-format" checked />
            <span>格式化美化 SQL</span>
          </label>
          <label class="option-item">
            <input type="checkbox" id="opt-uppercase" checked />
            <span>关键字大写</span>
          </label>
        </div>
        <div class="options-group">
          <span style="color: var(--text-muted);">SQL 方言:</span>
          <select id="select-dialect" class="select-custom">
            <option value="sql">Standard SQL</option>
            <option value="mysql" selected>MySQL</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="sqlite">SQLite</option>
            <option value="transactsql">SQL Server</option>
          </select>
          <button id="btn-sample" class="btn btn-secondary btn-sm">
            <span>💡 载入示例</span>
          </button>
          <button id="btn-copy-all" class="btn btn-secondary btn-sm">
            <span>📋 复制全部</span>
          </button>
          <button id="btn-clear" class="btn btn-ghost btn-sm">
            <span>🗑️ 清空</span>
          </button>
        </div>
      </div>

      <main class="workspace">
        <section class="pane pane-left">
          <div class="pane-header">
            <div class="pane-title">
              <span>原始 MyBatis 日志</span>
              <span id="badge-input-stat" class="badge">0 行</span>
            </div>
            <label class="option-item sql-wrap-toggle"><input type="checkbox" id="opt-log-wrap" checked /><span>自动换行</span></label>
          </div>
          <div class="pane-body">
            <textarea
              id="input-log"
              class="log-textarea"
              spellcheck="false"
              placeholder="粘贴包含 Preparing: ... 和 Parameters: ... 的 MyBatis 日志内容&#10;支持多条 SQL 混合日志批量还原解析..."
            ></textarea>
          </div>
        </section>

        <section class="pane pane-right">
          <div class="pane-header">
            <div class="pane-title">
              <span>还原后的 SQL</span>
              <span id="badge-output-stat" class="badge">未解析</span>
            </div>
          </div>
          <div class="pane-body">
            <div id="output-list" class="output-container">
              <div class="empty-state">
                <div class="empty-icon">📝</div>
                <p>暂无解析结果</p>
                <button id="btn-empty-sample" class="btn btn-secondary btn-sm">试试示例日志</button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;

  const inputLog = container.querySelector('#input-log') as HTMLTextAreaElement;
  const outputList = container.querySelector('#output-list') as HTMLDivElement;
  const btnSample = container.querySelector('#btn-sample') as HTMLButtonElement;
  const btnEmptySample = container.querySelector('#btn-empty-sample') as HTMLButtonElement;
  const btnCopyAll = container.querySelector('#btn-copy-all') as HTMLButtonElement;
  const btnClear = container.querySelector('#btn-clear') as HTMLButtonElement;
  const optBoolNumber = container.querySelector('#opt-bool-number') as HTMLInputElement;
  const optAutoFormat = container.querySelector('#opt-auto-format') as HTMLInputElement;
  const optUppercase = container.querySelector('#opt-uppercase') as HTMLInputElement;
  const optLogWrap = container.querySelector('#opt-log-wrap') as HTMLInputElement;
  const selectDialect = container.querySelector('#select-dialect') as HTMLSelectElement;
  const badgeInputStat = container.querySelector('#badge-input-stat') as HTMLSpanElement;
  const badgeOutputStat = container.querySelector('#badge-output-stat') as HTMLSpanElement;

  function formatSqlText(rawSql: string): string {
    if (!optAutoFormat.checked) return rawSql;
    try {
      const opts: FormatOptionsWithLanguage = {
        language: selectDialect.value as any,
        keywordCase: optUppercase.checked ? 'upper' : 'preserve',
        tabWidth: 2,
      };
      return format(rawSql, opts);
    } catch (err) {
      console.warn('Formatting failed, using raw SQL:', err);
      return rawSql;
    }
  }

  async function executeParse() {
    const text = inputLog.value;
    if (!text.trim()) {
      currentResults = [];
      renderResults([]);
      return;
    }

    const options: ConvertOptions = {
      boolean_as_number: optBoolNumber.checked,
    };

    try {
      let results: ParsedSqlResult[];
      try {
        results = await invoke<ParsedSqlResult[]>('parse_mybatis_logs', {
          logText: text,
          options,
        });
      } catch (invokeErr) {
        results = parseLogsInBrowser(text, options);
      }
      currentResults = results;
      renderResults(results);
    } catch (err: any) {
      showToast(`解析出错: ${err?.message || err}`);
    }
  }

  function renderResults(results: ParsedSqlResult[]) {
    if (results.length === 0) {
      selectedResultIndex = 0;
      badgeOutputStat.textContent = '0 条 SQL';
      outputList.classList.remove('has-results');
      outputList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <p>未检测到可还原的 MyBatis 日志（缺少 Preparing/Parameters）</p>
          <button id="btn-empty-sample-inner" class="btn btn-secondary btn-sm">试试示例日志</button>
        </div>
      `;
      outputList.querySelector('#btn-empty-sample-inner')?.addEventListener('click', loadSample);
      return;
    }

    selectedResultIndex = Math.min(selectedResultIndex, results.length - 1);
    badgeOutputStat.textContent = `${results.length} 条 SQL`;
    outputList.classList.add('has-results');
    outputList.innerHTML = `
      <div class="sql-result-list" role="listbox" aria-label="SQL 结果列表"></div>
      <div class="sql-result-detail" aria-live="polite"></div>
    `;
    const list = outputList.querySelector<HTMLDivElement>('.sql-result-list')!;
    const detail = outputList.querySelector<HTMLDivElement>('.sql-result-detail')!;

    function showResult(index: number) {
      selectedResultIndex = index;
      const item = results[index];
      const formatted = formatSqlText(item.raw_sql);
      const typeClass = item.statement_type.toLowerCase();
      list.querySelectorAll<HTMLButtonElement>('.sql-result-item').forEach((button, i) => {
        button.classList.toggle('active', i === index);
        button.setAttribute('aria-selected', String(i === index));
      });
      detail.innerHTML = `
        <div class="sql-detail-header">
          <div class="sql-tags">
            <span class="tag-stmt ${typeClass}">${escapeHtml(item.statement_type)}</span>
            <span class="tag-params">#${index + 1} · ${item.param_count} 个参数</span>
          </div>
          <button class="btn btn-secondary btn-sm btn-copy-card" type="button">复制 SQL</button>
        </div>
        ${item.error ? `<div class="error-banner">⚠️ ${escapeHtml(item.error)}</div>` : ''}
        <pre class="sql-detail-code"><code>${escapeHtml(formatted)}</code></pre>
      `;
      detail.querySelector<HTMLButtonElement>('.btn-copy-card')!.addEventListener('click', async () => {
        await navigator.clipboard.writeText(formatted);
        showToast(`已复制第 ${index + 1} 条 SQL`);
      });
    }

    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sql-result-item';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      button.innerHTML = `
        <span class="sql-result-item-top"><span class="tag-stmt ${item.statement_type.toLowerCase()}">${escapeHtml(item.statement_type)}</span><span>#${index + 1}</span><span>${item.param_count} 个参数</span>${item.error ? '<span class="sql-result-error">有错误</span>' : ''}</span>
        <span class="sql-result-preview">${escapeHtml(item.raw_sql.replace(/\s+/g, ' ').trim())}</span>
      `;
      button.addEventListener('click', () => showResult(index));
      list.appendChild(button);
    });
    showResult(selectedResultIndex);
  }

  function escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  function updateInputStat() {
    const lines = inputLog.value.split(/\r?\n/).length;
    badgeInputStat.textContent = `${lines} 行 · ${inputLog.value.length} 字符`;
  }

  function loadSample() {
    inputLog.value = SAMPLE_LOG;
    updateInputStat();
    executeParse();
  }

  optLogWrap.addEventListener('change', () => inputLog.classList.toggle('no-wrap', !optLogWrap.checked));

  btnSample.addEventListener('click', loadSample);
  btnEmptySample?.addEventListener('click', loadSample);

  btnClear.addEventListener('click', () => {
    inputLog.value = '';
    updateInputStat();
    currentResults = [];
    renderResults([]);
  });

  btnCopyAll.addEventListener('click', async () => {
    if (currentResults.length === 0) {
      showToast('暂无可复制的 SQL');
      return;
    }
    const allSql = currentResults.map((r) => formatSqlText(r.raw_sql) + ';').join('\n\n');
    await navigator.clipboard.writeText(allSql);
    showToast(`已成功复制全部 ${currentResults.length} 条 SQL`);
  });

  let debounceTimer: number | undefined;
  inputLog.addEventListener('input', () => {
    updateInputStat();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      executeParse();
    }, 300);
  });

  [optBoolNumber, optAutoFormat, optUppercase, selectDialect].forEach((el) => {
    el.addEventListener('change', () => {
      if (currentResults.length > 0) {
        if (el === optBoolNumber) {
          executeParse();
        } else {
          renderResults(currentResults);
        }
      }
    });
  });

  inputLog.value = '';
  updateInputStat();
  renderResults([]);
}
