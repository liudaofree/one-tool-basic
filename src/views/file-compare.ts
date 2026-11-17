import { compareTexts, type DiffPart, type DiffRow, type TextDiff } from '../utils/text-diff';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINES = 10000;

export function initFileCompare(container: HTMLElement, showToast: (message: string) => void): void {
  container.innerHTML = `<div class="file-compare-page">
    <div class="file-compare-toolbar">
      <div class="file-compare-toolbar-main"><strong>文件与代码比对</strong><span>选择两个文本文件，或直接粘贴两段代码</span></div>
      <div class="file-compare-toolbar-actions"><button id="fc-edit" class="btn btn-secondary" type="button">编辑内容</button><button id="fc-swap" class="btn btn-secondary" type="button">交换左右</button><button id="fc-compare" class="btn btn-primary" type="button">开始比对</button></div>
    </div>
    <div id="fc-editors" class="file-compare-editors">
      <section class="file-compare-source"><div class="file-compare-source-head"><div><strong>左侧 · 原始版本</strong><span id="fc-left-name">未选择文件</span></div><button id="fc-left-pick" class="btn btn-secondary btn-sm" type="button">选择文件</button></div><textarea id="fc-left" spellcheck="false" aria-label="左侧原始内容" placeholder="粘贴原始文件或方法代码…"></textarea><input id="fc-left-file" type="file" hidden /></section>
      <section class="file-compare-source"><div class="file-compare-source-head"><div><strong>右侧 · 对比版本</strong><span id="fc-right-name">未选择文件</span></div><button id="fc-right-pick" class="btn btn-secondary btn-sm" type="button">选择文件</button></div><textarea id="fc-right" spellcheck="false" aria-label="右侧对比内容" placeholder="粘贴对比文件或方法代码…"></textarea><input id="fc-right-file" type="file" hidden /></section>
    </div>
    <div id="fc-result" class="file-compare-result" hidden>
      <div class="file-compare-summary"><span id="fc-summary" role="status"></span><span id="fc-ending-note"></span><div class="file-compare-nav"><button id="fc-prev" class="btn btn-ghost btn-sm" type="button">上一处</button><span id="fc-position">0 / 0</span><button id="fc-next" class="btn btn-ghost btn-sm" type="button">下一处</button></div></div>
      <div class="file-compare-result-head"><span id="fc-left-result-name">左侧 · 原始版本</span><span id="fc-right-result-name">右侧 · 对比版本</span></div>
      <div id="fc-rows" class="file-compare-rows"></div>
      <div class="file-compare-legend"><span class="file-compare-legend-remove">删除</span><span class="file-compare-legend-add">新增</span><span>同一行中的色块表示具体字符变化</span></div>
    </div>
  </div>`;
  const get = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const left = get<HTMLTextAreaElement>('fc-left'), right = get<HTMLTextAreaElement>('fc-right');
  const editors = get<HTMLDivElement>('fc-editors'), result = get<HTMLDivElement>('fc-result');
  const rowsEl = get<HTMLDivElement>('fc-rows');
  const leftName = get<HTMLSpanElement>('fc-left-name'), rightName = get<HTMLSpanElement>('fc-right-name');
  let diff: TextDiff | null = null;
  let currentChange = -1;

  function switchView(showResult: boolean): void {
    editors.hidden = showResult;
    result.hidden = !showResult;
  }

  function renderParts(parent: HTMLElement, pieces: DiffPart[] | undefined, fallback: string): void {
    if (!pieces) { parent.textContent = fallback; return; }
    for (const piece of pieces) {
      const span = document.createElement('span');
      span.textContent = piece.text;
      if (piece.changed) span.className = 'file-compare-character-change';
      parent.append(span);
    }
  }

  function cell(row: DiffRow, side: 'left' | 'right'): HTMLDivElement {
    const element = document.createElement('div');
    element.className = `file-compare-cell file-compare-cell-${side} file-compare-cell-${row.kind}`;
    const number = document.createElement('span'); number.className = 'file-compare-line-number';
    number.textContent = String(side === 'left' ? row.leftLine ?? '' : row.rightLine ?? '');
    const code = document.createElement('pre'); code.className = 'file-compare-code';
    renderParts(code, side === 'left' ? row.leftParts : row.rightParts, (side === 'left' ? row.left : row.right) ?? '');
    element.append(number, code);
    return element;
  }

  function updateNavigation(): void {
    const count = diff?.changes.length ?? 0;
    get<HTMLSpanElement>('fc-position').textContent = `${count ? currentChange + 1 : 0} / ${count}`;
    get<HTMLButtonElement>('fc-prev').disabled = !count || currentChange <= 0;
    get<HTMLButtonElement>('fc-next').disabled = !count || currentChange >= count - 1;
    rowsEl.querySelector('.file-compare-row-current')?.classList.remove('file-compare-row-current');
    if (count && currentChange >= 0) {
      const row = rowsEl.children[diff!.changes[currentChange]] as HTMLElement;
      row?.classList.add('file-compare-row-current');
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function compare(): void {
    const leftText = left.value, rightText = right.value;
    if (!leftText && !rightText) { showToast('请先选择文件或粘贴代码'); return; }
    if (Math.max(leftText.length, rightText.length) > MAX_FILE_BYTES || Math.max(leftText.split('\n').length, rightText.split('\n').length) > MAX_LINES) {
      showToast('内容过大，请截取需要比对的文件片段（最多 1 MB、10000 行）'); return;
    }
    diff = compareTexts(leftText, rightText);
    rowsEl.replaceChildren();
    for (const row of diff.rows) {
      const pair = document.createElement('div'); pair.className = `file-compare-row file-compare-row-${row.kind}`;
      pair.append(cell(row, 'left'), cell(row, 'right'));
      rowsEl.append(pair);
    }
    const changed = diff.added + diff.removed + diff.modified;
    get<HTMLSpanElement>('fc-summary').textContent = changed
      ? `修改 ${diff.modified} 行 · 新增 ${diff.added} 行 · 删除 ${diff.removed} 行`
      : '文本内容相同';
    get<HTMLSpanElement>('fc-ending-note').textContent = diff.lineEndingDifferent ? '换行格式不同（CRLF / LF / CR）' : '';
    get<HTMLSpanElement>('fc-left-result-name').textContent = `原始版本 · ${leftName.textContent}`;
    get<HTMLSpanElement>('fc-right-result-name').textContent = `对比版本 · ${rightName.textContent}`;
    currentChange = diff.changes.length ? 0 : -1;
    switchView(true);
    updateNavigation();
  }

  async function loadFile(side: 'left' | 'right'): Promise<void> {
    const input = get<HTMLInputElement>(`fc-${side}-file`);
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { showToast('文件超过 1 MB，请截取需要比对的方法或片段'); return; }
    try {
      const content = await file.text();
      if (content.includes('\0')) { showToast('暂不支持二进制文件，请选择文本或代码文件'); return; }
      const textarea = side === 'left' ? left : right;
      textarea.value = content;
      (side === 'left' ? leftName : rightName).textContent = file.name;
      showToast(`已载入 ${file.name}`);
    } catch {
      showToast(`读取 ${file.name} 失败，请重试`);
    }
  }

  for (const side of ['left', 'right'] as const) {
    get<HTMLButtonElement>(`fc-${side}-pick`).onclick = () => get<HTMLInputElement>(`fc-${side}-file`).click();
    get<HTMLInputElement>(`fc-${side}-file`).onchange = () => { void loadFile(side); };
    const textarea = side === 'left' ? left : right;
    textarea.oninput = () => { (side === 'left' ? leftName : rightName).textContent = '粘贴内容'; };
  }
  get<HTMLButtonElement>('fc-edit').onclick = () => switchView(false);
  get<HTMLButtonElement>('fc-compare').onclick = compare;
  get<HTMLButtonElement>('fc-swap').onclick = () => {
    [left.value, right.value] = [right.value, left.value];
    [leftName.textContent, rightName.textContent] = [rightName.textContent, leftName.textContent];
    if (!result.hidden) compare();
  };
  get<HTMLButtonElement>('fc-prev').onclick = () => { if (currentChange > 0) { currentChange--; updateNavigation(); } };
  get<HTMLButtonElement>('fc-next').onclick = () => { if (diff && currentChange < diff.changes.length - 1) { currentChange++; updateNavigation(); } };
}
