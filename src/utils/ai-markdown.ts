// Render the subset of Markdown used in chat without inserting model-provided HTML.
function inline(parent: HTMLElement, source: string): void {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let position = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    parent.append(document.createTextNode(source.slice(position, index)));
    const token = match[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code'); code.textContent = token.slice(1, -1); parent.append(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong'); strong.textContent = token.slice(2, -2); parent.append(strong);
    } else {
      const split = token.indexOf('](');
      const link = document.createElement('a'); link.textContent = token.slice(1, split);
      link.href = token.slice(split + 2, -1); link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
    }
    position = index + token.length;
  }
  parent.append(document.createTextNode(source.slice(position)));
}

function codeBlock(parent: HTMLElement, code: string, language: string): void {
  const box = document.createElement('section'); box.className = 'ai-code-block';
  const header = document.createElement('div'); header.className = 'ai-code-header';
  const title = document.createElement('span'); title.textContent = language || '代码';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.className = 'btn btn-ghost btn-sm';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(code); copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1800); }
    catch { copy.textContent = '复制失败'; }
  };
  header.append(title, copy);
  const pre = document.createElement('pre'); const content = document.createElement('code'); content.textContent = code; pre.append(content);
  box.append(header, pre); parent.append(box);
}

export function renderAiMarkdown(parent: HTMLElement, source: string): void {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)/);
    if (fence) {
      const marker = fence[1][0]; const length = fence[1].length; const language = fence[2];
      const body: string[] = []; index++;
      while (index < lines.length && !new RegExp(`^\\s*${marker}{${length},}\\s*$`).test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index++;
      codeBlock(parent, body.join('\n'), language); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${Math.min(heading[1].length + 1, 6)}`);
      inline(element, heading[2]); parent.append(element); index++; continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        const item = document.createElement('li'); inline(item, lines[index].replace(/^\s*([-*]|\d+\.)\s+/, '')); list.append(item); index++;
      }
      parent.append(list); continue;
    }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1]) && lines[index + 1].includes('-')) {
      const table = document.createElement('table');
      const cells = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const head = document.createElement('thead'); const headRow = document.createElement('tr');
      for (const cell of cells(line)) { const th = document.createElement('th'); inline(th, cell); headRow.append(th); }
      head.append(headRow); table.append(head); index += 2;
      const body = document.createElement('tbody');
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const row = document.createElement('tr');
        for (const cell of cells(lines[index++])) { const td = document.createElement('td'); inline(td, cell); row.append(td); }
        body.append(row);
      }
      table.append(body); const wrap = document.createElement('div'); wrap.className = 'ai-table-wrap'; wrap.append(table); parent.append(wrap); continue;
    }
    const paragraph: string[] = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^\s*(`{3,}|~{3,}|#{1,6}\s|[-*]\s|\d+\.\s)/.test(lines[index])) paragraph.push(lines[index++]);
    const p = document.createElement('p'); inline(p, paragraph.join('\n')); parent.append(p);
  }
}
