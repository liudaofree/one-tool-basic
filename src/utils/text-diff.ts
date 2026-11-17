export type DiffKind = 'equal' | 'added' | 'removed' | 'modified';
type Edit<T> = { kind: 'equal' | 'added' | 'removed'; value: T };
export type DiffPart = { text: string; changed: boolean };
export type DiffRow = {
  kind: DiffKind;
  leftLine?: number;
  rightLine?: number;
  left?: string;
  right?: string;
  leftParts?: DiffPart[];
  rightParts?: DiffPart[];
};
export type TextDiff = {
  rows: DiffRow[];
  changes: number[];
  added: number;
  removed: number;
  modified: number;
  lineEndingDifferent: boolean;
};

function edits<T>(left: T[], right: T[], limit = 1200): Edit<T>[] {
  const n = left.length, m = right.length;
  if (!n) return right.map(value => ({ kind: 'added', value }));
  if (!m) return left.map(value => ({ kind: 'removed', value }));
  const previous = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  const max = Math.min(n + m, limit);
  for (let distance = 0; distance <= max; distance++) {
    trace.push(new Map(previous));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = previous.get(diagonal + 1) ?? -1;
      const rightward = previous.get(diagonal - 1) ?? -1;
      let x = diagonal === -distance || (diagonal !== distance && rightward < down)
        ? Math.max(0, down) : rightward + 1;
      let y = x - diagonal;
      while (x < n && y < m && left[x] === right[y]) { x++; y++; }
      previous.set(diagonal, x);
      if (x < n || y < m) continue;
      const result: Edit<T>[] = [];
      for (let step = distance; step >= 0; step--) {
        const frontier = trace[step];
        const currentDiagonal = x - y;
        const stepDown = frontier.get(currentDiagonal + 1) ?? -1;
        const stepRight = frontier.get(currentDiagonal - 1) ?? -1;
        const previousDiagonal = currentDiagonal === -step || (currentDiagonal !== step && stepRight < stepDown)
          ? currentDiagonal + 1 : currentDiagonal - 1;
        const previousX = frontier.get(previousDiagonal) ?? 0;
        const previousY = previousX - previousDiagonal;
        while (x > previousX && y > previousY) { result.push({ kind: 'equal', value: left[--x] }); y--; }
        if (step > 0) {
          if (x === previousX) result.push({ kind: 'added', value: right[--y] });
          else result.push({ kind: 'removed', value: left[--x] });
        }
      }
      return result.reverse();
    }
  }
  // A very large unrelated block is still reported as changed without an expensive edit trace.
  return [...left.map(value => ({ kind: 'removed' as const, value })), ...right.map(value => ({ kind: 'added' as const, value }))];
}

function parts(editList: Edit<string>[], side: 'left' | 'right'): DiffPart[] {
  const result: DiffPart[] = [];
  for (const edit of editList) {
    if (side === 'left' && edit.kind === 'added') continue;
    if (side === 'right' && edit.kind === 'removed') continue;
    const changed = edit.kind !== 'equal';
    const last = result.at(-1);
    if (last?.changed === changed) last.text += edit.value;
    else result.push({ text: edit.value, changed });
  }
  return result;
}

function textLines(value: string): string[] {
  return value ? value.replace(/\r\n?|\n/g, '\n').split('\n') : [];
}

export function compareTexts(leftText: string, rightText: string): TextDiff {
  const rows: DiffRow[] = [];
  const changes: number[] = [];
  let leftNumber = 1, rightNumber = 1;
  let added = 0, removed = 0, modified = 0;
  const operations = edits(textLines(leftText), textLines(rightText));
  for (let index = 0; index < operations.length;) {
    if (operations[index].kind === 'equal') {
      rows.push({ kind: 'equal', leftLine: leftNumber++, rightLine: rightNumber++, left: operations[index].value, right: operations[index].value });
      index++; continue;
    }
    const deleted: string[] = [], inserted: string[] = [];
    while (index < operations.length && operations[index].kind !== 'equal') {
      const edit = operations[index++];
      if (edit.kind === 'removed') deleted.push(edit.value);
      else inserted.push(edit.value);
    }
    for (let offset = 0; offset < Math.max(deleted.length, inserted.length); offset++) {
      const left = deleted[offset], right = inserted[offset];
      if (left !== undefined && right !== undefined) {
        const characters = edits([...left], [...right], 600);
        rows.push({ kind: 'modified', leftLine: leftNumber++, rightLine: rightNumber++, left, right,
          leftParts: parts(characters, 'left'), rightParts: parts(characters, 'right') });
        modified++;
      } else if (left !== undefined) { rows.push({ kind: 'removed', leftLine: leftNumber++, left }); removed++; }
      else { rows.push({ kind: 'added', rightLine: rightNumber++, right }); added++; }
      changes.push(rows.length - 1);
    }
  }
  const leftEnding = /\r\n/.test(leftText) ? 'crlf' : /\r/.test(leftText) ? 'cr' : 'lf';
  const rightEnding = /\r\n/.test(rightText) ? 'crlf' : /\r/.test(rightText) ? 'cr' : 'lf';
  return { rows, changes, added, removed, modified, lineEndingDifferent: leftEnding !== rightEnding };
}
