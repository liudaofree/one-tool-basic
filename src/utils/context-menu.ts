type MenuItem = { label: string; action: () => void | Promise<void>; danger?: boolean };

let activeMenu: HTMLDivElement | null = null;
let reportError: (message: string) => void = () => {};

export function closeContextMenu(): void {
  activeMenu?.remove();
  activeMenu = null;
  document.removeEventListener('pointerdown', closeOutside);
  document.removeEventListener('keydown', handleKeys);
}

function closeOutside(event: PointerEvent): void {
  if (!activeMenu?.contains(event.target as Node)) closeContextMenu();
}

function handleKeys(event: KeyboardEvent): void {
  if (!activeMenu) return;
  if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(); return; }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const buttons = [...activeMenu.querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
}

export function showContextMenu(event: MouseEvent, items: MenuItem[]): void {
  event.preventDefault();
  closeContextMenu();
  if (!items.length) return;
  const menu = document.createElement('div');
  menu.className = 'app-context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    if (item.danger) button.classList.add('danger');
    button.onclick = () => {
      closeContextMenu();
      void Promise.resolve(item.action()).catch(error => reportError(error instanceof Error ? error.message : String(error)));
    };
    menu.append(button);
  }
  document.body.append(menu);
  activeMenu = menu;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('keydown', handleKeys);
  menu.querySelector('button')?.focus();
}

function editableControl(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const control = target.closest('input, textarea');
  if (control instanceof HTMLTextAreaElement) return control;
  if (control instanceof HTMLInputElement && /^(text|search|url|tel|password)$/.test(control.type)) return control;
  return null;
}

export function installAppContextMenu(onError: (message: string) => void): void {
  reportError = onError;
  document.addEventListener('contextmenu', event => {
    if (event.defaultPrevented) return;
    if (activeMenu?.contains(event.target as Node)) { showContextMenu(event, []); return; }
    const control = editableControl(event.target);
    if (!control) {
      const selection = window.getSelection()?.toString() || '';
      showContextMenu(event, selection ? [{ label: '复制', action: async () => { await navigator.clipboard.writeText(selection); } }] : []);
      return;
    }
    const start = control.selectionStart ?? 0;
    const end = control.selectionEnd ?? start;
    const selected = control.value.slice(start, end);
    const items: MenuItem[] = [];
    if (selected) {
      if (control.type !== 'password') items.push({ label: '复制', action: async () => { await navigator.clipboard.writeText(selected); } });
      if (control.type !== 'password' && !control.readOnly && !control.disabled) items.push({ label: '剪切', action: async () => {
        await navigator.clipboard.writeText(selected);
        control.focus(); control.setRangeText('', start, end, 'start'); control.dispatchEvent(new Event('input', { bubbles: true }));
      } });
    }
    if (!control.readOnly && !control.disabled) items.push({ label: '粘贴', action: async () => {
      const text = await navigator.clipboard.readText();
      control.focus(); control.setRangeText(text, start, end, 'end'); control.dispatchEvent(new Event('input', { bubbles: true }));
    } });
    items.push({ label: '全选', action: () => { control.focus(); control.select(); } });
    showContextMenu(event, items);
  });
}
