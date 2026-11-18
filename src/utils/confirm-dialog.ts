export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
}

let activeDialog: Promise<boolean> | null = null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (activeDialog) return activeDialog;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay app-confirm-overlay';
  overlay.innerHTML = `
    <div class="modal-card app-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-message">
      <div class="modal-header"><h3 id="app-confirm-title"></h3><button class="btn-close" type="button" aria-label="关闭">✕</button></div>
      <div class="modal-body"><p id="app-confirm-message"></p></div>
      <div class="modal-footer"><button class="btn btn-secondary btn-sm app-confirm-cancel" type="button">取消</button><button class="btn btn-sm app-confirm-ok" type="button"></button></div>
    </div>`;
  overlay.querySelector<HTMLElement>('#app-confirm-title')!.textContent = options.title;
  overlay.querySelector<HTMLElement>('#app-confirm-message')!.textContent = options.message;
  const ok = overlay.querySelector<HTMLButtonElement>('.app-confirm-ok')!;
  ok.textContent = options.confirmText;
  ok.classList.add(options.destructive ? 'btn-danger' : 'btn-primary');
  document.body.append(overlay);

  activeDialog = new Promise<boolean>(resolve => {
    const finish = (confirmed: boolean) => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      activeDialog = null;
      previousFocus?.focus();
      resolve(confirmed);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') {
        const controls = [...overlay.querySelectorAll<HTMLButtonElement>('button')];
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey && index === 0) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    overlay.querySelector<HTMLButtonElement>('.btn-close')!.onclick = () => finish(false);
    overlay.querySelector<HTMLButtonElement>('.app-confirm-cancel')!.onclick = () => finish(false);
    ok.onclick = () => finish(true);
    overlay.onclick = event => { if (event.target === overlay) finish(false); };
    overlay.querySelector<HTMLButtonElement>('.app-confirm-cancel')!.focus();
  });
  return activeDialog;
}
